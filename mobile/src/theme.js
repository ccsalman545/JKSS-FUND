// src/theme.js
// "Aurora" design tokens — central palette, light/dark themes, shape scale.

export const palette = {
  primary: '#6366F1',
  primaryDark: '#4F46E5',
  primarySoft: '#EEF0FE',
  violet: '#8B5CF6',
  accent: '#F59E0B',
  accentSoft: '#FEF3E2',
  success: '#10B981',
  successSoft: '#E6F7F0',
  danger: '#F43F5E',
  dangerSoft: '#FDE9ED',
  info: '#0EA5E9',
  infoSoft: '#E5F4FD',
  white: '#FFFFFF',
};

export const lightTheme = {
  mode: 'light',
  background: '#F6F7FB',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F3F9',
  text: '#0F172A',
  textMuted: '#64748B',
  textFaint: '#94A3B8',
  border: '#E9ECF4',
  cardShadow: 'rgba(15, 23, 42, 0.07)',
  tabBar: '#FFFFFF',
  overlay: 'rgba(15, 23, 42, 0.45)',
  gradient: ['#4F46E5', '#7C3AED'],
  gradientAccent: ['#F59E0B', '#F97316'],
  gradientSoft: ['#EEF0FE', '#F6F1FE'],
  glass: 'rgba(255, 255, 255, 0.14)',
  glassBorder: 'rgba(255, 255, 255, 0.28)',
};

export const darkTheme = {
  mode: 'dark',
  background: '#0B0F1A',
  surface: '#151B2C',
  surfaceAlt: '#1D2539',
  text: '#F4F6FB',
  textMuted: '#94A3B8',
  textFaint: '#5B6B85',
  border: '#232D47',
  cardShadow: 'rgba(0, 0, 0, 0.4)',
  tabBar: '#101626',
  overlay: 'rgba(2, 6, 16, 0.62)',
  gradient: ['#5B54F0', '#8B5CF6'],
  gradientAccent: ['#F59E0B', '#FB923C'],
  gradientSoft: ['#1E2340', '#262044'],
  glass: 'rgba(255, 255, 255, 0.14)',
  glassBorder: 'rgba(255, 255, 255, 0.28)',
};

export const radius = { sm: 12, md: 16, lg: 20, xl: 26, pill: 999 };
