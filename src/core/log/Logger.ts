/**
 * Namespaced, level-filtered logger with pluggable sinks.
 * Every subsystem receives a child logger (`logger.child('combat')`) instead of calling console directly.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type ActiveLogLevel = Exclude<LogLevel, 'silent'>;

export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface LogRecord {
  readonly level: ActiveLogLevel;
  readonly namespace: string;
  readonly message: string;
  readonly data: readonly unknown[];
  readonly time: number;
}

export type LogSink = (record: LogRecord) => void;

export const consoleSink: LogSink = (r) => {
  const prefix = `[${r.namespace}]`;
  switch (r.level) {
    case 'debug':
      console.debug(prefix, r.message, ...r.data);
      break;
    case 'info':
      console.info(prefix, r.message, ...r.data);
      break;
    case 'warn':
      console.warn(prefix, r.message, ...r.data);
      break;
    case 'error':
      console.error(prefix, r.message, ...r.data);
      break;
  }
};

/** Ring-buffer sink, used by the in-game debug overlay and by tests. */
export class MemorySink {
  readonly records: LogRecord[] = [];
  constructor(private readonly capacity = 500) {}
  readonly sink: LogSink = (r) => {
    this.records.push(r);
    if (this.records.length > this.capacity) this.records.shift();
  };
}

interface LoggerRoot {
  level: LogLevel;
  sinks: LogSink[];
  now: () => number;
}

export interface LoggerOptions {
  level?: LogLevel;
  sinks?: LogSink[];
  namespace?: string;
  now?: () => number;
}

export class Logger {
  private constructor(
    private readonly root: LoggerRoot,
    readonly namespace: string,
  ) {}

  static create(options: LoggerOptions = {}): Logger {
    return new Logger(
      {
        level: options.level ?? 'info',
        sinks: options.sinks ?? [consoleSink],
        now: options.now ?? (() => Date.now()),
      },
      options.namespace ?? 'game',
    );
  }

  /** Child loggers share level and sinks with their root. */
  child(namespace: string): Logger {
    return new Logger(this.root, `${this.namespace}:${namespace}`);
  }

  get level(): LogLevel {
    return this.root.level;
  }

  setLevel(level: LogLevel): void {
    this.root.level = level;
  }

  addSink(sink: LogSink): () => void {
    this.root.sinks.push(sink);
    return () => {
      const i = this.root.sinks.indexOf(sink);
      if (i >= 0) this.root.sinks.splice(i, 1);
    };
  }

  isEnabled(level: ActiveLogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.root.level];
  }

  debug(message: string, ...data: unknown[]): void {
    this.write('debug', message, data);
  }
  info(message: string, ...data: unknown[]): void {
    this.write('info', message, data);
  }
  warn(message: string, ...data: unknown[]): void {
    this.write('warn', message, data);
  }
  error(message: string, ...data: unknown[]): void {
    this.write('error', message, data);
  }

  private write(level: ActiveLogLevel, message: string, data: unknown[]): void {
    if (!this.isEnabled(level)) return;
    const record: LogRecord = { level, namespace: this.namespace, message, data, time: this.root.now() };
    for (const sink of this.root.sinks) {
      try {
        sink(record);
      } catch {
        // A faulty sink must never break the game.
      }
    }
  }
}
