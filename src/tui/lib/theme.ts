export const theme = {
  accent: '#fab283',
  accentDim: '#be3c00',
  text: '#e0e0e0',
  textDim: '#808080',
  bg: '#1a1a2e',
  bgAlt: '#16213e',
  success: '#4ade80',
  error: '#f87171',
  warning: '#fbbf24',
  info: '#60a5fa',
  border: '#333355',
} as const;

/** Shared color props for all <select> components. */
export const selectColors = {
  textColor: theme.textDim,
  focusedBackgroundColor: 'transparent',
  focusedTextColor: theme.text,
  selectedBackgroundColor: theme.accentDim,
  selectedTextColor: theme.text,
} as const;
