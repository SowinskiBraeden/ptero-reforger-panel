import type { SVGProps } from 'react';

/**
 * Inline SVG icon set — no icon dependency, no runtime font.
 *
 * Every glyph is drawn on a 24px grid with a 1.6px stroke so weights stay
 * consistent next to 13px text, and inherits `currentColor` so a single class
 * on the parent controls colour.
 */

export type IconName =
  | 'gauge'
  | 'package'
  | 'sliders'
  | 'map'
  | 'users'
  | 'crosshair'
  | 'pulse'
  | 'terminal'
  | 'settings'
  | 'play'
  | 'stop'
  | 'restart'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'refresh'
  | 'download'
  | 'upload'
  | 'search'
  | 'close'
  | 'check'
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-left'
  | 'alert'
  | 'info'
  | 'link'
  | 'copy'
  | 'menu'
  | 'arrow-up'
  | 'filter'
  | 'server'
  | 'image'
  | 'lock'
  | 'exit';

const PATHS: Record<IconName, string> = {
  gauge: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm1.4-3.4L17 7M3.6 18a9 9 0 1 1 16.8 0',
  package: 'M21 8v8l-9 5-9-5V8l9-5 9 5Zm-18 0 9 5 9-5m-9 5v8',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  map: 'm9 4-6 3v13l6-3 6 3 6-3V4l-6 3-6-3Zm0 0v13m6-10v13',
  users:
    'M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20M9 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 6.8',
  crosshair: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-15v3m0 6v3m6-6h-3m-6 0H3',
  pulse: 'M3 12h3.5L9 5l4 14 2.5-7H21',
  terminal:
    'm5 8 4 4-4 4m6 1h8M3 20h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1Z',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.5-3a7.5 7.5 0 0 1-.1 1.2l2 1.5-2 3.4-2.4-1a7.5 7.5 0 0 1-2 1.2l-.4 2.5h-4l-.4-2.5a7.5 7.5 0 0 1-2-1.2l-2.4 1-2-3.4 2-1.5a7.5 7.5 0 0 1 0-2.4l-2-1.5 2-3.4 2.4 1a7.5 7.5 0 0 1 2-1.2L8.6 3h4l.4 2.5a7.5 7.5 0 0 1 2 1.2l2.4-1 2 3.4-2 1.5c.06.4.1.8.1 1.2Z',
  play: 'M7 4.5v15l13-7.5-13-7.5Z',
  stop: 'M6 6h12v12H6z',
  restart: 'M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash:
    'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7m4 4v6m4-6v6',
  refresh: 'M21 12a9 9 0 0 1-15.1 6.6M3 12a9 9 0 0 1 15.1-6.6M3 20v-5h5M21 4v5h-5',
  download: 'M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16',
  upload: 'M12 21V9m0 0 4.5 4.5M12 9 7.5 13.5M4 4h16',
  search: 'M20 20l-4.2-4.2M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 13 4.5 4.5L19 7',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-right': 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  alert:
    'M12 9v4.5m0 3.5v.01M10.3 4.2 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9.5V16m0-8v.01',
  link: 'M10 13a5 5 0 0 0 7.5.5l2-2A5 5 0 0 0 12.5 4.5L11 6m3 5a5 5 0 0 0-7.5-.5l-2 2A5 5 0 0 0 11.5 19.5L13 18',
  copy: 'M9 9h10v10a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1V9Zm-4 6H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  menu: 'M4 6h16M4 12h16M4 18h16',
  'arrow-up': 'M12 20V5m0 0-6 6m6-6 6 6',
  filter: 'M3 5h18l-7 8v6l-4 2v-8L3 5Z',
  server:
    'M4 4h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm0 10h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1Zm3-7h.01M7 17h.01',
  image: 'M3 5h18v14H3zM9 11a1.75 1.75 0 1 0 0-3.5A1.75 1.75 0 0 0 9 11Zm-6 7 5-5 3 3 4-4 6 6',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z',
  exit: 'M15 17l5-5-5-5m5 5H9M12 3H5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h7',
};

/** Icons that read better filled than stroked. */
const FILLED = new Set<IconName>(['play', 'stop']);

export function Icon({
  name,
  className = 'h-4 w-4',
  ...props
}: { name: IconName; className?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  const filled = FILLED.has(name);
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className={`shrink-0 ${className}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Small animated ring used inside buttons while a mutation is in flight. */
export function Spinner16({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current/25 border-t-current ${className}`}
    />
  );
}
