import React from 'react';
import { WorkflowActionId, WORKFLOW_ACTION_LABELS } from '../../lib/workflow';

interface ActionSelectorProps {
  selectedAction: WorkflowActionId;
  setSelectedAction: (action: WorkflowActionId) => void;
  isActionInProgress: boolean;
  isLoading: boolean;
  isBatchRunning: boolean;
  canRunAction: boolean;
  onRunAction: () => void;
  onAddActionToWorkflow: () => void;
  workflowMessage: { type: 'success' | 'error' | 'info'; message: string } | null;
  children: React.ReactNode; // Specific action forms are rendered here (ExtractionSettings, etc.)
}

export const ActionSelector: React.FC<ActionSelectorProps> = ({
  selectedAction,
  setSelectedAction,
  isActionInProgress,
  isLoading,
  isBatchRunning,
  canRunAction,
  onRunAction,
  onAddActionToWorkflow,
  workflowMessage,
  children,
}) => {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-5 h-full flex flex-col gap-5">
      <div>
        <h2 className="text-sm uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-4">
          Actions
        </h2>

        <div className="grid gap-3">
          {/* Action selection dropdown */}
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Action</label>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value as WorkflowActionId)}
              disabled={isActionInProgress}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 transition-colors"
            >
              {Object.entries(WORKFLOW_ACTION_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Space for action-specific settings (children) */}
          <div className="mt-2">
            {children}
          </div>

          {/* Botões de Execução Genéricos */}
          <div className="flex flex-col gap-2 mt-4">
            <button
              onClick={onRunAction}
              disabled={isLoading || isActionInProgress || isBatchRunning || !canRunAction}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-3 rounded-xl font-semibold transition-all"
            >
              {isActionInProgress && selectedAction === 'edit_json'
                ? 'Edit action in progress'
                : isLoading
                ? 'Running action...'
                : selectedAction === 'block_extractor'
                ? 'Run block extractor'
                : selectedAction === 'text_finder' || selectedAction === 'block_finder'
                ? 'Generate highlighted artifact'
                : 'Run action'}
            </button>

            <button
              onClick={onAddActionToWorkflow}
              disabled={isActionInProgress || isBatchRunning}
              className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-500 text-zinc-200 py-2 rounded-xl font-semibold transition-all text-sm"
            >
              Add to workflow
            </button>
          </div>
        </div>

        {/* Workflow feedback messages */}
        {workflowMessage && (
          <div
            className={`mt-4 text-xs p-3 rounded-xl border wrap-break-word ${
              workflowMessage.type === 'error'
                ? 'text-red-200 bg-red-950/40 border-red-900'
                : workflowMessage.type === 'success'
                ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900'
                : 'text-sky-200 bg-sky-950/40 border-sky-900'
            }`}
          >
            {workflowMessage.message}
          </div>
        )}
      </div>

      <div className="mt-auto text-xs text-zinc-400 bg-zinc-800/40 p-3 rounded-xl border border-zinc-700">
        Only one workflow action can run at a time. Finish the current action before starting the next.
      </div>
    </div>
  );
};