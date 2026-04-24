import React, { useState } from 'react';
import { GripVertical } from 'lucide-react';
import { WorkflowQueueItem, WorkflowActionId, WORKFLOW_ACTION_LABELS } from '../../lib/workflow';

interface WorkflowQueueProps {
  items: WorkflowQueueItem[];
  isBatchRunning: boolean;
  isLoading: boolean;
  onToggleSelected: (id: WorkflowActionId) => void;
  onRemove: (id: WorkflowActionId) => void;
  onReorder: (draggedActionId: WorkflowActionId, targetActionId: WorkflowActionId) => void;
  onRunBatch: () => void;
  onClear: () => void;
}

export const WorkflowQueue: React.FC<WorkflowQueueProps> = ({
  items,
  isBatchRunning,
  isLoading,
  onToggleSelected,
  onRemove,
  onReorder,
  onRunBatch,
  onClear,
}) => {
  const [draggedActionId, setDraggedActionId] = useState<WorkflowActionId | null>(null);

  const handleDragStart = (actionId: WorkflowActionId) => {
    setDraggedActionId(actionId);
  };

  const handleDragEnd = () => {
    setDraggedActionId(null);
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>, targetActionId: WorkflowActionId) => {
    if (!draggedActionId || draggedActionId === targetActionId || isBatchRunning) return;
    event.preventDefault();
    onReorder(draggedActionId, targetActionId);
  };

  return (
    <div className="workflow-scroll flex-1 overflow-y-auto px-1 py-1 space-y-4">
      {items.length === 0 ? (
        <div className="rounded-2xl border border-zinc-700 border-dashed bg-zinc-950/50 text-zinc-500 px-4 py-8 text-sm text-center">
          Workflow is empty. <br/> Add actions from the left panel.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div
              key={`${item.actionId}-${index}`}
              onDragOver={(event) => handleDragOver(event, item.actionId)}
              className={`rounded-2xl border px-4 py-3 text-sm transition-all ${
                draggedActionId === item.actionId ? 'ring-2 ring-blue-500/60 border-blue-500/60 bg-zinc-900/80' :
                item.selected ? 'border-zinc-600 bg-zinc-900/60 text-zinc-200' : 'border-zinc-800 bg-zinc-950/20 text-zinc-500'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => onToggleSelected(item.actionId)}
                    disabled={isBatchRunning}
                    className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-600 disabled:opacity-30"
                  />
                  <span className={`font-semibold ${item.selected ? '' : 'line-through opacity-50'}`}>
                    {index + 1}. {WORKFLOW_ACTION_LABELS[item.actionId]}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  {!isBatchRunning ? (
                    <button
                      onClick={() => onRemove(item.actionId)}
                      className="text-[10px] uppercase tracking-widest text-zinc-500 hover:text-red-400 transition-colors"
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="text-[10px] uppercase tracking-widest text-zinc-600">locked</span>
                  )}

                  <button
                    type="button"
                    draggable={!isBatchRunning}
                    onDragStart={() => handleDragStart(item.actionId)}
                    onDragEnd={handleDragEnd}
                    disabled={isBatchRunning}
                    aria-label={`Drag to reorder ${WORKFLOW_ACTION_LABELS[item.actionId]}`}
                    className="flex items-center justify-center w-8 h-8 rounded-lg border border-zinc-700 bg-zinc-950/40 text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 disabled:opacity-30 disabled:cursor-not-allowed cursor-grab active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="text-[10px] text-zinc-500 px-1 italic">
            * Unchecked actions stay in the queue and can be run later. Drag the handle to reorder.
          </div>

          <div className="pt-2 space-y-2">
            <button
              onClick={onRunBatch}
              disabled={isLoading || isBatchRunning || items.every(i => !i.selected)}
              className="w-full bg-white text-black hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 py-3 rounded-xl font-bold transition-all shadow-lg"
            >
              {isBatchRunning ? 'Executing Batch...' : 'Start Workflow Execution'}
            </button>

            <button
              onClick={onClear}
              disabled={isBatchRunning || items.length === 0}
              className="w-full bg-zinc-800/50 hover:bg-zinc-800 text-zinc-400 py-2 rounded-xl font-semibold transition-all text-xs border border-zinc-700/50"
            >
              Clear Queue
            </button>
          </div>
        </div>
      )}
    </div>
  );
};