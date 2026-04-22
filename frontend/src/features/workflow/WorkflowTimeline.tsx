import React from 'react';
import { WorkflowPathItem, WorkflowActionId, WORKFLOW_ACTION_LABELS } from '../../lib/workflow';

interface WorkflowTimelineProps {
  workflowPath: WorkflowPathItem[];
  actionInProgress: WorkflowActionId | null;
  isBatchRunning: boolean;
}

export const WorkflowTimeline: React.FC<WorkflowTimelineProps> = ({
  workflowPath,
  actionInProgress,
  isBatchRunning,
}) => {
  // Combine historical path with current active action for the preview
  const workflowPreview = workflowPath.length
    ? workflowPath.map((item) => ({ ...item }))
    : [
        {
          id: 'empty',
          action: 'extract_json_from_pdf' as WorkflowActionId,
          label: 'No actions executed yet',
          status: 'done' as const,
          detail: 'Run an action from the left panel.',
          timestamp: '',
        },
      ];

  if (actionInProgress) {
    workflowPreview.push({
      id: `running-${actionInProgress}`,
      action: actionInProgress,
      label: WORKFLOW_ACTION_LABELS[actionInProgress],
      status: 'running' as any, // Temporary status for UI
      detail: isBatchRunning ? 'Currently running inside batch workflow.' : 'Currently running.',
      timestamp: new Date().toLocaleTimeString(),
    });
  }

  return (
    <div className="workflow-scroll flex-1 overflow-y-auto pr-1 space-y-3">
      {workflowPreview.map((item, index) => (
        <div key={item.id} className="flex flex-col items-stretch">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm transition-all ${
              item.id === 'empty' ? 'border-zinc-700 bg-zinc-950/50 text-zinc-400' :
              item.status === 'running' ? 'border-sky-900 bg-sky-950/35 text-sky-100 shadow-[0_0_15px_rgba(14,165,233,0.1)]' :
              item.status === 'skipped' ? 'border-zinc-700 bg-zinc-950/35 text-zinc-400' :
              item.status === 'done' ? 'border-emerald-900 bg-emerald-950/35 text-emerald-100' :
              'border-red-900 bg-red-950/35 text-red-100'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">{item.label}</span>
              <span className="text-[11px] uppercase tracking-[0.18em] opacity-70">
                {item.id === 'empty' ? 'idle' : item.status}
              </span>
            </div>
            {item.detail && <div className="mt-2 text-xs text-inherit opacity-80">{item.detail}</div>}
            {item.timestamp && <div className="mt-2 text-[11px] opacity-60 font-mono">{item.timestamp}</div>}
          </div>
          
          {/* Connector Line */}
          {index < workflowPreview.length - 1 && (
            <div className="flex items-center justify-center py-2 text-zinc-500">
              <div className="h-4 w-px bg-zinc-700" />
              <span className="mx-2 text-xs">↓</span>
              <div className="h-4 w-px bg-zinc-700" />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};