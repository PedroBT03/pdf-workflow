import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { SelectedTarget, FeedbackMessage } from '../../types';

interface EditJsonActionProps {
  editSessionEnabled: boolean;
  selectedTarget: SelectedTarget | null;
  selectedBlock: any;
  selectedContent: string;
  setSelectedContent: (val: string) => void;
  onSaveBlock: () => void;
  onFinishEditing: () => void;
  isLoading: boolean;
  feedback: FeedbackMessage | null;
}

export const EditJsonAction: React.FC<EditJsonActionProps> = ({
  editSessionEnabled,
  selectedTarget,
  selectedBlock,
  selectedContent,
  setSelectedContent,
  onSaveBlock,
  onFinishEditing,
  isLoading,
  feedback,
}) => {
  if (!editSessionEnabled) return null;

  return (
    <div className="bg-zinc-950/45 border border-zinc-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold">JSON editor</div>
          <div className="text-[11px] text-zinc-400 mt-1">Direct metadata edit</div>
        </div>
      </div>

      {/* Selection Info */}
      <div className="text-xs text-zinc-400 mb-3 bg-zinc-800/50 p-3 rounded-xl">
        {!selectedTarget 
          ? "Click a box on the PDF to edit its metadata."
          : `Selected ${selectedTarget.kind}: #${selectedTarget.blockIndex + 1}${
              selectedTarget.kind === 'tableCell' ? ` R${selectedTarget.row + 1} C${selectedTarget.col + 1}` : ''
            }`
        }
      </div>

      {selectedTarget && (
        <div className="flex flex-col gap-3">
          {selectedBlock && (
            <div className="text-xs text-zinc-500 bg-zinc-800/40 p-2 rounded-lg">
              Page: {selectedBlock.page ?? 1}
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
      <div className="mt-4 space-y-3">
        <button
          onClick={onSaveBlock}
          disabled={isLoading || !selectedTarget}
          className="w-full bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-100 py-2 rounded-2xl font-semibold transition-all text-sm flex items-center justify-center gap-2"
        >
          {isLoading ? 'Saving...' : 'Save block changes'}
          <CheckCircle2 className="w-4 h-4" />
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
        <div className={`mt-3 text-xs p-3 rounded-xl border ${
          feedback.type === 'error' ? 'text-red-200 bg-red-950/40 border-red-900' :
          feedback.type === 'success' ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900' :
          'text-sky-200 bg-sky-950/40 border-sky-900'
        }`}>
          {feedback.message}
        </div>
      )}
    </div>
  );
};