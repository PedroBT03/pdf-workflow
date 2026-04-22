import React from 'react';
import { WorkflowTimeline } from './WorkflowTimeline';
import { WorkflowQueue } from './WorkflowQueue';
import { WorkflowActionId, WorkflowQueueItem, WorkflowPathItem } from '../../lib/workflow';

interface WorkflowRailProps {
  activeView: 'executed' | 'queue';
  setActiveView: (view: 'executed' | 'queue') => void;
  batchStatus: string;
  batchStatusDetail: string;
  workflowPath: WorkflowPathItem[];
  plannedWorkflow: WorkflowQueueItem[];
  actionInProgress: WorkflowActionId | null;
  isBatchRunning: boolean;
  isLoading: boolean;
  onToggleSelected: (id: WorkflowActionId) => void;
  onRemove: (id: WorkflowActionId) => void;
  onRunBatch: () => void;
  onClear: () => void;
}

export const WorkflowRail: React.FC<WorkflowRailProps> = ({
  activeView, setActiveView,
  batchStatus, batchStatusDetail,
  workflowPath, plannedWorkflow,
  actionInProgress, isBatchRunning, isLoading,
  onToggleSelected, onRemove, onRunBatch, onClear
}) => {
  const getStatusColor = () => {
    switch (batchStatus) {
      case 'running': return 'text-sky-200 bg-sky-950/40 border-sky-900';
      case 'paused': return 'text-amber-200 bg-amber-950/40 border-amber-900';
      case 'completed': return 'text-emerald-200 bg-emerald-950/40 border-emerald-900';
      case 'failed': return 'text-red-200 bg-red-950/40 border-red-900';
      default: return 'text-zinc-300 bg-zinc-900/40 border-zinc-700';
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-5 h-170 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm uppercase tracking-[0.2em] text-zinc-500 font-semibold">Workflow</h2>
        <div className="text-[11px] text-zinc-500">
          {activeView === 'executed' ? 'Executed steps' : 'Current queue'}
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="mb-3 grid grid-cols-2 gap-2 p-1 bg-zinc-950/50 rounded-2xl">
        <button
          onClick={() => setActiveView('executed')}
          className={`py-2 rounded-xl text-xs font-semibold transition-all ${
            activeView === 'executed' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Executed
        </button>
        <button
          onClick={() => setActiveView('queue')}
          className={`py-2 rounded-xl text-xs font-semibold transition-all ${
            activeView === 'queue' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Planned
        </button>
      </div>

      {/* Batch Status Badge */}
      <div className={`mb-4 text-xs p-3 rounded-xl border transition-colors ${getStatusColor()}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold">Batch Status</span>
          <span className="uppercase tracking-widest text-[10px] opacity-70">{batchStatus}</span>
        </div>
        <div className="mt-1 opacity-80 leading-relaxed font-medium">{batchStatusDetail}</div>
      </div>

      {/* Content Rendering */}
      {activeView === 'executed' ? (
        <WorkflowTimeline 
          workflowPath={workflowPath} 
          actionInProgress={actionInProgress} 
          isBatchRunning={isBatchRunning}
        />
      ) : (
        <WorkflowQueue 
          items={plannedWorkflow}
          isBatchRunning={isBatchRunning}
          isLoading={isLoading}
          onToggleSelected={onToggleSelected}
          onRemove={onRemove}
          onRunBatch={onRunBatch}
          onClear={onClear}
        />
      )}
    </div>
  );
};