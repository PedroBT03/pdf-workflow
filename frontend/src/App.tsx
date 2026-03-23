import React, { useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Download, Upload, FileText, Loader2, Braces, CheckCircle2 } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const App = () => {
  const [docData, setDocData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedContent, setSelectedContent] = useState('');
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [processor, setProcessor] = useState<'pdf2data' | 'mineru'>('pdf2data');
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number; scale: number }>>({});
  const [pdfFile, setPdfFile] = useState<Blob | null>(null);
  const [sourceFilename, setSourceFilename] = useState('metadata');
  const [outputFolderHandle, setOutputFolderHandle] = useState<any | null>(null);
  const [outputFolderName, setOutputFolderName] = useState('No folder selected');

  const parsedState = useMemo(() => {
    if (!jsonDraft.trim()) return null;

    try {
      return { data: JSON.parse(jsonDraft), error: null as string | null };
    } catch (err: any) {
      return { data: null, error: err.message as string };
    }
  }, [jsonDraft]);

  const parsedData = parsedState?.data ?? null;
  const jsonError = parsedState?.error ?? null;

  useEffect(() => {
    if (selectedIndex === null || !Array.isArray(parsedData?.blocks)) {
      setSelectedContent('');
      return;
    }

    const block = parsedData.blocks[selectedIndex];
    setSelectedContent(typeof block?.content === 'string' ? block.content : '');
  }, [selectedIndex, parsedData]);

  // 1. Upload and process document
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('processor', processor);

    try {
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('AI processing failed');
      const data = await response.json();

      setPdfFile(file);
      setSourceFilename(file.name);
      setDocData(data);
      setJsonDraft(JSON.stringify(data, null, 2));
      setSelectedIndex(null);
      setSelectedContent('');
      setValidationMessage(null);
      setNumPages(0);
      setCurrentPage(1);
      setPageSizes({});
    } catch (err: any) {
      console.error(err);
      alert('Error: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const onDocumentLoadSuccess = ({ numPages: totalPages }: { numPages: number }) => {
    setNumPages(totalPages);
    setCurrentPage(1);
  };

  const onPageLoadSuccess = (pageNumber: number, page: any) => {
    const viewport = page.getViewport({ scale: 1.5 });
    const nextScale = viewport.width / page.originalWidth;
    setPageSizes((prev) => ({
      ...prev,
      [pageNumber]: {
        width: viewport.width,
        height: viewport.height,
        scale: nextScale,
      },
    }));
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      setJsonDraft(JSON.stringify(parsed, null, 2));
      setValidationMessage('JSON is valid and formatted.');
      window.setTimeout(() => setValidationMessage(null), 2200);
    } catch {
      setValidationMessage(null);
    }
  };

  const updateSelectedContent = (value: string) => {
    setSelectedContent(value);
    if (selectedIndex === null || !parsedData || !Array.isArray(parsedData.blocks)) return;

    const next = JSON.parse(JSON.stringify(parsedData));
    if (!next.blocks[selectedIndex]) return;

    next.blocks[selectedIndex].content = value;
    if (Array.isArray(next.Text) && selectedIndex < next.Text.length) {
      next.Text[selectedIndex] = value;
    }
    setJsonDraft(JSON.stringify(next, null, 2));
  };

  const exportJson = async () => {
    if (!parsedData) return;
    if (!outputFolderHandle) {
      setValidationMessage('Choose an output folder first.');
      window.setTimeout(() => setValidationMessage(null), 3200);
      return;
    }

    const baseName = sourceFilename.replace(/\.[^/.]+$/, '') || 'metadata';

    const safeName = baseName
      .split('')
      .map((ch) => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_'))
      .join('');

    const exportData = JSON.parse(JSON.stringify(parsedData));
    if (Array.isArray(exportData.blocks)) {
      exportData.Text = exportData.blocks.map((block: any) => String(block?.content ?? ''));
      exportData.Type = exportData.blocks.map((block: any) => String(block?.type ?? 'paragraph'));
      exportData.Coordinates = exportData.blocks
        .map((block: any) => block?.box)
        .filter((box: any) => Array.isArray(box) && box.length === 4)
        .map((box: any) => box.map((n: any) => Number(n)));
      exportData.amount = exportData.blocks.length;
    }
    if (!('doi' in exportData)) exportData.doi = '';

    try {
      const docFolder = await outputFolderHandle.getDirectoryHandle(safeName || 'metadata', { create: true });
      await docFolder.getDirectoryHandle(`${safeName || 'metadata'}_images`, { create: true });
      const fileHandle = await docFolder.getFileHandle(`${safeName || 'metadata'}_content.json`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
      await writable.close();

      setValidationMessage(`Saved folder: ${outputFolderName}/${safeName || 'metadata'}`);
      window.setTimeout(() => setValidationMessage(null), 3200);
    } catch (err: any) {
      setValidationMessage(`Save failed: ${err.message || 'unknown error'}`);
      window.setTimeout(() => setValidationMessage(null), 3200);
    }
  };

  const chooseOutputFolder = async () => {
    const pickerWindow = window as Window & {
      showDirectoryPicker?: (options?: {
        mode?: 'read' | 'readwrite';
        startIn?: 'documents' | 'downloads' | 'desktop' | 'music' | 'pictures' | 'videos';
        id?: string;
      }) => Promise<any>;
    };

    if (!pickerWindow.showDirectoryPicker) {
      setValidationMessage('Folder picker is not supported in this browser. Use a Chromium-based browser.');
      window.setTimeout(() => setValidationMessage(null), 3200);
      return;
    }

    try {
      const handle = await pickerWindow.showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents',
        id: 'pdf-workflow-output',
      });
      setOutputFolderHandle(handle);
      setOutputFolderName(handle?.name || 'Selected folder');
      setValidationMessage(null);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') {
        setValidationMessage('This folder is blocked by the browser. Choose a normal user folder (e.g. Documents/pdf-outputs).');
        window.setTimeout(() => setValidationMessage(null), 3600);
        return;
      }
      // User canceled folder selection.
    }
  };

  const previewBlocks = Array.isArray(parsedData?.blocks) ? parsedData.blocks : [];
  const currentPageBlocks: Array<{ block: any; index: number }> = previewBlocks
    .map((block: any, i: number) => ({ block, index: i }))
    .filter(({ block }: { block: any }) => Number(block?.page ?? 1) === currentPage);
  const selectedBlock = selectedIndex !== null ? previewBlocks[selectedIndex] : null;

  const goToPreviousPage = () => {
    setSelectedIndex(null);
    setCurrentPage((p) => Math.max(1, p - 1));
  };

  const goToNextPage = () => {
    setSelectedIndex(null);
    setCurrentPage((p) => Math.min(numPages || 1, p + 1));
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center p-6 font-sans">
      {!docData && (
        <div className="mt-20 bg-zinc-900 p-16 rounded-3xl border border-zinc-800 text-center shadow-2xl max-w-lg w-full">
          <div className="bg-blue-600/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <FileText className="w-10 h-10 text-blue-500" />
          </div>
          <h1 className="text-4xl font-black mb-2 tracking-tighter">PDF METADATA EDITOR</h1>
          <p className="text-zinc-500 mb-10 text-lg">PDF preview + metadata JSON editing/export</p>

          <label className="cursor-pointer group">
            <div className="bg-blue-600 group-hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-2xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-3">
              <Upload className="w-5 h-5" /> Select Document
            </div>
            <input type="file" onChange={handleUpload} className="hidden" accept=".pdf" />
          </label>

          <div className="mt-5 text-left">
            <label className="block text-xs text-zinc-400 mb-2">Processor</label>
            <select
              value={processor}
              onChange={(e) => setProcessor(e.target.value as 'pdf2data' | 'mineru')}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
            >
              <option value="pdf2data">PDF2Data</option>
              <option value="mineru">MinerU</option>
            </select>
          </div>

          {loading && (
            <div className="mt-10 flex items-center justify-center gap-3 text-blue-400 font-mono text-sm animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" /> PROCESSING...
            </div>
          )}
        </div>
      )}

      {docData && (
        <div className="flex gap-10 w-full max-w-400 justify-center items-start">
          <div className="relative bg-zinc-900 rounded-2xl shadow-2xl border-2 border-zinc-800 overflow-hidden">
            {pdfFile && (
              <>
                <Document file={pdfFile} onLoadSuccess={onDocumentLoadSuccess}>
                  <div className="relative">
                    <Page
                      pageNumber={currentPage}
                      scale={1.5}
                      onLoadSuccess={(page) => onPageLoadSuccess(currentPage, page)}
                      onLoadError={() => null}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />

                    {pageSizes[currentPage] && (
                      <div
                        className="absolute top-0 left-0 pointer-events-none"
                        style={{
                          width: pageSizes[currentPage].width,
                          height: pageSizes[currentPage].height,
                        }}
                      >
                        {currentPageBlocks.map(({ block, index }: { block: any; index: number }) => {
                          const box = block?.box;
                          if (!Array.isArray(box) || box.length !== 4) {
                            return null;
                          }

                          const [x1, y1, x2, y2] = box;
                          const left = x1 * pageSizes[currentPage].scale;
                          const top = y1 * pageSizes[currentPage].scale;
                          const width = (x2 - x1) * pageSizes[currentPage].scale;
                          const height = (y2 - y1) * pageSizes[currentPage].scale;
                          const isSelected = selectedIndex === index;

                          return (
                            <div
                              key={index}
                              className={`absolute overflow-hidden pointer-events-auto cursor-pointer transition-colors ${
                                isSelected
                                  ? 'border-2 border-amber-300 bg-amber-300/20'
                                  : 'border border-blue-400/80 bg-blue-400/10 hover:bg-blue-400/20'
                              }`}
                              style={{ left, top, width, height }}
                              title={block?.content || `Block ${index}`}
                              onClick={() => setSelectedIndex(index)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Document>

                <div className="flex items-center justify-between gap-3 p-3 border-t border-zinc-800 bg-zinc-950/60">
                  <button
                    onClick={goToPreviousPage}
                    disabled={currentPage <= 1}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>
                  <div className="text-sm text-zinc-400">
                    Page {currentPage} / {numPages || 1}
                  </div>
                  <button
                    onClick={goToNextPage}
                    disabled={currentPage >= (numPages || 1)}
                    className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </div>

          {/* JSON editor sidebar */}
          <div className="w-96 flex flex-col gap-6 sticky top-6">
            <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-xl">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <Braces className="w-5 h-5 text-blue-500" /> Metadata Editor (JSON)
              </h2>

              <div className="text-xs text-zinc-400 mb-4 bg-zinc-800/50 p-3 rounded-xl">
                Click a box on the PDF to edit only that box metadata.
              </div>

              {selectedIndex === null ? (
                <div className="h-72 flex items-center justify-center text-sm text-zinc-500 border border-dashed border-zinc-700 rounded-2xl px-6 text-center">
                  No box selected.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="text-xs text-zinc-500 bg-zinc-800/40 p-3 rounded-xl">
                    Selected box: #{selectedIndex + 1}
                  </div>
                  {selectedBlock && (
                    <div className="text-xs text-zinc-500 bg-zinc-800/40 p-3 rounded-xl">
                      Page: {selectedBlock.page ?? 1}
                    </div>
                  )}
                  <textarea
                    className="w-full h-72 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-sm text-zinc-300 focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all shadow-inner"
                    value={selectedContent}
                    onChange={(e) => updateSelectedContent(e.target.value)}
                  />
                </div>
              )}

              {jsonError && (
                <div className="mt-3 text-xs text-red-300 bg-red-950/40 border border-red-900 p-3 rounded-xl">
                  Invalid JSON: {jsonError}
                </div>
              )}

              <button
                onClick={formatJson}
                className="mt-4 w-full bg-zinc-800 hover:bg-zinc-700 text-white py-3 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle2 className={`w-4 h-4 ${validationMessage ? 'text-emerald-400' : 'text-zinc-400'}`} />
                {validationMessage ? 'Validated' : 'Validate and Format JSON'}
              </button>

              {validationMessage && (
                <div className="mt-3 text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900 p-3 rounded-xl">
                  {validationMessage}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={exportJson}
                disabled={loading || !parsedData}
                className="w-full py-5 bg-white text-black rounded-3xl font-black text-lg hover:bg-zinc-200 transition-all disabled:bg-zinc-800 flex items-center justify-center gap-3"
              >
                {loading ? <Loader2 className="animate-spin" /> : 'EXPORT JSON'}
              </button>

              <button
                onClick={chooseOutputFolder}
                className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-2xl font-semibold transition-all"
              >
                Choose Output Folder
              </button>

              <div className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-3 py-2 text-xs text-zinc-300">
                {outputFolderName}
              </div>

              <div className="text-xs text-zinc-500 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                Tip: choose a user folder like <code>Documents/pdf-outputs</code>, not system/root folders.
              </div>

              <div className="text-xs text-zinc-500 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                Blocks in preview: {previewBlocks.length} | Pages: {numPages || 1}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;