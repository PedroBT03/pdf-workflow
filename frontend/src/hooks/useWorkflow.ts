import { useState, useCallback } from 'react';
import { WorkflowActionId, WorkflowQueueItem, WorkflowPathItem, WORKFLOW_ACTION_LABELS } from '../lib/workflow';

export const useWorkflow = () => {
  const [plannedWorkflow, setPlannedWorkflow] = useState<WorkflowQueueItem[]>([]);
  const [workflowQueue, setWorkflowQueue] = useState<WorkflowQueueItem[]>([]);
  const [workflowPath, setWorkflowPath] = useState<WorkflowPathItem[]>([]);
  
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'failed'>('idle');
  const [batchStatusDetail, setBatchStatusDetail] = useState('No batch run started yet.');
  
  const [actionInProgress, setActionInProgress] = useState<WorkflowActionId | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [activeWorkflowView, setActiveWorkflowView] = useState<'executed' | 'queue'>('executed');

  const appendWorkflowPath = useCallback((action: WorkflowActionId, status: 'done' | 'failed' | 'skipped', detail?: string) => {
    const item: WorkflowPathItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      label: WORKFLOW_ACTION_LABELS[action],
      status,
      detail,
      timestamp: new Date().toLocaleTimeString(),
    };
    setWorkflowPath(prev => [...prev, item]);
  }, []);

  const addToQueue = (item: WorkflowQueueItem) => {
    setPlannedWorkflow(prev => {
      if (prev.some(i => i.actionId === item.actionId)) return prev;
      return [...prev, item];
    });
  };

  const removeFromQueue = (actionId: WorkflowActionId) => {
    setPlannedWorkflow(prev => prev.filter(i => i.actionId !== actionId));
  };

  const toggleActionSelected = (actionId: WorkflowActionId) => {
    setPlannedWorkflow(prev => prev.map(item => 
      item.actionId === actionId ? { ...item, selected: !item.selected } : item
    ));
  };

  const clearQueue = () => setPlannedWorkflow([]);

  const resetWorkflowState = useCallback(() => {
    setPlannedWorkflow([]);
    setWorkflowQueue([]);
    setWorkflowPath([]);
    setIsBatchRunning(false);
    setBatchStatus('idle');
    setBatchStatusDetail('No batch run started yet.');
    setActionInProgress(null);
    setWorkflowMessage(null);
    setActiveWorkflowView('executed');
  }, []);

  return {
    plannedWorkflow, setPlannedWorkflow,
    workflowQueue, setWorkflowQueue,
    workflowPath, setWorkflowPath,
    isBatchRunning, setIsBatchRunning,
    batchStatus, setBatchStatus,
    batchStatusDetail, setBatchStatusDetail,
    actionInProgress, setActionInProgress,
    workflowMessage, setWorkflowMessage,
    activeWorkflowView, setActiveWorkflowView,
    appendWorkflowPath,
    addToQueue,
    removeFromQueue,
    toggleActionSelected,
    clearQueue,
    resetWorkflowState
  };
};