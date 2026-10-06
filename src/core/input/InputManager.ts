/**
 * Action-mapped input.
 *
 * Raw device codes (KeyboardEvent.code such as "KeyW", mouse buttons "Mouse0".."Mouse2",
 * gamepad buttons "Pad0".."Pad16") are mapped to named actions by data (`src/data/input/*.json`),
 * so key rebinding (Phase 34 settings) only edits data. Gameplay code only asks about actions:
 *
 *   if (input.wasPressed('menu')) ...
 *   const zoom = input.wheelDelta;
 *
 * Edge state (pressed/released this frame) is cleared by `endFrame()`, called by the game loop.
 */
export type InputCode = string;

export interface ActionBinding {
  readonly codes: readonly InputCode[];
}

export type InputBindings = Readonly<Record<string, ActionBinding>>;

export interface InputEventTarget {
  addEventListener(type: string, listener: (e: Event) => void, options?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, listener: (e: Event) => void, options?: EventListenerOptions | boolean): void;
}

export interface ActionEvent {
  readonly action: string;
  readonly phase: 'pressed' | 'released';
  readonly code: InputCode;
}

interface KeyLikeEvent extends Event {
  readonly code?: string;
  readonly repeat?: boolean;
}
interface PointerLikeEvent extends Event {
  readonly button?: number;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly movementX?: number;
  readonly movementY?: number;
}
interface WheelLikeEvent extends Event {
  readonly deltaY?: number;
}

export class InputManager {
  private bindings: InputBindings = {};
  private readonly codeToActions = new Map<InputCode, string[]>();
  private readonly down = new Set<InputCode>();
  private readonly pressedThisFrame = new Set<InputCode>();
  private readonly releasedThisFrame = new Set<InputCode>();
  private readonly listeners: Array<(e: ActionEvent) => void> = [];
  private attachedTo: InputEventTarget | null = null;
  private enabled = true;

  /** Pointer position in client pixels. */
  pointerX = 0;
  pointerY = 0;
  /** Accumulated pointer movement this frame (pixels). */
  pointerDeltaX = 0;
  pointerDeltaY = 0;
  /** Accumulated wheel delta this frame (positive = scroll down / zoom out). */
  wheelDelta = 0;
  private lastPadButtons: boolean[] = [];

  setBindings(bindings: InputBindings): void {
    this.bindings = bindings;
    this.codeToActions.clear();
    for (const [action, b] of Object.entries(bindings)) {
      for (const code of b.codes) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(action);
        this.codeToActions.set(code, list);
      }
    }
  }

  getBindings(): InputBindings {
    return this.bindings;
  }

  actions(): string[] {
    return Object.keys(this.bindings);
  }

  /** Disable while a text field has focus or during non-interactive transitions. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  attach(target: InputEventTarget): void {
    this.detach();
    this.attachedTo = target;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointermove', this.onPointerMove);
    target.addEventListener('wheel', this.onWheel, { passive: true });
    target.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    const t = this.attachedTo;
    if (!t) return;
    t.removeEventListener('keydown', this.onKeyDown);
    t.removeEventListener('keyup', this.onKeyUp);
    t.removeEventListener('pointerdown', this.onPointerDown);
    t.removeEventListener('pointerup', this.onPointerUp);
    t.removeEventListener('pointermove', this.onPointerMove);
    t.removeEventListener('wheel', this.onWheel);
    t.removeEventListener('blur', this.onBlur);
    this.attachedTo = null;
  }

  onAction(fn: (e: ActionEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  isDown(action: string): boolean {
    return this.codesOf(action).some((c) => this.down.has(c));
  }

  wasPressed(action: string): boolean {
    return this.codesOf(action).some((c) => this.pressedThisFrame.has(c));
  }

  wasReleased(action: string): boolean {
    return this.codesOf(action).some((c) => this.releasedThisFrame.has(c));
  }

  /** -1..1 axis from two actions (e.g. moveLeft/moveRight). */
  axis(negative: string, positive: string): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  isCodeDown(code: InputCode): boolean {
    return this.down.has(code);
  }

  activeActions(): string[] {
    return this.actions().filter((a) => this.isDown(a));
  }

  /** Feed a raw press directly (used by DOM UI buttons, gamepad polling and tests). */
  press(code: InputCode): void {
    if (!this.enabled || this.down.has(code)) return;
    this.down.add(code);
    this.pressedThisFrame.add(code);
    this.dispatch(code, 'pressed');
  }

  release(code: InputCode): void {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.releasedThisFrame.add(code);
    this.dispatch(code, 'released');
  }

  releaseAll(): void {
    for (const code of [...this.down]) this.release(code);
  }

  /** Poll connected gamepads (call once per frame). Buttons map to codes "Pad<index>". */
  pollGamepads(pads: ReadonlyArray<{ buttons: ReadonlyArray<{ pressed: boolean }> } | null> | undefined): void {
    const pad = pads?.find((p) => p !== null) ?? null;
    if (!pad) return;
    pad.buttons.forEach((b, i) => {
      const was = this.lastPadButtons[i] ?? false;
      if (b.pressed && !was) this.press(`Pad${i}`);
      if (!b.pressed && was) this.release(`Pad${i}`);
      this.lastPadButtons[i] = b.pressed;
    });
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.releasedThisFrame.clear();
    this.pointerDeltaX = 0;
    this.pointerDeltaY = 0;
    this.wheelDelta = 0;
  }

  private codesOf(action: string): readonly InputCode[] {
    return this.bindings[action]?.codes ?? [];
  }

  private dispatch(code: InputCode, phase: 'pressed' | 'released'): void {
    const actions = this.codeToActions.get(code);
    if (!actions) return;
    for (const action of actions) for (const l of [...this.listeners]) l({ action, phase, code });
  }

  private readonly onKeyDown = (e: Event): void => {
    const k = e as KeyLikeEvent;
    if (k.repeat || !k.code) return;
    if (this.codeToActions.has(k.code) && e.cancelable) e.preventDefault();
    this.press(k.code);
  };

  private readonly onKeyUp = (e: Event): void => {
    const k = e as KeyLikeEvent;
    if (k.code) this.release(k.code);
  };

  private readonly onPointerDown = (e: Event): void => {
    const p = e as PointerLikeEvent;
    this.updatePointer(p);
    this.press(`Mouse${p.button ?? 0}`);
  };

  private readonly onPointerUp = (e: Event): void => {
    const p = e as PointerLikeEvent;
    this.updatePointer(p);
    this.release(`Mouse${p.button ?? 0}`);
  };

  private readonly onPointerMove = (e: Event): void => {
    const p = e as PointerLikeEvent;
    this.pointerDeltaX += p.movementX ?? 0;
    this.pointerDeltaY += p.movementY ?? 0;
    this.updatePointer(p);
  };

  private readonly onWheel = (e: Event): void => {
    if (!this.enabled) return;
    this.wheelDelta += (e as WheelLikeEvent).deltaY ?? 0;
  };

  private readonly onBlur = (): void => {
    this.releaseAll();
  };

  private updatePointer(p: PointerLikeEvent): void {
    if (p.clientX !== undefined) this.pointerX = p.clientX;
    if (p.clientY !== undefined) this.pointerY = p.clientY;
  }
}
