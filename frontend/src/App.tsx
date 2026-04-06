import React, { useEffect, useMemo, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Upload, FileText, Loader2, Braces, CheckCircle2, Download, FolderOpen } from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const API_BASE = 'http://localhost:8000';

type ProcessorOption = {
  alias: string;
  label: string;
  enabled: boolean;
  reason?: string | null;
};

const DEFAULT_PROCESSORS: ProcessorOption[] = [
  { alias: 'pdf2data', label: 'PDF2Data', enabled: true },
  { alias: 'mineru', label: 'MinerU', enabled: true },
  { alias: 'docling', label: 'Docling', enabled: true },
  { alias: 'paddleppstructure', label: 'Paddle PPStructure', enabled: false, reason: 'Temporarily disabled in this build.' },
  { alias: 'paddlevl', label: 'Paddle VL', enabled: false, reason: 'Temporarily disabled in this build.' },
  { alias: 'mineruvl', label: 'MinerU VL', enabled: false, reason: 'Temporarily disabled in this build.' },
];

const PDF2DATA_LAYOUT_OPTIONS = [
  { value: 'auto', label: 'Auto (fallback PP-DocLayout-L -> DocLayout-YOLO)' },
  { value: 'PP-DocLayout-L', label: 'PP-DocLayout-L' },
  { value: 'DocLayout-YOLO-DocStructBench', label: 'DocLayout-YOLO-DocStructBench' },
];

const PDF2DATA_TABLE_OPTIONS = [
  { value: 'none', label: 'None (layout model handles table regions)' },
  { value: 'microsoft/table-transformer-detection', label: 'microsoft/table-transformer-detection' },
];

const buildAssetUrl = (docId: string, assetPath: string) => {
  const encodedDocId = encodeURIComponent(docId);
  const encodedPath = assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${API_BASE}/api/assets/${encodedDocId}/${encodedPath}`;
};

const buildManifestUrl = (docId: string) => `${API_BASE}/api/assets-manifest/${encodeURIComponent(docId)}`;

const stripNativeImagesPrefix = (assetPath: string) => {
  const parts = assetPath.split('/').filter(Boolean);
  const idx = parts.findIndex((part) => part.toLowerCase().endsWith('_images'));
  if (idx >= 0 && idx + 1 < parts.length) {
    return parts.slice(idx + 1).join('/');
  }
  return parts.length ? parts.slice(-1).join('/') : assetPath;
};

const sanitizePathSegments = (pathValue: string) =>
  pathValue
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '_'));

const App = () => {
  const [docData, setDocData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [selectedContent, setSelectedContent] = useState('');
  const [editorFeedback, setEditorFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [processor, setProcessor] = useState<string>('pdf2data');
  const [pdf2dataLayoutModel, setPdf2dataLayoutModel] = useState<string>('auto');
  const [pdf2dataTableModel, setPdf2dataTableModel] = useState<string>('none');
  const [processorOptions, setProcessorOptions] = useState<ProcessorOption[]>(DEFAULT_PROCESSORS);
  const [processorLoadWarning, setProcessorLoadWarning] = useState<string | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number; scale: number }>>({});
  const [pdfFile, setPdfFile] = useState<Blob | null>(null);
  const [sourceFilename, setSourceFilename] = useState('metadata');
  const [outputFolderHandle, setOutputFolderHandle] = useState<any | null>(null);
  const [outputFolderName, setOutputFolderName] = useState<string>('No folder selected');

  const showEditorFeedback = (type: 'success' | 'error' | 'info', message: string, timeout = 3200) => {
    setEditorFeedback({ type, message });
    if (timeout > 0) {
      window.setTimeout(() => setEditorFeedback(null), timeout);
    }
  };

  const showExportFeedback = (type: 'success' | 'error' | 'info', message: string, timeout = 3200) => {
    setExportFeedback({ type, message });
    if (timeout > 0) {
      window.setTimeout(() => setExportFeedback(null), timeout);
    }
  };

  const resetWorkflow = () => {
    setDocData(null);
    setJsonDraft('');
    setSelectedIndex(null);
    setSelectedContent('');
    setEditorFeedback(null);
    setExportFeedback(null);
    setNumPages(0);
    setCurrentPage(1);
    setPdf2dataLayoutModel('auto');
    setPdf2dataTableModel('none');
    setPageSizes({});
    setPdfFile(null);
    setSourceFilename('metadata');
    setOutputFolderHandle(null);
    setOutputFolderName('No folder selected');
  };

  const confirmAndResetWorkflow = () => {
    const shouldReset = window.confirm('Discard current edits and choose another PDF?');
    if (!shouldReset) return;
    resetWorkflow();
  };

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
  const disabledProcessors = useMemo(() => processorOptions.filter((item) => !item.enabled), [processorOptions]);

  useEffect(() => {
    let cancelled = false;

    const loadProcessors = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/processors`);
        if (!response.ok) {
          throw new Error(`capabilities request failed (${response.status})`);
        }

        const payload = await response.json();
        const apiList = Array.isArray(payload?.processors) ? payload.processors : [];
        const normalized: ProcessorOption[] = apiList
          .filter((item: any) => typeof item?.alias === 'string' && typeof item?.label === 'string')
          .map((item: any) => ({
            alias: item.alias,
            label: item.label,
            enabled: Boolean(item.enabled),
            reason: typeof item.reason === 'string' ? item.reason : null,
          }));

        if (!normalized.length) {
          throw new Error('empty capabilities payload');
        }

        if (cancelled) return;

        setProcessorOptions(normalized);
        setProcessorLoadWarning(null);

        const enabledAliases = new Set(normalized.filter((item) => item.enabled).map((item) => item.alias));
        const defaultFromApi =
          typeof payload?.default_processor === 'string' && enabledAliases.has(payload.default_processor)
            ? payload.default_processor
            : normalized.find((item) => item.enabled)?.alias ?? normalized[0].alias;

        setProcessor((current) => (enabledAliases.has(current) ? current : defaultFromApi));
      } catch (err) {
        console.error(err);
        if (cancelled) return;

        setProcessorOptions(DEFAULT_PROCESSORS);
        setProcessorLoadWarning('Could not load processors from backend. Using local fallback list.');
      }
    };

    loadProcessors();

    return () => {
      cancelled = true;
    };
  }, []);

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
    if (processor === 'pdf2data') {
      formData.append('pdf2data_layout_model', pdf2dataLayoutModel);
      formData.append('pdf2data_table_model', pdf2dataTableModel);
    }

    try {
      const response = await fetch(`${API_BASE}/api/upload`, {
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
      setEditorFeedback(null);
      setExportFeedback(null);
      setNumPages(0);
      setCurrentPage(1);
      setPageSizes({});
    } catch (err: any) {
      console.error(err);
      showEditorFeedback('error', `Error processing PDF: ${err.message || 'unknown error'}`, 4000);
    } finally {
      setLoading(false);
      e.target.value = '';
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
      showEditorFeedback('success', 'JSON is valid and formatted.', 2200);
    } catch {
      showEditorFeedback('error', 'JSON is invalid. Fix it before exporting.', 3200);
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
      showExportFeedback('error', 'Choose an output folder first.', 3600);
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
      const folderName = safeName || 'metadata';
      const docFolder = await outputFolderHandle.getDirectoryHandle(folderName, { create: true });
      const imagesFolder = await docFolder.getDirectoryHandle(`${folderName}_images`, { create: true });

      const docId = String(docData?.id || '').trim();
      if (!docId) {
        throw new Error('Missing document id for asset export. Upload the PDF again.');
      }

      const manifestResponse = await fetch(buildManifestUrl(docId));
      if (!manifestResponse.ok) {
        throw new Error(`asset manifest request failed (${manifestResponse.status})`);
      }
      const manifestPayload = await manifestResponse.json();
      const manifestAssets: string[] = Array.isArray(manifestPayload?.assets) ? manifestPayload.assets : [];

      let copiedImages = 0;
      let failedImages = 0;
      const exportedAssetPaths = new Map<string, string>();

      for (const rawPath of manifestAssets) {
        const trimmedPath = String(rawPath || '').trim();
        if (!trimmedPath) continue;

        const normalizedRelative = stripNativeImagesPrefix(trimmedPath);
        const safeSegments = sanitizePathSegments(normalizedRelative);
        if (!safeSegments.length) {
          failedImages += 1;
          continue;
        }

        try {
          const response = await fetch(buildAssetUrl(docId, trimmedPath));
          if (!response.ok) {
            throw new Error(`asset request failed (${response.status})`);
          }

          const blob = await response.blob();
          let targetDir = imagesFolder;
          for (const segment of safeSegments.slice(0, -1)) {
            targetDir = await targetDir.getDirectoryHandle(segment, { create: true });
          }

          const fileName = safeSegments[safeSegments.length - 1];
          const imageFileHandle = await targetDir.getFileHandle(fileName, { create: true });
          const imageWritable = await imageFileHandle.createWritable();
          await imageWritable.write(blob);
          await imageWritable.close();

          const exportedRel = `${folderName}_images/${safeSegments.join('/')}`;
          exportedAssetPaths.set(trimmedPath, exportedRel);
          copiedImages += 1;
        } catch {
          failedImages += 1;
        }
      }

      if (Array.isArray(exportData.blocks)) {
        for (const block of exportData.blocks) {
          if (typeof block?.filepath !== 'string') continue;
          const key = block.filepath.trim();
          if (!key) continue;

          const mapped = exportedAssetPaths.get(key);
          if (mapped) {
            block.filepath = mapped;
            continue;
          }

          // Fallback for old JSONs where filepath omits a leading folder segment.
          const maybeBySuffix = Array.from(exportedAssetPaths.entries()).find(([src]) => src.endsWith(key));
          if (maybeBySuffix) {
            block.filepath = maybeBySuffix[1];
          }
        }
      }

      const fileName = `${folderName}_content.json`;
      const fileHandle = await docFolder.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' }));
      await writable.close();

      if (manifestAssets.length === 0) {
        showExportFeedback('success', `Saved to ${outputFolderName}/${folderName}/${fileName} (no image assets in this document).`);
      } else if (failedImages === 0) {
        showExportFeedback('success', `Saved to ${outputFolderName}/${folderName}/${fileName} with ${copiedImages} image asset(s).`);
      } else {
        showExportFeedback('info', `Saved JSON, copied ${copiedImages}/${manifestAssets.length} image(s). ${failedImages} asset(s) failed to copy.`);
      }
    } catch (err: any) {
      showExportFeedback('error', `Export failed: ${err.message || 'unknown error'}`, 4000);
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
      showExportFeedback('error', 'Folder picker is unsupported in this browser. Use a Chromium-based browser.', 4200);
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
      showExportFeedback('info', `Output folder selected: ${handle?.name || 'Selected folder'}`);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') {
        showExportFeedback('error', 'This folder is blocked. Pick a normal user folder like Documents/pdf-outputs.', 4200);
        return;
      }
      showExportFeedback('error', `Could not select folder: ${err?.message || 'unknown error'}`, 4200);
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
              onChange={(e) => setProcessor(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
            >
              {processorOptions.map((item) => (
                <option key={item.alias} value={item.alias} disabled={!item.enabled}>
                  {item.label}
                  {!item.enabled ? ' (temporarily disabled)' : ''}
                </option>
              ))}
            </select>
            {processorLoadWarning && (
              <p className="mt-2 text-xs text-orange-400/90">{processorLoadWarning}</p>
            )}

            {processor === 'pdf2data' && (
              <div className="mt-4 grid gap-3">
                <div>
                  <label className="block text-xs text-zinc-400 mb-2">PDF2Data layout model</label>
                  <select
                    value={pdf2dataLayoutModel}
                    onChange={(e) => setPdf2dataLayoutModel(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
                  >
                    {PDF2DATA_LAYOUT_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-2">PDF2Data table model</label>
                  <select
                    value={pdf2dataTableModel}
                    onChange={(e) => setPdf2dataTableModel(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
                  >
                    {PDF2DATA_TABLE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-xs text-zinc-500 truncate" title={sourceFilename}>
                  PDF: <span className="text-zinc-300">{sourceFilename}</span>
                </div>
                <button
                  onClick={confirmAndResetWorkflow}
                  className="px-3 py-2 text-xs rounded-xl bg-rose-900/50 border border-rose-700/80 hover:bg-rose-800/60 text-rose-100 transition-colors"
                >
                  Cancel and choose another PDF
                </button>
              </div>

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
                <CheckCircle2 className="w-4 h-4 text-zinc-400" />
                Validate and Format JSON
              </button>

              {editorFeedback && (
                <div
                  className={`mt-3 text-xs p-3 rounded-xl border ${
                    editorFeedback.type === 'error'
                      ? 'text-red-200 bg-red-950/40 border-red-900'
                      : editorFeedback.type === 'success'
                      ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900'
                      : 'text-sky-200 bg-sky-950/40 border-sky-900'
                  }`}
                >
                  {editorFeedback.message}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                <div className="text-xs text-zinc-500 mb-2">Step 1</div>
                <button
                  onClick={chooseOutputFolder}
                  className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2"
                >
                  <FolderOpen className="w-4 h-4" /> Choose Output Folder
                </button>
                <div
                  className={`mt-3 text-xs rounded-xl px-3 py-2 border ${
                    outputFolderHandle
                      ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900'
                      : 'text-zinc-400 bg-zinc-950/40 border-zinc-700'
                  }`}
                >
                  {outputFolderHandle ? `Selected: ${outputFolderName}` : 'No folder selected yet'}
                </div>
              </div>

              <button
                onClick={exportJson}
                disabled={loading || !parsedData || !outputFolderHandle}
                className="w-full py-5 bg-white text-black rounded-3xl font-black text-lg hover:bg-zinc-200 transition-all disabled:bg-zinc-800 flex items-center justify-center gap-3"
              >
                {loading ? <Loader2 className="animate-spin" /> : <Download className="w-5 h-5" />}
                Step 2: Export JSON
              </button>

              <div className="text-xs text-zinc-400 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                Export creates <code>{'{nome_do_pdf}'}</code> with <code>{'{nome_do_pdf}'}_content.json</code> and <code>{'{nome_do_pdf}'}_images</code>.
              </div>

              {exportFeedback && (
                <div
                  className={`text-xs p-3 rounded-xl border ${
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