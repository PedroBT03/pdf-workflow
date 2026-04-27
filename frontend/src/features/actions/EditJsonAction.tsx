import React from 'react';
import { CheckCircle2, SquarePen, Plus } from 'lucide-react';
import { SelectedTarget, FeedbackMessage } from '../../types';

interface EditJsonActionProps {
  editSessionEnabled: boolean;
  isPendingNewBlock: boolean;
  selectedTarget: SelectedTarget | null;
  selectedBlock: any;
  selectedContent: string;
  setSelectedContent: (val: string) => void;
  onSaveBlock: () => void;
  onFinishEditing: () => void;
  onDrawBlockToggle?: (active: boolean) => void;
  drawBlockActive?: boolean;
  isLoading: boolean;
  feedback: FeedbackMessage | null;
}

export const EditJsonAction: React.FC<EditJsonActionProps> = ({
  editSessionEnabled,
  isPendingNewBlock,
  selectedTarget,
  selectedBlock,
  selectedContent,
  setSelectedContent,
  onSaveBlock,
  onFinishEditing,
  onDrawBlockToggle,
  drawBlockActive,
  isLoading,
  feedback,
}) => {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 space-y-3">
      {/* Header: icon + title + description */}
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300">
          <SquarePen className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">Edit JSON</div>
          <div className="mt-1 text-[11px] leading-snug text-zinc-500">Select a block in the PDF and edit its metadata directly.</div>
        </div>
      </div>

      {!editSessionEnabled && (
        <div className="text-xs text-zinc-500 bg-zinc-800/50 p-3 rounded-xl">
          Click "Run action" to start an editing session.
        </div>
      )}

      {editSessionEnabled && (
        <>
          {drawBlockActive && (
            <div className="text-xs text-blue-200 bg-blue-950/30 border border-blue-900/60 p-3 rounded-xl">
              Draw mode is active: drag on the PDF to define a box. Then write the content and click "Add new block".
            </div>
          )}

          {/* Selection Info */}
          <div className="text-xs text-zinc-400 bg-zinc-800/50 p-3 rounded-xl">
            {isPendingNewBlock
              ? 'New box ready: write content below and click "Add new block".'
              : !selectedTarget 
              ? "Click a box on the PDF to edit its metadata."
              : `Selected ${selectedTarget.kind}: #${selectedTarget.blockIndex + 1}${
                  selectedTarget.kind === 'tableCell' ? ` R${selectedTarget.row + 1} C${selectedTarget.col + 1}` : ''
                }`
            }
          </div>

          {(selectedTarget || isPendingNewBlock) && (
            <div className="flex flex-col gap-3">
              {selectedBlock && (
                <div className="text-xs text-zinc-500 bg-zinc-800/40 p-2 rounded-lg">
                  Page: {selectedBlock?.page ?? 'N/A'}
                </div>
              )}
              <textarea
                className="w-full h-40 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-sm text-zinc-300 focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all shadow-inner"
                value={selectedContent}
                onChange={(e) => setSelectedContent(e.target.value)}
                placeholder="Edit block content..."
              />
            </div>
          )}

          {/* Interaction Buttons */}
          <div className="space-y-3">
            <button
              onClick={onSaveBlock}
              disabled={isLoading || (!selectedTarget && !isPendingNewBlock) || (isPendingNewBlock && !selectedContent.trim())}
              className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-100 py-2 rounded-2xl font-semibold transition-all text-sm flex items-center justify-center gap-2"
            >
              {isLoading ? 'Saving...' : isPendingNewBlock ? 'Add new block' : 'Save block changes'}
              <CheckCircle2 className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onDrawBlockToggle?.(!drawBlockActive)}
              className={`w-full py-2 rounded-2xl font-semibold transition-all text-sm flex items-center justify-center gap-2 ${
                drawBlockActive
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-600/30'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
              }`}
            >
              <Plus className="w-4 h-4" /> {drawBlockActive ? 'Drawing (ESC to cancel)' : 'Draw new block'}
            </button>

            <button
              onClick={onFinishEditing}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-800 text-white py-3 rounded-2xl font-semibold transition-all"
            >
              Finish editing
            </button>
          </div>

          {/* Panel Feedback */}
          {feedback && (
            <div className={`text-xs p-3 rounded-xl border ${
              feedback.type === 'error' ? 'text-red-200 bg-red-950/40 border-red-900' :
              feedback.type === 'success' ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900' :
              'text-sky-200 bg-sky-950/40 border-sky-900'
            }`}>
              {feedback.message}
            </div>
          )}
        </>
      )}
    </div>
  );
};