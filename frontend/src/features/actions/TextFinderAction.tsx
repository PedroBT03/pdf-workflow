import React from 'react';
import { FolderOpen, Info, Search } from 'lucide-react';

interface TextFinderProps {
  threshold: number;
  setThreshold: (val: number) => void;
  findParagraphs: boolean;
  setFindParagraphs: (val: boolean) => void;
  findSectionHeaders: boolean;
  setFindSectionHeaders: (val: boolean) => void;
  countDuplicates: boolean;
  setCountDuplicates: (val: boolean) => void;
  fileName: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isActionInProgress: boolean;
}

const WORD_COUNT_THRESHOLD_HINT = 'Minimum words per block for keyword matching. Increase it to ignore short headings or labels.';

export const TextFinderAction: React.FC<TextFinderProps> = ({
  threshold, setThreshold,
  findParagraphs, setFindParagraphs,
  findSectionHeaders, setFindSectionHeaders,
  countDuplicates, setCountDuplicates,
  fileName, onFileChange,
  isActionInProgress
}) => {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 space-y-3 min-w-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300">
          <Search className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">Text Finder</div>
          <div className="mt-1 text-[11px] leading-snug text-zinc-500">
            Scores text blocks against weighted keywords and highlights matching content.
          </div>
        </div>
      </div>

      {/* JSON File Upload */}
      <div className="min-w-0">
        <label className="block text-xs text-zinc-400 mb-2">Keywords JSON file</label>
        <label className="flex items-center justify-center gap-2 w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 cursor-pointer hover:bg-zinc-700 transition-colors overflow-hidden box-border">
          <FolderOpen className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">Keywords file</span>
          <input type="file" accept=".json,application/json" className="hidden" onChange={onFileChange} />
        </label>
        <div className="mt-2 text-[11px] text-zinc-500 break-all leading-snug">{fileName}</div>
      </div>

      {/* Threshold Input with Tooltip */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-xs text-zinc-400">Word count threshold</label>
          <span className="relative inline-flex group">
            <Info className="h-4 w-4 text-zinc-500 cursor-pointer" />
            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-[11px] leading-snug text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
              {WORD_COUNT_THRESHOLD_HINT}
            </span>
          </span>
        </div>
        <input
          type="number" step="0.1" min="0"
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value || 0))}
          disabled={isActionInProgress}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
        />
      </div>

      {/* Filter Checkboxes */}
      <div className="space-y-2 pt-1">
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <input type="checkbox" checked={findParagraphs} onChange={(e) => setFindParagraphs(e.target.checked)} className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
          Find paragraph blocks
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <input type="checkbox" checked={findSectionHeaders} onChange={(e) => setFindSectionHeaders(e.target.checked)} className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
          Find section headers
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <input type="checkbox" checked={countDuplicates} onChange={(e) => setCountDuplicates(e.target.checked)} className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
          Count duplicate keywords
        </label>
      </div>
    </div>
  );
};