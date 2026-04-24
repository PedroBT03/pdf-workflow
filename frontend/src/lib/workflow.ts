// Workflow types and labels used by the action-based UI and execution path.

export type WorkflowActionId = 'extract_json_from_pdf' | 'edit_json' | 'upgrade_json' | 'text_finder' | 'block_finder' | 'block_extractor';
export type UpgradeMode = 'text' | 'figures' | 'both';

export type WorkflowPathItem = {
  id: string;
  action: WorkflowActionId;
  label: string;
  status: 'done' | 'failed' | 'skipped' | 'running';
  detail?: string;
  timestamp: string;
};

export type WorkflowQueueItem = {
  actionId: WorkflowActionId;
  processor: string;
  pdf2dataLayoutModel: string;
  pdf2dataTableModel: string;
  upgradeMode: UpgradeMode;
  blockExtractorUseExistingJson?: boolean;
  textFinderWordCountThreshold: number;
  textFinderFindParagraphs: boolean;
  textFinderFindSectionHeaders: boolean;
  textFinderCountDuplicates: boolean;
  blockFinderFindTables: boolean;
  blockFinderFindFigures: boolean;
  selected: boolean;
};

export const WORKFLOW_ACTION_LABELS: Record<WorkflowActionId, string> = {
  extract_json_from_pdf: 'Extract JSON from PDF',
  edit_json: 'Edit JSON',
  upgrade_json: 'Upgrade JSON',
  text_finder: 'Text Finder',
  block_finder: 'Block Finder',
  block_extractor: 'Block Extractor',
};

export const UPGRADE_MODE_LABELS: Record<UpgradeMode, string> = {
  text: 'Text only (unicode fixes)',
  figures: 'Figures only (merge close figures)',
  both: 'Text + Figures',
};
