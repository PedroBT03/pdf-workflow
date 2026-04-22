export type SelectedTarget =
  | { kind: 'block'; blockIndex: number }
  | { kind: 'tableCell'; blockIndex: number; row: number; col: number }
  | { kind: 'tableCaption'; blockIndex: number; captionIndex: number };

export interface FeedbackMessage {
  type: 'success' | 'error' | 'info';
  message: string;
}

export interface ProcessorOption {
  alias: string;
  label: string;
  enabled: boolean;
  reason?: string | null;
}