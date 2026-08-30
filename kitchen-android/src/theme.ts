// Theme — high-contrast dark kitchen palette (brand amber accent) with a
// light option. Large type and big touch targets live in the components.

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string;
  danger: string;
  success: string;
  warning: string;
  info: string;
  statusNew: string;
  statusAccepted: string;
  statusPreparing: string;
  statusReady: string;
  statusDone: string;
  statusCancelled: string;
  online: string;
  offline: string;
  error: string;
}

export const dark: ThemeColors = {
  background: '#0B0E13',
  surface: '#151A23',
  surfaceAlt: '#1C232F',
  border: '#2A3242',
  text: '#F2F5FA',
  textDim: '#9AA6B8',
  accent: '#E7C54A',
  accentText: '#1A1405',
  danger: '#FF5D5D',
  success: '#3DDC84',
  warning: '#FFB13D',
  info: '#6DB1FF',
  statusNew: '#FF5D5D',
  statusAccepted: '#6DB1FF',
  statusPreparing: '#FFB13D',
  statusReady: '#3DDC84',
  statusDone: '#9AA6B8',
  statusCancelled: '#8B2E2E',
  online: '#3DDC84',
  offline: '#FF5D5D',
  error: '#FF5D5D',
};

export const light: ThemeColors = {
  ...dark,
  background: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF1F7',
  border: '#D6DCE8',
  text: '#151A23',
  textDim: '#5B6678',
};

export const STATUS_COLORS: Record<string, keyof ThemeColors> = {
  New: 'statusNew',
  Accepted: 'statusAccepted',
  Preparing: 'statusPreparing',
  Ready: 'statusReady',
  Completed: 'statusDone',
  Cancelled: 'statusCancelled',
  Rejected: 'statusCancelled',
  Draft: 'textDim',
};
