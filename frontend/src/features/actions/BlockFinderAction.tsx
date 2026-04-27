import React from 'react';
import { FolderOpen, LayoutGrid } from 'lucide-react';

interface BlockFinderProps {
  findTables: boolean;
  setFindTables: (val: boolean) => void;
  findFigures: boolean;
  setFindFigures: (val: boolean) => void;
  fileName: string;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  isActionInProgress: boolean;
}

export const BlockFinderAction: React.FC<BlockFinderProps> = ({
  findTables, setFindTables,
  findFigures, setFindFigures,
  fileName, onFileChange,
  isActionInProgress
}) => {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 space-y-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300">
          <LayoutGrid className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">Block Finder</div>
          <div className="mt-1 text-[11px] leading-snug text-zinc-500">
            Finds relevant table and figure blocks by matching captions and table cell text.
          </div>
        </div>
      </div>

      {/* TXT File Upload */}
      <div className="min-w-0">
        <label className="block text-xs text-zinc-400 mb-2">Keywords TXT file</label>
        <label className="flex items-center justify-center gap-2 w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 cursor-pointer hover:bg-zinc-700 transition-colors overflow-hidden box-border">
          <FolderOpen className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">Keywords file</span>
          <input type="file" accept=".txt,text/plain" className="hidden" onChange={onFileChange} />
        </label>
        <div className="mt-2 text-[11px] text-zinc-500 break-all leading-snug">{fileName}</div>
      </div>

      {/* Target Checkboxes */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <input type="checkbox" checked={findTables} onChange={(e) => setFindTables(e.target.checked)} className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
          Find table blocks
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
          <input type="checkbox" checked={findFigures} onChange={(e) => setFindFigures(e.target.checked)} className="h-4 w-4 rounded border-zinc-600 bg-zinc-900" />
          Find figure blocks
        </label>
      </div>
    </div>
  );
};