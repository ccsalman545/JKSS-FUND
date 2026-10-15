// src/theme.js
// "Aurora M3" — Material 3 tonal design tokens.
// Each theme carries its own semantic colors so text/icons meet contrast
// targets in both light and dark. Shape scale follows M3:
// small 8 · medium 12 · large 16 · extraLarge 28 · full pill.

// Brand constants (gradients, tab tint, charts) — same in both themes.
export const palette = {
  primary: '#6366F1',
  gradientFrom: '#4338CA',
  gradientTo: '#7C3AED',
  accent: '#F59E0B',
};

const LIGHT = {
  mode: 'light',
  // ---- M3 surface tonal scale ----
  background: '#F7F4FB',
  surface: '#FFFFFF',
  surfaceContainerLow: '#F5F2F9',
  surfaceContainer: '#EFEAF4',
  surfaceContainerHigh: '#E9E4EE',
  surfaceAlt: '#F1EEF6', // filled text fields, icon bubbles (light tone)
  border: '#E3DEEA',
  outline: '#8A8496',
  // ---- M3 text roles ----
  text: '#1C1B22',          // onSurface
  textMuted: '#55525E',     // onSurfaceVariant (~7:1 on surface)
  textFaint: '#79747E',     // outline (captions/dates only)
  // ---- M3 brand roles ----
  primary: '#5A5BD6',
  primarySoft: '#E4E1FF',   // primaryContainer
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#1A1468',
  secondaryContainer: '#E7E1F4',
  onSecondaryContainer: '#241D38',
  violet: '#6D28D9',
  violetSoft: '#EDE9FE',
  // ---- M3 semantic roles ----
  success: '#15803D',
  successSoft: '#DCFCE7',
  danger: '#BE123C',
  dangerSoft: '#FFE4E6',
  accent: '#B45309',
  accentSoft: '#FEF3C7',
  info: '#0369A1',
  infoSoft: '#E0F2FE',
  // ---- state + chrome ----
  cardShadow: 'rgba(27, 18, 104, 0.08)',
  tabBar: '#EFEAF4',
  overlay: 'rgba(28, 27, 34, 0.45)',
  ripple: 'rgba(28, 27, 34, 0.08)',
  gradient: ['#4F46E5', '#7C3AED'],
  gradientAccent: ['#F59E0B', '#F97316'],
  gradientSoft: ['#EEF0FE', '#F6F1FE'],
  glass: 'rgba(255, 255, 255, 0.14)',
  glassBorder: 'rgba(255, 255, 255, 0.28)',
};

const DARK = {
  mode: 'dark',
  // ---- M3 surface tonal scale ----
  background: '#121017',
  surface: '#1A1722',
  surfaceContainerLow: '#1E1B27',
  surfaceContainer: '#231F2E',
  surfaceContainerHigh: '#2A2636',
  surfaceAlt: '#262231',
  border: '#322D40',
  outline: '#948EA3',
  // ---- M3 text roles ----
  text: '#ECE8F4',          // onSurface
  textMuted: '#A9A2BA',     // onSurfaceVariant
  textFaint: '#8E87A0',     // outline (captions/dates only)
  // ---- M3 brand roles ----
  primary: '#C7C4FF',
  primarySoft: 'rgba(199, 196, 255, 0.14)',
  onPrimary: '#2A2485',
  onPrimaryContainer: '#DCD9FF',
  secondaryContainer: '#453F58',
  onSecondaryContainer: '#E6DFF2',
  violet: '#C4B5FD',
  violetSoft: 'rgba(196, 181, 253, 0.14)',
  // ---- M3 semantic roles ----
  success: '#4ADE80',
  successSoft: 'rgba(74, 222, 128, 0.14)',
  danger: '#FB7185',
  dangerSoft: 'rgba(251, 113, 133, 0.14)',
  accent: '#FBBF24',
  accentSoft: 'rgba(251, 191, 36, 0.14)',
  info: '#38BDF8',
  infoSoft: 'rgba(56, 189, 248, 0.14)',
  // ---- state + chrome ----
  cardShadow: 'rgba(0, 0, 0, 0.5)',
  tabBar: '#1E1B27',
  overlay: 'rgba(0, 0, 0, 0.6)',
  ripple: 'rgba(236, 232, 244, 0.10)',
  gradient: ['#6C63F2', '#8B5CF6'],
  gradientAccent: ['#F59E0B', '#FB923C'],
  gradientSoft: ['#1E2340', '#262044'],
  glass: 'rgba(255, 255, 255, 0.14)',
  glassBorder: 'rgba(255, 255, 255, 0.28)',
};

export const lightTheme = LIGHT;
export const darkTheme = DARK;

// M3 shape scale.
export const radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
};
