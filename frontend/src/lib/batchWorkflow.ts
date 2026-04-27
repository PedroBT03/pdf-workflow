/**
 * Batch workflow orchestration and execution logic
 */

import { WorkflowActionId } from '../lib/workflow';

export interface BatchWorkflowDependencies {
  workflow: any;
  artifacts: any;
  onSetProcessor: (p: string) => void;
  onSetLayoutModel: (m: string) => void;
  onSetTableModel: (m: string) => void;
  onSetUpgradeMode: (m: any) => void;
  onSetBeUseExistingJson: (b: boolean) => void;
  onSetSelectedAction: (a: WorkflowActionId) => void;
  onHandleExtract: () => Promise<boolean>;
  onHandleUpgrade: () => Promise<boolean>;
  onHandleTextFinder: () => Promise<boolean>;
  onHandleBlockFinder: () => Promise<boolean>;
  onHandleBlockExtractor: () => Promise<boolean>;
}

export const continueBatchWorkflow = async (
  queueOverride: any[] | undefined,
  deps: BatchWorkflowDependencies,
  onQueueUpdate: (queue: any[]) => void,
  onPendingBatchQueueUpdate: (queue: any[] | null) => void
): Promise<void> => {
  let queue = queueOverride ?? deps.workflow.workflowQueue;
  let extractedInThisBatchRun = false;

  while (queue.length > 0) {
    const [nextItem, ...rest] = queue;
    const nextAction = nextItem.actionId;

    if (!nextItem.selected) {
      deps.workflow.appendWorkflowPath(nextAction, 'skipped', 'Deselected in workflow queue.');
      queue = rest;
      deps.workflow.setWorkflowQueue(queue);
      await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 0));
      continue;
    }

    deps.onSetProcessor(nextItem.processor);
    deps.onSetLayoutModel(nextItem.pdf2dataLayoutModel);
    deps.onSetTableModel(nextItem.pdf2dataTableModel);
    deps.onSetUpgradeMode(nextItem.upgradeMode);
    deps.onSetBeUseExistingJson(Boolean(nextItem.blockExtractorUseExistingJson ?? false));
    deps.onSetSelectedAction(nextAction);

    if (nextAction === 'edit_json') {
      deps.workflow.setActionInProgress('edit_json');
      deps.workflow.setWorkflowQueue(rest);
      deps.workflow.setBatchStatus('paused');
      return;
    }

    let ok = false;
    if (nextAction === 'extract_json_from_pdf') ok = await deps.onHandleExtract();
    else if (nextAction === 'upgrade_json') ok = await deps.onHandleUpgrade();
    else if (nextAction === 'text_finder') ok = await deps.onHandleTextFinder();
    else if (nextAction === 'block_finder') ok = await deps.onHandleBlockFinder();
    else if (nextAction === 'block_extractor') ok = await deps.onHandleBlockExtractor();

    if (!ok) {
      deps.workflow.setIsBatchRunning(false);
      deps.workflow.setWorkflowQueue([]);
      deps.workflow.setBatchStatus('failed');
      return;
    }

    if (nextAction === 'extract_json_from_pdf') {
      extractedInThisBatchRun = true;
    }

    queue = rest;
    deps.workflow.setWorkflowQueue(queue);
    await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 0));
  }

  deps.workflow.setIsBatchRunning(false);
  deps.workflow.setWorkflowQueue([]);
  deps.workflow.setBatchStatus('completed');
};

export const runBatchWorkflow = async (
  plannedWorkflow: any[],
  deps: BatchWorkflowDependencies,
  onQueueUpdate: (queue: any[]) => void,
  onPendingBatchQueueUpdate: (queue: any[] | null) => void
): Promise<void> => {
  const selectedQueue = plannedWorkflow.filter((item) => item.selected);
  if (!selectedQueue.length) return;

  deps.workflow.setIsBatchRunning(true);
  deps.workflow.setActiveWorkflowView('executed');
  deps.workflow.setWorkflowQueue(selectedQueue);
  deps.workflow.setBatchStatus('running');
  await continueBatchWorkflow(selectedQueue, deps, onQueueUpdate, onPendingBatchQueueUpdate);
};
