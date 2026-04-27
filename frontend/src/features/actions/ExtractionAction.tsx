import React, { useState } from 'react';
import { FileSearch } from 'lucide-react';
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
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 space-y-3">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300">
          <FileSearch className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-100">Extract JSON from PDF</div>
          <div className="mt-1 text-[11px] leading-snug text-zinc-500">
            Runs the selected extraction pipeline and creates the base artifact used by the workflow.
          </div>
        </div>
      </div>

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

      {/* Advanced settings toggle */}
      <button
        type="button"
        onClick={() => setShowAdvanced((prev) => !prev)}
        className="w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {showAdvanced ? 'Hide advanced settings' : 'Advanced settings'}
      </button>

      {/* PDF2Data-specific options */}
      {showAdvanced && (
        <div className="space-y-4 p-3 bg-zinc-950/30 rounded-2xl border border-zinc-800/50">
          {processor === 'pdf2data' && (
            <>
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
            </>
          )}

          {processor !== 'pdf2data' && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-[11px] leading-snug text-zinc-500">
              Advanced model options are only shown for PDF2Data.
            </div>
          )}
        </div>
      )}

      {/* DEV button (visible only for this action) */}
      <button
        onClick={onLoadDevJson}
        disabled={isLoading || isBatchRunning}
        className="w-full bg-amber-600/10 hover:bg-amber-600/20 text-amber-500 border border-amber-600/30 py-2 rounded-xl font-mono text-[10px] uppercase tracking-widest transition-all"
      >
        DEV: Load test_content.json
      </button>
    </div>
  );
};