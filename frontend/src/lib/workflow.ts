// Workflow types and labels used by the action-based UI and execution path.

export type WorkflowActionId = 'extract_json_from_pdf' | 'edit_json' | 'upgrade_json' | 'text_finder' | 'block_finder';
export type UpgradeMode = 'text' | 'figures' | 'both';

export type WorkflowPathItem = {
  id: string;
  action: WorkflowActionId;
  label: string;
  status: 'done' | 'failed' | 'skipped';
  detail?: string;
  timestamp: string;
};

export const WORKFLOW_ACTION_LABELS: Record<WorkflowActionId, string> = {
  extract_json_from_pdf: 'Extract JSON from PDF',
  edit_json: 'Edit JSON',
  upgrade_json: 'Upgrade JSON',
  text_finder: 'Text Finder',
  block_finder: 'Block Finder',
};

export const UPGRADE_MODE_LABELS: Record<UpgradeMode, string> = {
  text: 'Text only (unicode fixes)',
  figures: 'Figures only (merge close figures)',
  both: 'Text + Figures',
};
