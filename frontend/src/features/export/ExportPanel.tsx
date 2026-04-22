import React from 'react';
import { Download, FolderOpen } from 'lucide-react';
import { FeedbackMessage } from '../../types';

/**
 * Extended window interface to support the experimental 
 * File System Access API in TypeScript.
 */
interface FileSystemWindow extends Window {
  showDirectoryPicker?: () => Promise<any>;
}

interface ExportPanelProps {
  width: number;
  outputFolderHandle: any | null;
  outputFolderName: string;
  onChooseFolder: () => void;
  onExport: () => void;
  exportFeedback: FeedbackMessage | null;
  isExportDisabled: boolean;
}

export const ExportPanel: React.FC<ExportPanelProps> = ({
  width,
  outputFolderHandle,
  outputFolderName,
  onChooseFolder,
  onExport,
  exportFeedback,
  isExportDisabled,
}) => {
  // Casting window to check for API support without TS errors
  const isPickerSupported = !!(window as FileSystemWindow).showDirectoryPicker;

  return (
    <div 
      style={{ width }} 
      className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-4"
    >
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-3">
        Export Artifacts
      </div>

      {/* Directory Picker Trigger */}
      <button
        onClick={onChooseFolder}
        className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2 border border-zinc-700/50"
      >
        <FolderOpen className="w-4 h-4" /> 
        Choose Output Folder
      </button>

      {/* Selected Path Preview */}
      <div
        className={`mt-3 text-[11px] rounded-xl px-3 py-2 border whitespace-normal break-all leading-relaxed font-medium transition-colors ${
          outputFolderHandle
            ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900/50'
            : 'text-zinc-500 bg-zinc-950/40 border-zinc-800'
        }`}
      >
        {outputFolderHandle ? `Target: ${outputFolderName}` : 'No destination selected yet'}
      </div>

      {/* Main Export Action */}
      <button
        onClick={onExport}
        disabled={isExportDisabled || !outputFolderHandle}
        className="mt-3 w-full py-3 bg-white text-black rounded-2xl font-black text-base hover:bg-zinc-200 transition-all disabled:bg-zinc-800 disabled:text-zinc-500 flex items-center justify-center gap-3 shadow-lg shadow-white/5"
      >
        <Download className="w-5 h-5" />
        Export artifacts
      </button>

      {/* Export Status Feedback */}
      {exportFeedback && (
        <div
          className={`mt-3 text-xs p-3 rounded-xl border whitespace-normal break-all leading-relaxed ${
            exportFeedback.type === 'error'
              ? 'text-red-200 bg-red-950/40 border-red-900'
              : exportFeedback.type === 'success'
              ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900'
              : 'text-sky-200 bg-sky-950/40 border-sky-900'
          }`}
        >
          {exportFeedback.message}
        </div>
      )}

      {/* Browser Support Hint */}
      {!isPickerSupported && (
        <div className="mt-3 text-[10px] text-amber-500 bg-amber-500/5 p-2 rounded-lg border border-amber-500/20 leading-relaxed">
          <strong>Compatibility Warning:</strong> Your browser does not support the File System Access API. 
          Folder selection will not work. Please use a Chromium-based browser (Chrome or Edge).
        </div>
      )}
    </div>
  );
};