import React from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface PDFViewerProps {
  pdfFile: Blob | null;
  currentPage: number;
  numPages: number;
  pageJumpValue: string;
  onPageJumpChange: (val: string) => void;
  onPageJumpSubmit: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onDocumentLoadSuccess: (data: any) => void;
  onPageLoadSuccess: (pageNumber: number, page: any) => void;
  pdfViewerScrollRef: React.RefObject<HTMLDivElement | null>;
  lastRenderedPageHeight: number;
  pageRefreshTick: number;
  // Layer data
  hasJsonArtifact: boolean;
  editSessionEnabled: boolean;
  children: React.ReactNode;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  pdfFile,
  currentPage,
  numPages,
  pageJumpValue,
  onPageJumpChange,
  onPageJumpSubmit,
  onPrevPage,
  onNextPage,
  onDocumentLoadSuccess,
  onPageLoadSuccess,
  pdfViewerScrollRef,
  lastRenderedPageHeight,
  pageRefreshTick,
  hasJsonArtifact,
  editSessionEnabled,
  children
}) => {
  if (!pdfFile) {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-6 h-full flex items-center justify-center text-zinc-500 text-sm text-center">
        Import a PDF to start the workflow.
      </div>
    );
  }

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-4 h-full flex flex-col min-h-170">
      {/* Header Info */}
      <div className="flex items-center justify-between mb-3 px-2">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold">PDF preview</div>
          <div className="text-xs text-zinc-400 mt-1">
            {hasJsonArtifact ? (editSessionEnabled ? 'Editing enabled' : 'Visualization active') : 'Waiting for extracted JSON'}
          </div>
        </div>
        <div className="text-xs text-zinc-500">Page {currentPage} / {numPages || 1}</div>
      </div>

      <div className="flex-1 flex flex-col gap-4 min-h-0">
        {/* PDF Document Area */}
        <div 
          ref={pdfViewerScrollRef} 
          className="flex-1 min-h-120 overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950/50 relative"
        >
          <Document
            file={pdfFile}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(error) => {
              console.error('Failed to load PDF preview:', error);
            }}
            loading={<div className="p-6 text-sm text-zinc-400">Loading PDF preview...</div>}
            noData={<div className="p-6 text-sm text-zinc-500">No PDF loaded.</div>}
            error={<div className="p-6 text-sm text-red-400">Unable to render PDF preview.</div>}
          >
            <div className="relative" style={{ minHeight: lastRenderedPageHeight || undefined }}>
              <Page
                key={`pdf-page-${pageRefreshTick}`}
                pageNumber={currentPage}
                scale={1.5}
                onLoadSuccess={(page) => onPageLoadSuccess(currentPage, page)}
                renderTextLayer={false}
                renderAnnotationLayer={false}
              />
              {/* Interactive Overlays */}
              {children}
            </div>
          </Document>
        </div>

        {/* Navigation Controls */}
        <div className="flex items-center justify-between gap-3 p-3 border border-zinc-800 rounded-2xl bg-zinc-950/60">
          <button
            onClick={onPrevPage}
            disabled={currentPage <= 1}
            className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-700 transition-colors"
          >
            Previous
          </button>
          
          <div className="flex items-center gap-2 text-sm text-zinc-400">
            <span>Page</span>
            <input
              type="text"
              inputMode="numeric"
              value={pageJumpValue}
              onChange={(e) => onPageJumpChange(e.target.value.replace(/\D/g, ''))}
              onBlur={onPageJumpSubmit}
              onKeyDown={(e) => e.key === 'Enter' && onPageJumpSubmit()}
              className="w-16 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 text-center outline-none focus:border-blue-600"
            />
            <span>/ {numPages || 1}</span>
          </div>

          <button
            onClick={onNextPage}
            disabled={currentPage >= (numPages || 1)}
            className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-700 transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};