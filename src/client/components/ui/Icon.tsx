// Inline SVG icon set (plan §8.3). Decorative only: `aria-hidden="true"` and `focusable="false"`, so every use
// site must supply its own accessible name elsewhere (a visible label, `aria-label`, etc).

export type IconName =
  | 'dashboard'
  | 'inventory'
  | 'shipments'
  | 'routes'
  | 'analytics'
  | 'alerts'
  | 'import'
  | 'menu'
  | 'close'
  | 'search'
  | 'refresh'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-up'
  | 'chevron-down'
  | 'sort'
  | 'warning'
  | 'critical'
  | 'info'
  | 'check'
  | 'external-link'
  | 'upload';

export interface IconProps {
  name: IconName;
  size?: number;
}

const PATHS: Record<IconName, string> = {
  dashboard: 'M3 3h8v8H3V3zm10 0h8v5h-8V3zM3 13h8v8H3v-8zm10 3h8v5h-8v-5z',
  inventory: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10',
  shipments: 'M3 7h11v10H3V7zm11 3h4l3 3v4h-7v-7zM6.5 21a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm11 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  routes: 'M3 15h6v6H3zM15 6a3 3 0 106 0 3 3 0 00-6 0zM9 18h1.5a2 2 0 002-2V8a2 2 0 012-2h.5',
  analytics: 'M4 20V10m6 10V4m6 16V13m6 7V8',
  alerts: 'M12 3l9 16H3l9-16zm0 6v5m0 3h.01',
  import: 'M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 001 1h14a1 1 0 001-1v-3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-4.35-4.35',
  refresh: 'M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-4.9M20 15a8 8 0 01-14 4.9',
  'chevron-left': 'M15 6l-6 6 6 6',
  'chevron-right': 'M9 6l6 6-6 6',
  'chevron-up': 'M6 15l6-6 6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  sort: 'M8 9l4-5 4 5M8 15l4 5 4-5',
  warning: 'M12 3l9 16H3l9-16zm0 6v5m0 3h.01',
  critical: 'M12 2l10 18H2L12 2zm0 7v5m0 3h.01',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0-13h.01M11 11h1v6h1',
  check: 'M5 13l4 4L19 7',
  'external-link': 'M14 4h6v6M20 4L10 14M6 6H5a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1v-1',
  upload: 'M12 21V9m0 0l-4 4m4-4l4 4M4 4h16'
};

/** A decorative inline SVG icon; the caller is responsible for any accessible name. */
export function Icon({ name, size = 18 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
