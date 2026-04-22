import React from 'react';
import { ProcessorOption } from '../../types';

interface ExtractionActionProps {
  processor: string;
  setProcessor: (value: string) => void;
  processorOptions: ProcessorOption[];
  processorLoadWarning: string | null;
  pdf2dataLayoutModel: string;
  setPdf2dataLayoutModel: (value: string) => void;
  pdf2dataTableModel: string;
  setPdf2dataTableModel: (value: string) => void;
  isActionInProgress: boolean;
  onLoadDevJson: () => void; // Handler for the DEV button
  isLoading: boolean;
  isBatchRunning: boolean;
}

const PDF2DATA_LAYOUT_OPTIONS = [
  { value: 'auto', label: 'Auto (fallback PP-DocLayout-L -> DocLayout-YOLO)' },
  { value: 'PP-DocLayout-L', label: 'PP-DocLayout-L' },
  { value: 'DocLayout-YOLO-DocStructBench', label: 'DocLayout-YOLO-DocStructBench' },
];

const PDF2DATA_TABLE_OPTIONS = [
  { value: 'none', label: 'None (layout model handles table regions)' },
  { value: 'microsoft/table-transformer-detection', label: 'microsoft/table-transformer-detection' },
];

export const ExtractionAction: React.FC<ExtractionActionProps> = ({
  processor,
  setProcessor,
  processorOptions,
  processorLoadWarning,
  pdf2dataLayoutModel,
  setPdf2dataLayoutModel,
  pdf2dataTableModel,
  setPdf2dataTableModel,
  isActionInProgress,
  onLoadDevJson,
  isLoading,
  isBatchRunning,
}) => {
  return (
    <div className="grid gap-4">
      {/* Processor selection */}
      <div>
        <label className="block text-xs text-zinc-400 mb-2">Processor / model</label>
        <select
          value={processor}
          onChange={(e) => setProcessor(e.target.value)}
          disabled={isActionInProgress}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
        >
          {processorOptions.map((item) => (
            <option key={item.alias} value={item.alias} disabled={!item.enabled}>
              {item.label}
              {!item.enabled ? ' (temporarily disabled)' : ''}
            </option>
          ))}
        </select>
        
        {processorLoadWarning && (
          <p className="mt-2 text-xs text-orange-400/90 italic">
            {processorLoadWarning}
          </p>
        )}
      </div>

      {/* PDF2Data-specific options */}
      {processor === 'pdf2data' && (
        <div className="space-y-4 p-3 bg-zinc-950/30 rounded-2xl border border-zinc-800/50">
          <div>
            <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-2 ml-1">
              Layout model
            </label>
            <select
              value={pdf2dataLayoutModel}
              onChange={(e) => setPdf2dataLayoutModel(e.target.value)}
              disabled={isActionInProgress}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
            >
              {PDF2DATA_LAYOUT_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] text-zinc-500 uppercase tracking-wider mb-2 ml-1">
              Table model
            </label>
            <select
              value={pdf2dataTableModel}
              onChange={(e) => setPdf2dataTableModel(e.target.value)}
              disabled={isActionInProgress}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500"
            >
              {PDF2DATA_TABLE_OPTIONS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* DEV button (visible only for this action) */}
      <button
        onClick={onLoadDevJson}
        disabled={isLoading || isBatchRunning}
        className="w-full mt-2 bg-amber-600/10 hover:bg-amber-600/20 text-amber-500 border border-amber-600/30 py-2 rounded-xl font-mono text-[10px] uppercase tracking-widest transition-all"
      >
        DEV: Load test_content.json
      </button>
    </div>
  );
};