// Design tokens — professional restaurant order terminal (Uber Eats merchant
// style): white/neutral surfaces, dark text, subtle grey borders, restrained
// status colours only. No gradients, no decoration.

export const colors = {
  bg: '#F7F7F8',
  surface: '#FFFFFF',
  surfaceAlt: '#F2F3F4',
  border: '#E4E6E8',
  borderStrong: '#C9CDD1',

  text: '#111827',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',

  // Single restrained accent (actions, live indicator).
  accent: '#059669',
  accentSoft: '#ECFDF5',
  onAccent: '#FFFFFF',

  danger: '#DC2626',
  dangerSoft: '#FEF2F2',
  warning: '#D97706',
  warningSoft: '#FFFBEB',
  info: '#2563EB',
  infoSoft: '#EFF6FF',

  // Status colours — restrained.
  new: '#059669',
  preparing: '#D97706',
  ready: '#2563EB',
  completed: '#6B7280',

  live: '#059669',
  offline: '#DC2626',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const type = {
  // Kitchen-first scale: readable at arm's length on a tablet.
  title: 24,
  heading: 18,
  body: 15,
  bodyLarge: 17,
  cardTitle: 17,
  cardBody: 15,
  small: 13,
  tiny: 11,
} as const;
