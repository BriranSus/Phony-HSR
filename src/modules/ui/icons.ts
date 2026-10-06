import type { Element as GameElement, Path } from '@models/common';

/**
 * Original, hand-authored SVG icons (no external art). All icons use `currentColor` so CSS controls
 * tinting. They are static strings and safe to inject as trusted markup.
 */
const svg = (body: string, viewBox = '0 0 24 24'): string =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** Project emblem: a compass ring crossed by a rail of light, with an eight-point star. */
export const EMBLEM_SVG = `<svg viewBox="0 0 120 120" fill="none" aria-hidden="true">
  <defs>
    <linearGradient id="emb-g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#fff4d6"/><stop offset="0.5" stop-color="#e2bd7a"/><stop offset="1" stop-color="#a77c3c"/>
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="50" stroke="url(#emb-g)" stroke-width="2.2"/>
  <circle cx="60" cy="60" r="41" stroke="url(#emb-g)" stroke-width="0.8" stroke-dasharray="2 4"/>
  <path d="M60 16 L65 55 L104 60 L65 65 L60 104 L55 65 L16 60 L55 55 Z" fill="url(#emb-g)" opacity="0.95"/>
  <path d="M60 33 L62.5 57.5 L87 60 L62.5 62.5 L60 87 L57.5 62.5 L33 60 L57.5 57.5 Z" fill="#0b1124"/>
  <circle cx="60" cy="60" r="4.2" fill="url(#emb-g)"/>
  <path d="M8 92 C 40 70, 80 50, 114 26" stroke="url(#emb-g)" stroke-width="2.6"/>
  <path d="M8 98 C 40 76, 80 56, 114 32" stroke="url(#emb-g)" stroke-width="1" opacity="0.6"/>
</svg>`;

export const ELEMENT_ICONS: Readonly<Record<GameElement, string>> = {
  Physical: svg('<path d="M12 3 L19.8 7.5 V16.5 L12 21 L4.2 16.5 V7.5 Z"/><path d="M8 12 H16 M12 8 V16"/>'),
  Fire: svg('<path d="M12 21c-4 0-6.5-2.8-6.5-6.3 0-3.7 3-5.6 3.7-9.2 2.2 1.6 3 3.6 2.8 5.6 1-1 1.7-2.3 1.8-3.8 2.6 2 4.7 4.6 4.7 7.6 0 3.4-2.5 6.1-6.5 6.1z"/><path d="M12 21c-1.7 0-2.8-1.2-2.8-2.8 0-1.9 1.7-2.7 2.3-4.4 1.6 1.2 3.3 2.6 3.3 4.4 0 1.6-1.1 2.8-2.8 2.8z"/>'),
  Ice: svg('<path d="M12 2.5 V21.5 M3.8 7.2 L20.2 16.8 M20.2 7.2 L3.8 16.8"/><path d="M9.5 4.5 L12 6.5 L14.5 4.5 M9.5 19.5 L12 17.5 L14.5 19.5"/>'),
  Lightning: svg('<path d="M13.5 2.5 L5.5 13.5 H11.5 L10 21.5 L18.5 9.8 H12.5 Z"/>'),
  Wind: svg('<path d="M3 9h11a3 3 0 1 0-3-3"/><path d="M3 13h15a3 3 0 1 1-3 3"/><path d="M3 17h7"/>'),
  Quantum: svg('<path d="M12 2.8 L20 7.4 V16.6 L12 21.2 L4 16.6 V7.4 Z"/><path d="M4 7.4 L12 12 L20 7.4 M12 12 V21.2"/>'),
  Imaginary: svg('<circle cx="12" cy="12" r="8.6"/><path d="M12 5.5 L13.6 10.4 L18.5 12 L13.6 13.6 L12 18.5 L10.4 13.6 L5.5 12 L10.4 10.4 Z"/>'),
};

export const PATH_ICONS: Readonly<Record<Path, string>> = {
  Destruction: svg('<circle cx="12" cy="12" r="8.5" stroke-dasharray="11 3"/><path d="M12 4.5 V19.5 M9 7 L12 4.5 L15 7"/>'),
  Hunt: svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5 V7 M12 17 V21.5 M2.5 12 H7 M17 12 H21.5"/><circle cx="12" cy="12" r="1.6"/>'),
  Erudition: svg('<path d="M3 12 C 6 6.5, 18 6.5, 21 12 C 18 17.5, 6 17.5, 3 12 Z"/><circle cx="12" cy="12" r="3"/><path d="M12 3 V5.5 M12 18.5 V21"/>'),
  Harmony: svg('<path d="M12 20 V10"/><path d="M8 14 C 8 10, 16 10, 16 14"/><path d="M5 12 C 5 5.5, 19 5.5, 19 12"/><path d="M2.5 10 C 2.5 1.5, 21.5 1.5, 21.5 10"/>'),
  Nihility: svg('<circle cx="12" cy="12" r="8.5"/><path d="M15.5 4.8 A 7.8 7.8 0 1 0 15.5 19.2 A 9 9 0 0 1 15.5 4.8 Z" fill="currentColor" fill-opacity="0.35"/>'),
  Preservation: svg('<path d="M12 2.8 L19.5 5.8 V11.5 C 19.5 16.2, 16.4 19.6, 12 21.2 C 7.6 19.6, 4.5 16.2, 4.5 11.5 V5.8 Z"/><path d="M12 7 V17 M8 11 H16"/>'),
  Abundance: svg('<path d="M12 21 C 12 15, 12 11, 12 8"/><path d="M12 13 C 7 13, 4.5 9.5, 5 5 C 9.5 5, 12 8, 12 13 Z"/><path d="M12 11 C 16.5 11, 19 8, 19 3.5 C 14.5 3.5, 12 6.5, 12 11 Z"/>'),
  Remembrance: svg('<path d="M7 3.5 H17 M7 20.5 H17"/><path d="M8 3.5 C 8 9, 16 9, 16 12 C 16 15, 8 15, 8 20.5"/><path d="M16 3.5 C 16 9, 8 9, 8 12 C 8 15, 16 15, 16 20.5"/>'),
};

export const UI_ICONS = {
  announce: svg('<path d="M4 10 V14 H7 L13 18 V6 L7 10 Z"/><path d="M16.5 9 C 18 10.5, 18 13.5, 16.5 15 M19 6.5 C 22 9.5, 22 14.5, 19 17.5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8 V5.2 M12 18.8 V21.2 M2.8 12 H5.2 M18.8 12 H21.2 M5.5 5.5 L7.2 7.2 M16.8 16.8 L18.5 18.5 M5.5 18.5 L7.2 16.8 M16.8 7.2 L18.5 5.5"/>'),
  account: svg('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5 C 5.5 15.8, 18.5 15.8, 19.5 20.5"/>'),
  exit: svg('<path d="M10 4 H5 V20 H10"/><path d="M14 8 L18 12 L14 16 M18 12 H9"/>'),
  archive: svg('<rect x="3.5" y="4" width="17" height="5" rx="1"/><path d="M5 9 V20 H19 V9 M10 13 H14"/>'),
  train: svg('<rect x="5" y="3" width="14" height="13" rx="3"/><path d="M5 10 H19 M9 19.5 L7 21.5 M15 19.5 L17 21.5"/><circle cx="8.5" cy="13" r="0.8"/><circle cx="15.5" cy="13" r="0.8"/>'),
  play: svg('<path d="M8 5 L19 12 L8 19 Z"/>'),
  lock: svg('<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5 V7.5 a4 4 0 0 1 8 0 V10.5"/>'),
  back: svg('<path d="M15 5 L8 12 L15 19"/>'),
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.5 L14.6 8.9 L21.5 9.4 L16.2 13.8 L17.9 20.6 L12 16.9 L6.1 20.6 L7.8 13.8 L2.5 9.4 L9.4 8.9 Z"/></svg>`,
} as const;
