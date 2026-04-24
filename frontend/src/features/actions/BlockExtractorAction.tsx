import React, { useState } from 'react';
import { Info, Layers3 } from 'lucide-react';
import { ProcessorOption } from '../../types';

interface BlockExtractorActionProps {
  processor: string;
  setProcessor: (value: string) => void;
  processorOptions: ProcessorOption[];
  processorLoadWarning: string | null;
  pdf2dataLayoutModel: string;
  setPdf2dataLayoutModel: (value: string) => void;
  pdf2dataTableModel: string;
  setPdf2dataTableModel: (value: string) => void;
  useExistingJson: boolean;
  setUseExistingJson: (value: boolean) => void;
  hasJsonArtifact: boolean;
  isActionInProgress: boolean;
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

const BLOCK_EXTRACTOR_HINT =
  'Runs pdf2data-tools block extraction on the loaded PDF. If a JSON artifact already exists, a smaller fast path can reuse it instead of recomputing from the PDF.';

const FAST_PATH_HINT =
  'Optional fast path: reuse the current JSON artifact and filter tables only. This is faster, but it is not the canonical extraction path.';

export const BlockExtractorAction: React.FC<BlockExtractorActionProps> = ({
  processor,
  setProcessor,
  processorOptions,
  processorLoadWarning,
  pdf2dataLayoutModel,
  setPdf2dataLayoutModel,
  pdf2dataTableModel,
  setPdf2dataTableModel,
  useExistingJson,
  setUseExistingJson,
  hasJsonArtifact,
  isActionInProgress,
}) => {
  // Keep advanced options collapsed by default to emphasize the primary workflow.
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="grid gap-3 min-w-0">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-3 space-y-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300">
            <Layers3 className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-zinc-100">Extract table blocks</span>
              <span className="relative inline-flex group">
                <Info className="h-4 w-4 text-zinc-500 cursor-pointer" />
                <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-[11px] leading-snug text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                  {BLOCK_EXTRACTOR_HINT}
                </span>
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-zinc-500">
              Runs the block extractor on the PDF and keeps the result focused on table blocks.
            </p>
          </div>
        </div>

        <div>
          <label className="block text-xs text-zinc-400 mb-2">Processor</label>
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

        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {showAdvanced ? 'Hide advanced settings' : 'Advanced settings'}
        </button>

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

            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/20 p-3">
              <label className={`flex items-start gap-2 text-xs cursor-pointer select-none ${hasJsonArtifact ? 'text-zinc-400' : 'text-zinc-600'}`}>
                <input
                  type="checkbox"
                  checked={useExistingJson}
                  onChange={(e) => setUseExistingJson(e.target.checked)}
                  disabled={!hasJsonArtifact || isActionInProgress}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-600 disabled:opacity-30"
                />
                <span className="leading-snug">Reuse existing JSON when available</span>
                <span className="relative inline-flex group mt-0.5">
                  <Info className="h-3.5 w-3.5 shrink-0 text-zinc-600 cursor-pointer" />
                  <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-72 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-[11px] leading-snug text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                    {FAST_PATH_HINT}
                  </span>
                </span>
              </label>
              {!hasJsonArtifact && (
                <div className="mt-2 text-[11px] leading-snug text-zinc-600">
                  No JSON artifact loaded yet, so only the PDF path will run.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
