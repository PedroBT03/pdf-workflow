import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Upload, FileText, Loader2, Braces, CheckCircle2, Download, FolderOpen, Info } from 'lucide-react';
import {
  API_BASE,
  buildAssetUrl,
  buildManifestUrl,
  getCaptionBoxes,
  getCellBoxesMatrix,
  getTableDimensions,
  isTableWithGrid,
  sanitizePathSegments,
  stripNativeImagesPrefix,
  toCanonicalContentJson,
} from './lib/pdfArtifacts';
import {
  UPGRADE_MODE_LABELS,
  WORKFLOW_ACTION_LABELS,
  type UpgradeMode,
  type WorkflowActionId,
  type WorkflowPathItem,
} from './lib/workflow';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

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

const RIGHT_RAIL_WIDTH_PX = 380;
const WORKFLOW_EXECUTION_ORDER: WorkflowActionId[] = ['extract_json_from_pdf', 'edit_json', 'upgrade_json', 'text_finder', 'block_finder'];
const WORD_COUNT_THRESHOLD_HINT =
  'Minimum words per block for keyword matching. Increase it to ignore short headings or labels.';

type SelectedTarget =
  | { kind: 'block'; blockIndex: number }
  | { kind: 'tableCell'; blockIndex: number; row: number; col: number }
  | { kind: 'tableCaption'; blockIndex: number; captionIndex: number };

type WorkflowQueueItem = {
  actionId: WorkflowActionId;
  processor: string;
  pdf2dataLayoutModel: string;
  pdf2dataTableModel: string;
  upgradeMode: UpgradeMode;
  textFinderWordCountThreshold: number;
  textFinderFindParagraphs: boolean;
  textFinderFindSectionHeaders: boolean;
  textFinderCountDuplicates: boolean;
  blockFinderFindTables: boolean;
  blockFinderFindFigures: boolean;
  selected: boolean;
};

// Main application component orchestrating extraction, editing, upgrading, and export workflows.
const App = () => {
  const [docData, setDocData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [jsonDraft, setJsonDraft] = useState('');
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [selectedContent, setSelectedContent] = useState('');
  const [selectedAction, setSelectedAction] = useState<WorkflowActionId>('extract_json_from_pdf');
  const [actionInProgress, setActionInProgress] = useState<WorkflowActionId | null>(null);
  const [plannedWorkflow, setPlannedWorkflow] = useState<WorkflowQueueItem[]>([]);
  const [workflowQueue, setWorkflowQueue] = useState<WorkflowQueueItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchStatus, setBatchStatus] = useState<'idle' | 'running' | 'paused' | 'completed' | 'failed'>('idle');
  const [batchStatusDetail, setBatchStatusDetail] = useState('No batch run started yet.');
  const [activeWorkflowView, setActiveWorkflowView] = useState<'executed' | 'queue'>('executed');
  const [pendingBatchResumeQueue, setPendingBatchResumeQueue] = useState<WorkflowQueueItem[] | null>(null);
  const [upgradeMode, setUpgradeMode] = useState<UpgradeMode>('both');
  const [textFinderWordCountThreshold, setTextFinderWordCountThreshold] = useState<number>(6);
  const [textFinderFindParagraphs, setTextFinderFindParagraphs] = useState(true);
  const [textFinderFindSectionHeaders, setTextFinderFindSectionHeaders] = useState(true);
  const [textFinderCountDuplicates, setTextFinderCountDuplicates] = useState(false);
  const [textFinderKeywordsFile, setTextFinderKeywordsFile] = useState<File | null>(null);
  const [textFinderKeywordsFileName, setTextFinderKeywordsFileName] = useState('No file selected');
  const [textFinderArtifact, setTextFinderArtifact] = useState<any | null>(null);
  const [textFinderFoundArtifact, setTextFinderFoundArtifact] = useState<any | null>(null);
  const [textFinderArtifactLabel, setTextFinderArtifactLabel] = useState('No highlighted artifact yet');
  const [blockFinderFindTables, setBlockFinderFindTables] = useState(true);
  const [blockFinderFindFigures, setBlockFinderFindFigures] = useState(false);
  const [blockFinderKeywordsFile, setBlockFinderKeywordsFile] = useState<File | null>(null);
  const [blockFinderKeywordsFileName, setBlockFinderKeywordsFileName] = useState('No file selected');
  const [blockFinderArtifact, setBlockFinderArtifact] = useState<any | null>(null);
  const [blockFinderFoundArtifact, setBlockFinderFoundArtifact] = useState<any | null>(null);
  const [blockFinderArtifactLabel, setBlockFinderArtifactLabel] = useState('No highlighted artifact yet');
  const [workflowPath, setWorkflowPath] = useState<WorkflowPathItem[]>([]);
  const [workflowMessage, setWorkflowMessage] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'workflow' | 'artifacts' | 'editor'>('workflow');
  const [editSessionEnabled, setEditSessionEnabled] = useState(false);
  const [hasEditedJson, setHasEditedJson] = useState(false);
  const [editedJson, setEditedJson] = useState<any | null>(null);
  const [upgradedJson, setUpgradedJson] = useState<any | null>(null);
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
  const [lastRenderedPageHeight, setLastRenderedPageHeight] = useState<number>(0);
  const [pageRefreshTick, setPageRefreshTick] = useState(0);
  const [pdfFile, setPdfFile] = useState<Blob | null>(null);
  const [sourceFilename, setSourceFilename] = useState('metadata');
  const [outputFolderHandle, setOutputFolderHandle] = useState<any | null>(null);
  const [outputFolderName, setOutputFolderName] = useState<string>('No folder selected');
  const workflowJsonRef = useRef<any | null>(null);
  const pdfViewerScrollRef = useRef<HTMLDivElement | null>(null);
  const savedViewerScrollTopRef = useRef(0);
  const savedWindowScrollTopRef = useRef(0);
  const exportFeedbackTimeoutRef = useRef<number | null>(null);
  const [pageJumpValue, setPageJumpValue] = useState('1');

  useEffect(() => {
    if (selectedAction !== 'edit_json') {
      setEditSessionEnabled(false);
      setSelectedTarget(null);
      setSelectedContent('');
      setActionInProgress((current) => (current === 'edit_json' ? null : current));
    }
  }, [selectedAction]);

  useEffect(() => {
    if (!workflowMessage) return;
    if (workflowMessage.type === 'error') return;

    const timeoutId = window.setTimeout(() => {
      setWorkflowMessage((current) => (current === workflowMessage ? null : current));
    }, 3600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [workflowMessage]);

  useEffect(() => {
    if (!pendingBatchResumeQueue) return;
    if (actionInProgress !== null) return;
    if (editSessionEnabled) return;

    const queueToResume = pendingBatchResumeQueue;
    setPendingBatchResumeQueue(null);
    void continueBatchWorkflow(queueToResume);
  }, [pendingBatchResumeQueue, actionInProgress, editSessionEnabled]);

  // Show transient feedback messages in the JSON editor panel.
  const showEditorFeedback = (type: 'success' | 'error' | 'info', message: string, timeout = 3200) => {
    setEditorFeedback({ type, message });
    if (timeout > 0) {
      window.setTimeout(() => setEditorFeedback(null), timeout);
    }
  };

  // Show transient feedback messages in the export panel.
  const showExportFeedback = (type: 'success' | 'error' | 'info', message: string, timeout = 3200) => {
    setExportFeedback({ type, message });
    if (exportFeedbackTimeoutRef.current !== null) {
      window.clearTimeout(exportFeedbackTimeoutRef.current);
      exportFeedbackTimeoutRef.current = null;
    }
    if (timeout > 0) {
      exportFeedbackTimeoutRef.current = window.setTimeout(() => {
        setExportFeedback(null);
        exportFeedbackTimeoutRef.current = null;
      }, timeout);
    }
  };

  useEffect(() => {
    return () => {
      if (exportFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(exportFeedbackTimeoutRef.current);
      }
    };
  }, []);

  // Reset workflow state and clear all loaded artifacts and UI selections.
  const resetWorkflow = () => {
    setDocData(null);
    workflowJsonRef.current = null;
    setJsonDraft('');
    setSelectedTarget(null);
    setSelectedContent('');
    setSelectedAction('extract_json_from_pdf');
    setActionInProgress(null);
    setPlannedWorkflow([]);
    setWorkflowQueue([]);
    setIsBatchRunning(false);
    setBatchStatus('idle');
    setBatchStatusDetail('No batch run started yet.');
    setPendingBatchResumeQueue(null);
    setUpgradeMode('both');
    setTextFinderWordCountThreshold(6);
    setTextFinderFindParagraphs(true);
    setTextFinderFindSectionHeaders(true);
    setTextFinderCountDuplicates(false);
    setTextFinderKeywordsFile(null);
    setTextFinderKeywordsFileName('No file selected');
    setTextFinderArtifact(null);
    setTextFinderFoundArtifact(null);
    setTextFinderArtifactLabel('No highlighted artifact yet');
    setBlockFinderFindTables(true);
    setBlockFinderFindFigures(false);
    setBlockFinderKeywordsFile(null);
    setBlockFinderKeywordsFileName('No file selected');
    setBlockFinderArtifact(null);
    setBlockFinderFoundArtifact(null);
    setBlockFinderArtifactLabel('No highlighted artifact yet');
    setWorkflowPath([]);
    setWorkflowMessage(null);
    setActiveWorkflowView('executed');
    setActiveSidebarTab('workflow');
    setEditSessionEnabled(false);
    setHasEditedJson(false);
    setEditedJson(null);
    setUpgradedJson(null);
    setEditorFeedback(null);
    setExportFeedback(null);
    setNumPages(0);
    setCurrentPage(1);
    setPageJumpValue('1');
    setPdf2dataLayoutModel('auto');
    setPdf2dataTableModel('none');
    setPageSizes({});
    setPdfFile(null);
    setSourceFilename('metadata');
    setOutputFolderHandle(null);
    setOutputFolderName('No folder selected');
  };

  // Ask for confirmation before resetting the current workflow state.
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
  useEffect(() => {
    if (parsedData && Array.isArray(parsedData.blocks)) {
      workflowJsonRef.current = parsedData;
    }
  }, [parsedData]);
  const disabledProcessors = useMemo(() => processorOptions.filter((item) => !item.enabled), [processorOptions]);
  const hasPdfArtifact = Boolean(pdfFile);
  const hasJsonArtifact = Boolean(
    (workflowJsonRef.current && Array.isArray(workflowJsonRef.current.blocks)) ||
      (parsedData && Array.isArray(parsedData.blocks)),
  );
  const hasUpgradedArtifact = Boolean(upgradedJson);
  const hasTextFinderArtifact = Boolean(textFinderArtifact && Array.isArray(textFinderArtifact.blocks));
  const hasBlockFinderArtifact = Boolean(blockFinderArtifact && Array.isArray(blockFinderArtifact.blocks));
  const isActionInProgress = actionInProgress !== null;
  const showJsonOverlays = hasJsonArtifact;

  // Resolve the most recent JSON artifact available for downstream actions.
  const getWorkflowJsonArtifact = () => {
    const refArtifact = workflowJsonRef.current;
    if (refArtifact && Array.isArray(refArtifact.blocks)) return refArtifact;
    if (parsedData && Array.isArray(parsedData.blocks)) return parsedData;
    if (editedJson && Array.isArray(editedJson.blocks)) return editedJson;
    if (docData && Array.isArray(docData.blocks)) return docData;
    return null;
  };

  // Determine whether a workflow action has the required prerequisites.
  const canRunAction = (action: WorkflowActionId) => {
    if (action === 'extract_json_from_pdf') return hasPdfArtifact;
    if (action === 'edit_json') return hasJsonArtifact;
    if (action === 'upgrade_json') return hasJsonArtifact;
    if (action === 'text_finder') {
      return hasJsonArtifact && Boolean(textFinderKeywordsFile);
    }
    if (action === 'block_finder') {
      return hasJsonArtifact && Boolean(blockFinderKeywordsFile);
    }
    return false;
  };

  // Parse and normalize a keywords JSON file into weighted keyword entries.
  const parseTextFinderKeywordsFile = async (file: File): Promise<Record<string, number>> => {
    const raw = await file.text();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Keywords file must be a JSON object: { "keyword": weight }.');
    }

    const normalized: Record<string, number> = {};
    for (const [rawKey, rawWeight] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(rawKey || '').trim();
      if (!key) continue;
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight)) continue;
      normalized[key] = (normalized[key] ?? 0) + weight;
    }

    if (!Object.keys(normalized).length) {
      throw new Error('Keywords file has no valid keyword weights.');
    }
    return normalized;
  };

  // Parse a block finder keywords TXT file and normalize non-empty keyword lines.
  const parseBlockFinderKeywordsFile = async (file: File): Promise<string> => {
    const raw = await file.text();
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) {
      throw new Error('Keywords TXT file has no valid keyword lines.');
    }
    return `${lines.join('\n')}\n`;
  };

  // Append a timestamped execution step to the workflow timeline.
  const appendWorkflowPath = (action: WorkflowActionId, status: 'done' | 'failed' | 'skipped', detail?: string) => {
    const item: WorkflowPathItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      label: WORKFLOW_ACTION_LABELS[action],
      status,
      detail,
      timestamp: new Date().toLocaleTimeString(),
    };
    setWorkflowPath((prev) => [...prev, item]);
  };

  useEffect(() => {
    let cancelled = false;

    // Fetch processor capabilities from backend and apply fallback defaults if needed.
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
    if (!selectedTarget || !Array.isArray(parsedData?.blocks)) {
      setSelectedContent('');
      return;
    }

    const block = parsedData.blocks[selectedTarget.blockIndex];
    if (!block) {
      setSelectedContent('');
      return;
    }

    if (selectedTarget.kind === 'tableCell') {
      const cellValue = block?.block?.[selectedTarget.row]?.[selectedTarget.col];
      setSelectedContent(typeof cellValue === 'string' ? cellValue : String(cellValue ?? ''));
      return;
    }

    if (selectedTarget.kind === 'tableCaption') {
      setSelectedContent(typeof block?.caption === 'string' ? block.caption : String(block?.caption ?? ''));
      return;
    }

    setSelectedContent(typeof block?.content === 'string' ? block.content : '');
  }, [selectedTarget, parsedData]);

  // Load an imported PDF file and reset state for a fresh workflow run.
  const handleImportPdf = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPdfFile(file);
    setSourceFilename(file.name);
    setDocData(null);
    workflowJsonRef.current = null;
    setJsonDraft('');
    setSelectedTarget(null);
    setSelectedContent('');
    setActionInProgress(null);
    setPlannedWorkflow([]);
    setWorkflowQueue([]);
    setIsBatchRunning(false);
    setBatchStatus('idle');
    setBatchStatusDetail('No batch run started yet.');
    setEditorFeedback(null);
    setExportFeedback(null);
    setWorkflowMessage({ type: 'success', message: 'PDF imported. Choose an action from the workflow menu.' });
    setNumPages(0);
    setCurrentPage(1);
    setPageJumpValue('1');
    setPageSizes({});
    setEditSessionEnabled(false);
    setHasEditedJson(false);
    setEditedJson(null);
    setUpgradedJson(null);
    setTextFinderKeywordsFile(null);
    setTextFinderKeywordsFileName('No file selected');
    setBlockFinderKeywordsFile(null);
    setBlockFinderKeywordsFileName('No file selected');
    setTextFinderArtifact(null);
    setTextFinderFoundArtifact(null);
    setBlockFinderArtifact(null);
    setBlockFinderFoundArtifact(null);
    setActiveSidebarTab('workflow');
    setWorkflowPath([]);
    e.target.value = '';
  };

  // Execute PDF extraction and store returned JSON/asset metadata.
  const runExtractJsonAction = async () => {
    if (isActionInProgress) {
      setWorkflowMessage({ type: 'info', message: `Finish ${WORKFLOW_ACTION_LABELS[actionInProgress!]} before starting another action.` });
      return false;
    }

    if (!pdfFile) {
      const message = 'Import a PDF before running this action.';
      setWorkflowMessage({ type: 'error', message });
      appendWorkflowPath('extract_json_from_pdf', 'failed', message);
      return false;
    }

    setActionInProgress('extract_json_from_pdf');
    setLoading(true);

    const formData = new FormData();
    formData.append('file', pdfFile, sourceFilename || 'document.pdf');
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

      setDocData(data);
      workflowJsonRef.current = data;
      setJsonDraft(JSON.stringify(data, null, 2));
      setSelectedTarget(null);
      setSelectedContent('');
      setEditorFeedback(null);
      setExportFeedback(null);
      setWorkflowMessage({ type: 'success', message: 'Action completed: JSON extracted from PDF.' });
      appendWorkflowPath('extract_json_from_pdf', 'done', `Blocks: ${Array.isArray(data?.blocks) ? data.blocks.length : 0}`);
      setActiveSidebarTab('artifacts');
      setNumPages(Array.isArray(data?.page_sizes) ? data.page_sizes.length : 0);
      setCurrentPage(1);
      setPageSizes({});
      setPageRefreshTick((tick) => tick + 1);
      setEditSessionEnabled(false);
      setHasEditedJson(false);
      setEditedJson(null);
      setUpgradedJson(null);
      setTextFinderArtifact(null);
      setTextFinderFoundArtifact(null);
      setTextFinderArtifactLabel('No highlighted artifact yet');
      setBlockFinderArtifact(null);
      setBlockFinderFoundArtifact(null);
      setBlockFinderArtifactLabel('No highlighted artifact yet');
      return true;
    } catch (err: any) {
      console.error(err);
      const message = `Action failed: ${err.message || 'unknown error'}`;
      showEditorFeedback('error', `Error processing PDF: ${err.message || 'unknown error'}`, 4000);
      setWorkflowMessage({ type: 'error', message });
      appendWorkflowPath('extract_json_from_pdf', 'failed', message);
      return false;
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  // TODO: DEV
  const loadDevJson = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/dev/load-test-json`);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Falha ao carregar JSON de teste');
      }
      const data = await response.json();

      // Atualiza o estado exatamente como a extração normal faria
      setDocData(data);
      workflowJsonRef.current = data;
      setJsonDraft(JSON.stringify(data, null, 2));
      
      // Atualiza metadados da UI
      if (Array.isArray(data.page_sizes)) {
        setNumPages(data.page_sizes.length);
      }
      
      setWorkflowMessage({ type: 'success', message: 'JSON de teste carregado com sucesso!' });
      appendWorkflowPath('extract_json_from_pdf', 'done', 'Loaded from test_content.json');
      setActiveSidebarTab('artifacts');
      
    } catch (err: any) {
      console.error(err);
      setWorkflowMessage({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };
  // TODO: DEV

  // Start the interactive JSON editing action for selected blocks.
  const runEditJsonAction = (skipJsonAvailabilityCheck = false) => {
    if (isActionInProgress) {
      setWorkflowMessage({ type: 'info', message: `Finish ${WORKFLOW_ACTION_LABELS[actionInProgress!]} before starting another action.` });
      return false;
    }

    if (!skipJsonAvailabilityCheck && !hasJsonArtifact) {
      const message = 'Run Extract JSON first.';
      setWorkflowMessage({ type: 'error', message });
      appendWorkflowPath('edit_json', 'failed', message);
      return false;
    }

    setActionInProgress('edit_json');
    setEditSessionEnabled(true);
    // Force a fresh page load so overlay dimensions are recomputed immediately.
    setPageSizes((prev) => {
      if (!prev[currentPage]) return prev;
      const next = { ...prev };
      delete next[currentPage];
      return next;
    });
    setPageRefreshTick((tick) => tick + 1);
    setActiveSidebarTab('editor');
    setWorkflowMessage({ type: 'info', message: 'Edit action in progress. Select a box, save block changes, then click "Finish editing".' });
    return true;
  };

  // Execute the backend JSON upgrade action using the selected upgrade mode.
  const runUpgradeJsonAction = async () => {
    if (isActionInProgress) {
      setWorkflowMessage({ type: 'info', message: `Finish ${WORKFLOW_ACTION_LABELS[actionInProgress!]} before starting another action.` });
      return false;
    }

    const workflowArtifact = getWorkflowJsonArtifact();
    if (!workflowArtifact) {
      const message = 'Run Extract JSON first.';
      setWorkflowMessage({ type: 'error', message });
      appendWorkflowPath('upgrade_json', 'failed', message);
      return false;
    }

    setActionInProgress('upgrade_json');
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/actions/upgrade-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: upgradeMode,
          data: workflowArtifact,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || `upgrade request failed (${response.status})`);
      }

      const upgraded = payload?.data;
      if (!upgraded || !Array.isArray(upgraded?.blocks)) {
        throw new Error('backend returned invalid upgraded JSON');
      }

      setUpgradedJson(upgraded);
      workflowJsonRef.current = upgraded;
      setJsonDraft(JSON.stringify(upgraded, null, 2));
      setSelectedTarget(null);
      setSelectedContent('');
      setActiveSidebarTab('artifacts');

      const beforeCount = Number(payload?.summary?.blocks_before ?? 0);
      const afterCount = Number(payload?.summary?.blocks_after ?? upgraded.blocks.length);
      setWorkflowMessage({
        type: 'success',
        message: `Upgrade completed (${UPGRADE_MODE_LABELS[upgradeMode]}). Blocks: ${beforeCount} -> ${afterCount}.`,
      });
      appendWorkflowPath('upgrade_json', 'done', `${upgradeMode} | blocks ${beforeCount}->${afterCount}`);
      return true;
    } catch (err: any) {
      console.error(err);
      const message = `Action failed: ${err.message || 'unknown error'}`;
      setWorkflowMessage({ type: 'error', message });
      appendWorkflowPath('upgrade_json', 'failed', message);
      return false;
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  // Execute text finder matching and update overlays with highlighted blocks.
  const runTextFinderAction = async () => {
    if (isActionInProgress) {
      setWorkflowMessage({ type: 'info', message: `Finish ${WORKFLOW_ACTION_LABELS[actionInProgress!]} before starting another action.` });
      return false;
    }

    setActionInProgress('text_finder');
    setLoading(true);
    try {
      const workflowArtifact = getWorkflowJsonArtifact();
      if (!workflowArtifact) {
        const message = 'Run Extract JSON first.';
        setWorkflowMessage({ type: 'error', message });
        appendWorkflowPath('text_finder', 'failed', message);
        return false;
      }

      if (!textFinderKeywordsFile) {
        const message = 'Upload a keywords JSON file before generating a highlighted artifact.';
        setWorkflowMessage({ type: 'error', message });
        appendWorkflowPath('text_finder', 'failed', message);
        return false;
      }

      if (!textFinderFindParagraphs && !textFinderFindSectionHeaders) {
        const message = 'Enable paragraph and/or section_header matching.';
        setWorkflowMessage({ type: 'error', message });
        appendWorkflowPath('text_finder', 'failed', message);
        return false;
      }

      const keywords = await parseTextFinderKeywordsFile(textFinderKeywordsFile);

      const response = await fetch(`${API_BASE}/api/actions/text-finder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: workflowArtifact,
          keywords,
          word_count_threshold: textFinderWordCountThreshold,
          find_paragraphs: textFinderFindParagraphs,
          find_section_headers: textFinderFindSectionHeaders,
          count_duplicates: textFinderCountDuplicates,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || `text finder request failed (${response.status})`);
      }

      const highlightedArtifact = payload?.data;
      const foundArtifact = payload?.found_texts_artifact;
      const fallbackFoundTexts = Array.isArray(payload?.found_texts) ? payload.found_texts : [];
      const fallbackUniqueMatches = new Set(fallbackFoundTexts.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)).size;
      const safeFoundArtifact = foundArtifact && typeof foundArtifact === 'object'
        ? foundArtifact
        : {
            matches: fallbackFoundTexts.map((content: unknown) => ({
              content: String(content || '').trim(),
              score: 1,
            })),
            total_matches: fallbackFoundTexts.length,
            unique_matches: fallbackUniqueMatches,
            settings: {
              word_count_threshold: textFinderWordCountThreshold,
              find_paragraphs: textFinderFindParagraphs,
              find_section_headers: textFinderFindSectionHeaders,
              count_duplicates: textFinderCountDuplicates,
            },
          };
      const beforeCount = Number(payload?.summary?.blocks_before ?? 0);
      const afterCount = Number(payload?.summary?.highlighted_count ?? payload?.summary?.blocks_after ?? 0);

      if (!highlightedArtifact || !Array.isArray(highlightedArtifact?.blocks)) {
        throw new Error('backend returned invalid text finder payload');
      }

      setTextFinderFoundArtifact(safeFoundArtifact);

      if (afterCount === 0) {
        setWorkflowMessage({
          type: 'info',
          message: `Text Finder found no matches. Kept current overlays (${beforeCount} blocks).`,
        });
        appendWorkflowPath('text_finder', 'done', `0 matches | kept ${beforeCount} blocks`);
        return true;
      }

      setTextFinderArtifact(highlightedArtifact);
      setTextFinderArtifactLabel(`Highlighted artifact generated from ${textFinderKeywordsFile.name}`);
      workflowJsonRef.current = highlightedArtifact;
      setJsonDraft(JSON.stringify(highlightedArtifact, null, 2));
      setSelectedTarget(null);
      setSelectedContent('');
      setActiveSidebarTab('artifacts');
      setWorkflowMessage({
        type: 'success',
        message: `Text Finder completed. Highlighted: ${afterCount} block(s) out of ${beforeCount}.`,
      });
      appendWorkflowPath('text_finder', 'done', `highlighted ${afterCount}/${beforeCount}`);
      return true;
    } catch (err: any) {
      console.error(err);
      const message = `Action failed: ${err.message || 'unknown error'}`;
      setWorkflowMessage({ type: 'error', message });
      appendWorkflowPath('text_finder', 'failed', message);
      return false;
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  // Execute block finder matching over table/figure blocks and update overlays.
  const runBlockFinderAction = async () => {
    if (isActionInProgress) {
      setWorkflowMessage({ type: 'info', message: `Finish ${WORKFLOW_ACTION_LABELS[actionInProgress!]} before starting another action.` });
      return false;
    }

    setActionInProgress('block_finder');
    setLoading(true);
    try {
      const workflowArtifact = getWorkflowJsonArtifact();
      if (!workflowArtifact) {
        const message = 'Run Extract JSON first.';
        setWorkflowMessage({ type: 'error', message });
        appendWorkflowPath('block_finder', 'failed', message);
        return false;
      }

      if (!blockFinderKeywordsFile) {
        const message = 'Upload a keywords TXT file before generating a highlighted artifact.';
        setWorkflowMessage({ type: 'error', message });
        appendWorkflowPath('block_finder', 'failed', message);
        return false;
      }

      if (!blockFinderFindTables && !blockFinderFindFigures) {
        const message = 'Enable table and/or figure matching.';
        setWorkflowMessage({ type: 'error', message });
        appendWorkflowPath('block_finder', 'failed', message);
        return false;
      }

      const keywords = await parseBlockFinderKeywordsFile(blockFinderKeywordsFile);

      const response = await fetch(`${API_BASE}/api/actions/block-finder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: workflowArtifact,
          keywords,
          find_tables: blockFinderFindTables,
          find_figures: blockFinderFindFigures,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.detail || `block finder request failed (${response.status})`);
      }

      const highlightedArtifact = payload?.data;
      const foundArtifact = payload?.found_blocks_artifact;
      const beforeCount = Number(payload?.summary?.blocks_before ?? 0);
      const afterCount = Number(payload?.summary?.highlighted_count ?? payload?.summary?.blocks_after ?? 0);

      if (!highlightedArtifact || !Array.isArray(highlightedArtifact?.blocks)) {
        throw new Error('backend returned invalid block finder payload');
      }

      setBlockFinderFoundArtifact(foundArtifact && typeof foundArtifact === 'object' ? foundArtifact : {
        blocks: [],
        total_matches: 0,
        unique_matches: 0,
        settings: {
          find_tables: blockFinderFindTables,
          find_figures: blockFinderFindFigures,
        },
      });

      if (afterCount === 0) {
        setWorkflowMessage({
          type: 'info',
          message: `Block Finder found no matches. Kept current overlays (${beforeCount} blocks).`,
        });
        appendWorkflowPath('block_finder', 'done', `0 matches | kept ${beforeCount} blocks`);
        return true;
      }

      setBlockFinderArtifact(highlightedArtifact);
      setBlockFinderArtifactLabel(`Highlighted artifact generated from ${blockFinderKeywordsFile.name}`);
      workflowJsonRef.current = highlightedArtifact;
      setJsonDraft(JSON.stringify(highlightedArtifact, null, 2));
      setSelectedTarget(null);
      setSelectedContent('');
      setActiveSidebarTab('artifacts');
      setWorkflowMessage({
        type: 'success',
        message: `Block Finder completed. Highlighted: ${afterCount} block(s) out of ${beforeCount}.`,
      });
      appendWorkflowPath('block_finder', 'done', `highlighted ${afterCount}/${beforeCount}`);
      return true;
    } catch (err: any) {
      console.error(err);
      const message = `Action failed: ${err.message || 'unknown error'}`;
      setWorkflowMessage({ type: 'error', message });
      appendWorkflowPath('block_finder', 'failed', message);
      return false;
    } finally {
      setLoading(false);
      setActionInProgress(null);
    }
  };

  // Continue running queued workflow actions sequentially, pausing for manual edit steps.
  const continueBatchWorkflow = async (queueOverride?: WorkflowQueueItem[]) => {
    let queue = queueOverride ?? workflowQueue;
    let extractedInThisBatchRun = false;

    while (queue.length > 0) {
      const [nextItem, ...rest] = queue;
      const nextAction = nextItem.actionId;

      if (!nextItem.selected) {
        appendWorkflowPath(nextAction, 'skipped', 'Deselected in workflow queue.');
        queue = rest;
        setWorkflowQueue(queue);
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), 0);
        });
        continue;
      }
      
      // Restore the options that were selected when this action was added
      setProcessor(nextItem.processor);
      setPdf2dataLayoutModel(nextItem.pdf2dataLayoutModel);
      setPdf2dataTableModel(nextItem.pdf2dataTableModel);
      setUpgradeMode(nextItem.upgradeMode);
      setTextFinderWordCountThreshold(nextItem.textFinderWordCountThreshold);
      setTextFinderFindParagraphs(nextItem.textFinderFindParagraphs);
      setTextFinderFindSectionHeaders(nextItem.textFinderFindSectionHeaders);
      setTextFinderCountDuplicates(nextItem.textFinderCountDuplicates);
      setBlockFinderFindTables(nextItem.blockFinderFindTables);
      setBlockFinderFindFigures(nextItem.blockFinderFindFigures);
      setSelectedAction(nextAction);

      if (nextAction === 'edit_json') {
        const started = runEditJsonAction(extractedInThisBatchRun);
        if (!started) {
          setIsBatchRunning(false);
          setWorkflowQueue([]);
          setBatchStatus('failed');
          setBatchStatusDetail('Batch workflow failed to start Edit JSON.');
          return;
        }

        // Pause here until user finishes manual edit interaction.
        setWorkflowQueue(rest);
        setBatchStatus('paused');
        if (rest.length > 0) {
          setBatchStatusDetail(`Paused at Edit JSON. Next: ${WORKFLOW_ACTION_LABELS[rest[0].actionId]}.`);
          setWorkflowMessage({
            type: 'info',
            message: `Workflow paused at Edit JSON. Finish editing to continue with ${WORKFLOW_ACTION_LABELS[rest[0].actionId]}.`,
          });
        } else {
          setBatchStatusDetail('Paused at Edit JSON. Finish editing to complete batch workflow.');
        }
        return;
      }

      let ok = false;
      if (nextAction === 'extract_json_from_pdf') {
        ok = await runExtractJsonAction();
      } else if (nextAction === 'upgrade_json') {
        ok = await runUpgradeJsonAction();
      } else if (nextAction === 'text_finder') {
        ok = await runTextFinderAction();
      } else if (nextAction === 'block_finder') {
        ok = await runBlockFinderAction();
      }
      if (!ok) {
        setIsBatchRunning(false);
        setWorkflowQueue([]);
        setBatchStatus('failed');
        setBatchStatusDetail(`Batch workflow failed at ${WORKFLOW_ACTION_LABELS[nextAction]}.`);
        return;
      }

      if (nextAction === 'extract_json_from_pdf') {
        extractedInThisBatchRun = true;
      }

      queue = rest;
      setWorkflowQueue(queue);
      // Let React commit state updates from the finished action before starting the next one.
      await new Promise<void>((resolve) => {
        window.setTimeout(() => resolve(), 0);
      });
    }

    setIsBatchRunning(false);
    setWorkflowQueue([]);
    setBatchStatus('completed');
    setBatchStatusDetail('Batch workflow completed successfully.');
    setWorkflowMessage({ type: 'success', message: 'Selected workflow completed.' });
  };

  // Start batch execution for currently selected queued actions.
  const runBatchWorkflow = async () => {
    if (isActionInProgress) {
      setWorkflowMessage({ type: 'info', message: `Finish ${WORKFLOW_ACTION_LABELS[actionInProgress!]} before starting another action.` });
      return;
    }

    if (isBatchRunning) return;

    const selectedQueue = plannedWorkflow;
    if (!selectedQueue.length) {
      setWorkflowMessage({ type: 'info', message: 'Add at least one action to the workflow queue.' });
      return;
    }

    const runnableQueue = selectedQueue.filter((item) => item.selected);
    if (!runnableQueue.length) {
      setWorkflowMessage({ type: 'info', message: 'Select at least one action to run.' });
      return;
    }

    setIsBatchRunning(true);
    setWorkflowQueue(runnableQueue);
    setBatchStatus('running');
    setBatchStatusDetail(`Running ${runnableQueue.length} selected action(s) from ${selectedQueue.length} queued.`);
    setWorkflowMessage({ type: 'info', message: `Running ${runnableQueue.length} selected action(s)...` });
    setActiveWorkflowView('executed');
    await continueBatchWorkflow(runnableQueue);
  };

  // Add the currently selected action and its options to the workflow queue.
  const addSelectedActionToWorkflow = () => {
    if (isActionInProgress || isBatchRunning) return;

    setPlannedWorkflow((prev) => {
      if (prev.some((item) => item.actionId === selectedAction)) {
        setWorkflowMessage({ type: 'info', message: `${WORKFLOW_ACTION_LABELS[selectedAction]} is already in the workflow queue.` });
        return prev;
      }
      const newItem: WorkflowQueueItem = {
        actionId: selectedAction,
        processor,
        pdf2dataLayoutModel,
        pdf2dataTableModel,
        upgradeMode,
        textFinderWordCountThreshold,
        textFinderFindParagraphs,
        textFinderFindSectionHeaders,
        textFinderCountDuplicates,
        blockFinderFindTables,
        blockFinderFindFigures,
        selected: true,
      };
      setActiveWorkflowView('queue');
      setWorkflowMessage({ type: 'info', message: `${WORKFLOW_ACTION_LABELS[selectedAction]} added to workflow queue.` });
      return [...prev, newItem];
    });
  };

  // Toggle whether a queued action should run in the next batch execution.
  const toggleQueuedActionSelected = (actionId: WorkflowActionId) => {
    if (isBatchRunning) return;
    setPlannedWorkflow((prev) =>
      prev.map((item) =>
        item.actionId === actionId ? { ...item, selected: !item.selected } : item,
      ),
    );
  };

  // Remove a specific action from the queued workflow list.
  const removeQueuedAction = (actionId: WorkflowActionId) => {
    if (isBatchRunning) return;
    setPlannedWorkflow((prev) => prev.filter((item) => item.actionId !== actionId));
  };

  // Clear all actions from the current workflow queue.
  const clearWorkflowQueue = () => {
    if (isBatchRunning) return;
    setPlannedWorkflow([]);
    setWorkflowMessage({ type: 'info', message: 'Workflow queue cleared.' });
  };

  // Run the currently selected action outside of batch mode.
  const runSelectedAction = async () => {
    if (isBatchRunning) {
      setWorkflowMessage({ type: 'info', message: 'Batch workflow is running. Finish it before manual action execution.' });
      return;
    }

    if (isActionInProgress) {
      setWorkflowMessage({ type: 'info', message: `Finish ${WORKFLOW_ACTION_LABELS[actionInProgress!]} before starting another action.` });
      return;
    }

    if (selectedAction === 'extract_json_from_pdf') {
      await runExtractJsonAction();
      return;
    }
    if (selectedAction === 'edit_json') {
      runEditJsonAction();
      return;
    }
    if (selectedAction === 'upgrade_json') {
      await runUpgradeJsonAction();
      return;
    }
    if (selectedAction === 'text_finder') {
      await runTextFinderAction();
      return;
    }
    await runBlockFinderAction();
  };

  // Update pagination state after the PDF document finishes loading.
  const onDocumentLoadSuccess = ({ numPages: totalPages }: { numPages: number }) => {
    setNumPages(totalPages);
    setCurrentPage((prev) => {
      if (prev < 1) return 1;
      if (prev > totalPages) return totalPages;
      return prev;
    });
    setPageJumpValue((prev) => {
      const parsed = Number(prev);
      const next = Number.isFinite(parsed) && parsed >= 1 ? Math.min(totalPages, Math.floor(parsed)) : 1;
      return String(next);
    });
  };

  // Capture page dimensions and scale used to render overlay coordinates.
  const onPageLoadSuccess = (pageNumber: number, page: any) => {
    const viewport = page.getViewport({ scale: 1.5 });
    const nextScale = viewport.width / page.originalWidth;
    setLastRenderedPageHeight(viewport.height);
    setPageSizes((prev) => ({
      ...prev,
      [pageNumber]: {
        width: viewport.width,
        height: viewport.height,
        scale: nextScale,
      },
    }));
  };

  // Update editable text content for the currently selected target.
  const updateSelectedContent = (value: string) => {
    if (!editSessionEnabled) {
      showEditorFeedback('info', 'Run the "Edit JSON" action to enable editing.', 2600);
      return;
    }
    setSelectedContent(value);
  };

  // Persist edits for the selected block/cell/caption to backend canonical JSON.
  const applyBlockChanges = async () => {
    if (!editSessionEnabled || !selectedTarget || !parsedData) return;

    setLoading(true);
    try {
      const target = {
        kind: selectedTarget.kind,
        block_index: selectedTarget.blockIndex,
      };
      if (selectedTarget.kind === 'tableCell') {
        Object.assign(target, { row: selectedTarget.row, col: selectedTarget.col });
      } else if (selectedTarget.kind === 'tableCaption') {
        Object.assign(target, { caption_index: selectedTarget.captionIndex });
      }

      const response = await fetch(`${API_BASE}/api/actions/edit-json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: parsedData,
          target,
          value: selectedContent,
        }),
      });

      if (!response.ok) throw new Error('Edit failed');
      const result = await response.json();
      const nextJson = result?.canonical ?? result?.data;
      setJsonDraft(JSON.stringify(nextJson, null, 2));
      workflowJsonRef.current = nextJson;
      showEditorFeedback('success', 'Block saved.', 1500);
    } catch (err: any) {
      console.error(err);
      showEditorFeedback('error', `Could not save: ${err.message}`, 2600);
    } finally {
      setLoading(false);
    }
  };

  // Finalize edit mode, commit edited JSON, and optionally resume batch execution.
  const finalizeEditedJson = async () => {
    if (actionInProgress !== 'edit_json') return;
    if (!parsedData) {
      setWorkflowMessage({ type: 'error', message: 'Cannot finalize edits: JSON is invalid.' });
      return;
    }

    try {
      const committed = JSON.parse(JSON.stringify(parsedData));
      setEditedJson(committed);
      workflowJsonRef.current = committed;
      setHasEditedJson(true);
      setEditSessionEnabled(false);
      setSelectedTarget(null);
      setSelectedContent('');
      setActionInProgress(null);
      setWorkflowMessage({ type: 'success', message: 'Edits finalized. The edited JSON artifact is ready.' });
      appendWorkflowPath('edit_json', 'done', 'Edits finalized');
      setActiveSidebarTab('artifacts');

      if (isBatchRunning && workflowQueue.length > 0) {
        const nextQueue = [...workflowQueue];
        setBatchStatus('running');
        setBatchStatusDetail(`Resuming batch workflow with ${WORKFLOW_ACTION_LABELS[nextQueue[0].actionId]}.`);
        setPendingBatchResumeQueue(nextQueue);
      } else if (isBatchRunning) {
        setIsBatchRunning(false);
        setBatchStatus('completed');
        setBatchStatusDetail('Batch workflow completed successfully.');
      }
    } catch (err: any) {
      setWorkflowMessage({ type: 'error', message: 'Failed to finalize edits.' });
    }
  };

  // Export canonical JSON artifacts and related image assets to selected folder.
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

    const baseSnapshot = JSON.parse(JSON.stringify(docData ?? parsedData));
    const editedSnapshot = hasEditedJson && editedJson ? JSON.parse(JSON.stringify(editedJson)) : null;
    const upgradedSnapshot = upgradedJson ? JSON.parse(JSON.stringify(upgradedJson)) : null;
    const textFinderSnapshot = textFinderArtifact ? JSON.parse(JSON.stringify(textFinderArtifact)) : null;
    const textFinderFoundSnapshot = textFinderFoundArtifact ? JSON.parse(JSON.stringify(textFinderFoundArtifact)) : null;
    const blockFinderSnapshot = blockFinderArtifact ? JSON.parse(JSON.stringify(blockFinderArtifact)) : null;
    const blockFinderFoundSnapshot = blockFinderFoundArtifact ? JSON.parse(JSON.stringify(blockFinderFoundArtifact)) : null;

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

      // Rewrite block filepaths to exported relative asset locations.
      const rewriteAssetPaths = (snapshot: any) => {
        if (!Array.isArray(snapshot?.blocks)) return;
        for (const block of snapshot.blocks) {
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
      };

      rewriteAssetPaths(baseSnapshot);
      if (editedSnapshot) rewriteAssetPaths(editedSnapshot);
      if (upgradedSnapshot) rewriteAssetPaths(upgradedSnapshot);
      if (textFinderSnapshot) rewriteAssetPaths(textFinderSnapshot);
      if (blockFinderSnapshot) rewriteAssetPaths(blockFinderSnapshot);

      const filesToWrite: Array<{ name: string; data: any; canonical: any }> = [];
      const seenCanonical = new Set<string>();

      // Add a snapshot to export list only when canonical content differs.
      const pushIfUnique = (name: string, data: any) => {
        const canonical = toCanonicalContentJson(data);
        const serialized = JSON.stringify(canonical);
        if (seenCanonical.has(serialized)) return;
        seenCanonical.add(serialized);
        filesToWrite.push({ name, data, canonical });
      };

      // Baseline: exactly what came from PDF extraction (before edits/upgrades).
      pushIfUnique(`${folderName}_content.json`, baseSnapshot);

      if (editedSnapshot) {
        pushIfUnique(`${folderName}_edited_content.json`, editedSnapshot);
      }

      if (upgradedSnapshot) {
        pushIfUnique(`${folderName}_upgraded_content.json`, upgradedSnapshot);
      }

      let additionalJsonCount = 0;
      if (textFinderSnapshot) {
        const highlightedBlocks = Array.isArray(textFinderSnapshot.blocks)
          ? textFinderSnapshot.blocks.filter((block: any) => Boolean(block?.text_finder_highlighted))
          : [];
        const totalMatchesRaw = Number(textFinderFoundSnapshot?.total_matches);
        const totalMatches = Number.isFinite(totalMatchesRaw) ? totalMatchesRaw : highlightedBlocks.length;
        const uniqueByContent = new Set(highlightedBlocks.map((block: any) => String(block?.content || '').trim()).filter(Boolean)).size;
        const uniqueMatchesRaw = Number(textFinderFoundSnapshot?.unique_matches);
        const uniqueMatches = Number.isFinite(uniqueMatchesRaw) ? uniqueMatchesRaw : uniqueByContent;

        // Export a single combined Text Finder artifact with only matched blocks and found metadata.
        const combinedTextFinderSnapshot = {
          blocks: highlightedBlocks,
          total_matches: totalMatches,
          unique_matches: uniqueMatches,
          settings: textFinderFoundSnapshot?.settings ?? {
            word_count_threshold: textFinderWordCountThreshold,
            find_paragraphs: textFinderFindParagraphs,
            find_section_headers: textFinderFindSectionHeaders,
            count_duplicates: textFinderCountDuplicates,
          },
        };

        const fileHandle = await docFolder.getFileHandle(`${folderName}_text_finder_content.json`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(new Blob([JSON.stringify(combinedTextFinderSnapshot, null, 2)], { type: 'application/json' }));
        await writable.close();
        additionalJsonCount += 1;
      }

      if (blockFinderSnapshot) {
        const highlightedBlocks = Array.isArray(blockFinderSnapshot.blocks)
          ? blockFinderSnapshot.blocks.filter((block: any) => Boolean(block?.block_finder_highlighted))
          : [];
        const totalMatchesRaw = Number(blockFinderFoundSnapshot?.total_matches);
        const totalMatches = Number.isFinite(totalMatchesRaw) ? totalMatchesRaw : highlightedBlocks.length;
        const uniqueMatchesRaw = Number(blockFinderFoundSnapshot?.unique_matches);
        const uniqueMatches = Number.isFinite(uniqueMatchesRaw) ? uniqueMatchesRaw : highlightedBlocks.length;

        // Export a single combined Block Finder artifact with only matched blocks and found metadata.
        const combinedBlockFinderSnapshot = {
          blocks: highlightedBlocks,
          total_matches: totalMatches,
          unique_matches: uniqueMatches,
          settings: blockFinderFoundSnapshot?.settings ?? {
            find_tables: blockFinderFindTables,
            find_figures: blockFinderFindFigures,
          },
        };

        const fileHandle = await docFolder.getFileHandle(`${folderName}_block_finder_content.json`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(new Blob([JSON.stringify(combinedBlockFinderSnapshot, null, 2)], { type: 'application/json' }));
        await writable.close();
        additionalJsonCount += 1;
      }

      for (const item of filesToWrite) {
        const fileHandle = await docFolder.getFileHandle(item.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(new Blob([JSON.stringify(item.canonical, null, 2)], { type: 'application/json' }));
        await writable.close();
      }

      if (manifestAssets.length === 0) {
        showExportFeedback('success', `Saved ${filesToWrite.length + additionalJsonCount} JSON file(s) to ${outputFolderName}/${folderName}/ (no image assets in this document).`);
      } else if (failedImages === 0) {
        showExportFeedback('success', `Saved ${filesToWrite.length + additionalJsonCount} JSON file(s) and ${copiedImages} image asset(s) to ${outputFolderName}/${folderName}/.`);
      } else {
        showExportFeedback('info', `Saved ${filesToWrite.length + additionalJsonCount} JSON file(s), copied ${copiedImages}/${manifestAssets.length} image(s). ${failedImages} asset(s) failed to copy.`);
      }
    } catch (err: any) {
      showExportFeedback('error', `Artifacts export failed: ${err.message || 'unknown error'}`, 4000);
    }
  };

  // Open folder picker and store the output directory handle for exports.
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
  const selectedBlock = selectedTarget ? previewBlocks[selectedTarget.blockIndex] : null;

  useEffect(() => {
    setPageJumpValue(String(currentPage));
  }, [currentPage]);

  useLayoutEffect(() => {
    const container = pdfViewerScrollRef.current;
    if (!container) return;
    container.scrollTop = savedViewerScrollTopRef.current;
    window.scrollTo({ top: savedWindowScrollTopRef.current, behavior: 'auto' });
  }, [currentPage, pageRefreshTick]);

  // Navigate to a page while preserving viewer/window scroll positions.
  const navigateToPage = (nextPage: number) => {
    const container = pdfViewerScrollRef.current;
    if (container) {
      savedViewerScrollTopRef.current = container.scrollTop;
    }
    savedWindowScrollTopRef.current = window.scrollY;
    setSelectedTarget(null);
    setCurrentPage(Math.min(Math.max(1, nextPage), numPages || 1));
  };

  // Move to the previous page in the PDF preview.
  const goToPreviousPage = () => {
    navigateToPage(currentPage - 1);
  };

  // Move to the next page in the PDF preview.
  const goToNextPage = () => {
    navigateToPage(currentPage + 1);
  };

  // Validate and apply user-entered page jump values.
  const submitPageJump = () => {
    const parsed = Number(pageJumpValue);
    if (!Number.isFinite(parsed)) {
      setPageJumpValue(String(currentPage));
      return;
    }
    navigateToPage(Math.floor(parsed));
  };

  // Load a keywords file for text-finder matching and show status feedback.
  const handleTextFinderKeywordsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setTextFinderKeywordsFile(file);
    setTextFinderKeywordsFileName(file?.name || 'No file selected');
    if (file) {
      setWorkflowMessage({ type: 'info', message: `Loaded keywords file: ${file.name}` });
    }
    e.target.value = '';
  };

  // Load a keywords file for block-finder matching and show status feedback.
  const handleBlockFinderKeywordsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file && !file.name.toLowerCase().endsWith('.txt')) {
      setBlockFinderKeywordsFile(null);
      setBlockFinderKeywordsFileName('No file selected');
      setWorkflowMessage({ type: 'error', message: 'Block Finder keywords must be a .txt file.' });
      e.target.value = '';
      return;
    }
    setBlockFinderKeywordsFile(file);
    setBlockFinderKeywordsFileName(file?.name || 'No file selected');
    if (file) {
      setWorkflowMessage({ type: 'info', message: `Loaded block finder keywords file: ${file.name}` });
    }
    e.target.value = '';
  };

  // Build hover title text for highlighted text-finder overlays.
  const buildTextFinderTitle = (block: any) => {
    if (!block?.text_finder_highlighted) return '';
    const score = Number(block?.text_finder_match_score ?? 0);
    if (Number.isFinite(score) && score > 0) {
      return `Text Finder score: ${score}`;
    }
    return 'Text Finder match';
  };

  // Build hover title text for highlighted block-finder overlays.
  const buildBlockFinderTitle = (block: any) => {
    if (!block?.block_finder_highlighted) return '';
    const score = Number(block?.block_finder_match_score ?? 0);
    if (Number.isFinite(score) && score > 0) {
      return `Block Finder score: ${score}`;
    }
    return 'Block Finder match';
  };

  // Build hover title text when one or more finder highlights are present on a block.
  const buildFinderOverlayTitle = (block: any) => {
    const textTitle = buildTextFinderTitle(block);
    const blockTitle = buildBlockFinderTitle(block);
    if (textTitle && blockTitle) return `${textTitle} | ${blockTitle}`;
    return textTitle || blockTitle || '';
  };

  // Render the right-rail workflow history and queue controls.
  const renderWorkflowRail = () => {
    const batchStatusBadgeClass =
      batchStatus === 'running'
        ? 'text-sky-200 bg-sky-950/40 border-sky-900'
        : batchStatus === 'paused'
        ? 'text-amber-200 bg-amber-950/40 border-amber-900'
        : batchStatus === 'completed'
        ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900'
        : batchStatus === 'failed'
        ? 'text-red-200 bg-red-950/40 border-red-900'
        : 'text-zinc-300 bg-zinc-900/40 border-zinc-700';

    const workflowPreview: Array<{
      id: string;
      action: WorkflowActionId;
      label: string;
      status: 'done' | 'failed' | 'running' | 'skipped';
      detail?: string;
      timestamp: string;
    }> = workflowPath.length
      ? workflowPath.map((item) => ({ ...item, status: item.status }))
      : [
          {
            id: 'empty',
            action: selectedAction,
            label: 'No actions executed yet',
            status: 'done',
            detail: 'Run an action from the left panel.',
            timestamp: '',
          },
        ];

    if (actionInProgress) {
      workflowPreview.push({
        id: `running-${actionInProgress}`,
        action: actionInProgress,
        label: WORKFLOW_ACTION_LABELS[actionInProgress],
        status: 'running',
        detail: isBatchRunning ? 'Currently running inside batch workflow.' : 'Currently running.',
        timestamp: new Date().toLocaleTimeString(),
      });
    }

    const queuePreview = plannedWorkflow.length
      ? plannedWorkflow
      : [];

    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-5 h-170 overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm uppercase tracking-[0.2em] text-zinc-500 font-semibold">Workflow</h2>
          <div className="text-[11px] text-zinc-500">{activeWorkflowView === 'executed' ? 'Executed steps' : 'Current queue'}</div>
        </div>
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            onClick={() => setActiveWorkflowView('executed')}
            className={`py-2 rounded-xl text-xs font-semibold transition-all ${
              activeWorkflowView === 'executed' ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Executed
          </button>
          <button
            onClick={() => setActiveWorkflowView('queue')}
            className={`py-2 rounded-xl text-xs font-semibold transition-all ${
              activeWorkflowView === 'queue' ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400'
            }`}
          >
            Current workflow
          </button>
        </div>
        <div className={`mb-4 text-xs p-3 rounded-xl border ${batchStatusBadgeClass}`}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">Batch status</span>
            <span className="uppercase tracking-[0.16em] text-[10px] opacity-80">{batchStatus}</span>
          </div>
          <div className="mt-1 opacity-90">{batchStatusDetail}</div>
        </div>
        {activeWorkflowView === 'executed' ? (
          <div className="workflow-scroll flex-1 overflow-y-auto pr-1 space-y-3">
            {workflowPreview.map((item, index) => (
              <div key={item.id} className="flex flex-col items-stretch">
                <div
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    item.id === 'empty'
                      ? 'border-zinc-700 bg-zinc-950/50 text-zinc-400'
                      : item.status === 'running'
                      ? 'border-sky-900 bg-sky-950/35 text-sky-100'
                      : item.status === 'skipped'
                      ? 'border-zinc-700 bg-zinc-950/35 text-zinc-400'
                      : item.status === 'done'
                      ? 'border-emerald-900 bg-emerald-950/35 text-emerald-100'
                      : 'border-red-900 bg-red-950/35 text-red-100'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{item.label}</span>
                    <span className="text-[11px] uppercase tracking-[0.18em] opacity-70">
                      {item.id === 'empty' ? 'idle' : item.status}
                    </span>
                  </div>
                  {item.detail && <div className="mt-2 text-xs text-inherit opacity-80">{item.detail}</div>}
                  {item.timestamp && <div className="mt-2 text-[11px] opacity-60">{item.timestamp}</div>}
                </div>
                {index < workflowPreview.length - 1 && (
                  <div className="flex items-center justify-center py-2 text-zinc-500">
                    <div className="h-4 w-px bg-zinc-700" />
                    <span className="mx-2 text-xs">→</span>
                    <div className="h-4 w-px bg-zinc-700" />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="workflow-scroll flex-1 overflow-y-auto pr-1 space-y-3">
            {queuePreview.length === 0 ? (
              <div className="rounded-2xl border border-zinc-700 bg-zinc-950/50 text-zinc-400 px-4 py-6 text-sm text-center">
                No actions queued. Add actions from the Actions panel.
              </div>
            ) : (
              queuePreview.map((item, index) => (
                <div
                  key={`${item.actionId}-${index}`}
                  className={`rounded-2xl border px-4 py-3 text-sm ${
                    item.selected
                      ? 'border-zinc-700 bg-zinc-950/40 text-zinc-200'
                      : 'border-zinc-800 bg-zinc-950/20 text-zinc-500'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <label className="flex items-center gap-3 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => toggleQueuedActionSelected(item.actionId)}
                        disabled={isBatchRunning}
                        className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-600"
                      />
                      <span className={`font-semibold ${item.selected ? '' : 'line-through opacity-70'}`}>
                        {index + 1}. {WORKFLOW_ACTION_LABELS[item.actionId]}
                      </span>
                    </label>
                    {!isBatchRunning ? (
                      <button
                        onClick={() => removeQueuedAction(item.actionId)}
                        className="text-[11px] uppercase tracking-[0.16em] text-zinc-400 hover:text-zinc-200"
                      >
                        Remove
                      </button>
                    ) : (
                      <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">locked</span>
                    )}
                  </div>
                  <div className="mt-2 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
                    {item.selected ? 'Will run' : 'Saved for later'}
                  </div>
                </div>
              ))
            )}

            <div className="text-[11px] text-zinc-500 px-1 -mt-1">
              Unchecked actions stay in the workflow and can be run later.
            </div>

            <button
              onClick={runBatchWorkflow}
              disabled={loading || isActionInProgress || isBatchRunning || queuePreview.every((item) => !item.selected)}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-3 rounded-xl font-semibold transition-all"
            >
              {isBatchRunning ? 'Workflow running...' : 'Start workflow execution'}
            </button>

            <button
              onClick={clearWorkflowQueue}
              disabled={isBatchRunning || queuePreview.length === 0}
              className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-500 text-zinc-200 py-2 rounded-xl font-semibold transition-all text-sm"
            >
              Clear workflow
            </button>
          </div>
        )}
      </div>
    );
  };

  // Render the actions column with per-action settings and controls.
  const renderActionsColumn = () => (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-5 h-full flex flex-col gap-5">
      <div>
        <h2 className="text-sm uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-4">Actions</h2>

        <div className="grid gap-3">
          <div>
            <label className="block text-xs text-zinc-400 mb-2">Action</label>
            <select
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value as WorkflowActionId)}
              disabled={isActionInProgress}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
            >
              <option value="extract_json_from_pdf">Extract JSON from PDF</option>
              <option value="edit_json">Edit JSON</option>
              <option value="upgrade_json">Upgrade JSON</option>
              <option value="text_finder">Text Finder</option>
              <option value="block_finder">Block Finder</option>
            </select>
          </div>

          {(selectedAction === 'extract_json_from_pdf' || selectedAction === 'upgrade_json' || selectedAction === 'text_finder' || selectedAction === 'block_finder') && (
            <div>
              <label className="block text-xs text-zinc-400 mb-2">
                {selectedAction === 'extract_json_from_pdf'
                  ? 'Processor / model'
                  : selectedAction === 'upgrade_json'
                  ? 'Upgrade mode'
                  : selectedAction === 'text_finder'
                  ? 'Text finder settings'
                  : 'Block finder settings'}
              </label>
              {selectedAction === 'extract_json_from_pdf' ? (
                <>
                  <select
                    value={processor}
                    onChange={(e) => setProcessor(e.target.value)}
                    disabled={isActionInProgress}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
                  >
                    {processorOptions.map((item) => (
                      <option key={item.alias} value={item.alias} disabled={!item.enabled}>
                        {item.label}
                        {!item.enabled ? ' (temporarily disabled)' : ''}
                      </option>
                    ))}
                  </select>
                  {processorLoadWarning && <p className="mt-2 text-xs text-orange-400/90">{processorLoadWarning}</p>}

                  {processor === 'pdf2data' && (
                    <div className="mt-4 grid gap-3">
                      <div>
                        <label className="block text-xs text-zinc-400 mb-2">PDF2Data layout model</label>
                        <select
                          value={pdf2dataLayoutModel}
                          onChange={(e) => setPdf2dataLayoutModel(e.target.value)}
                          disabled={isActionInProgress}
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
                          disabled={isActionInProgress}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
                        >
                          {PDF2DATA_TABLE_OPTIONS.map((item) => (
                            <option key={item.value} value={item.value}>{item.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="grid gap-3 min-w-0">
                  {selectedAction === 'text_finder' ? (
                    <>
                      <div className="min-w-0">
                        <label className="block text-xs text-zinc-400 mb-2">Keywords JSON file</label>
                        <label className="flex items-center justify-center gap-2 w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 cursor-pointer hover:bg-zinc-700 transition-colors overflow-hidden box-border">
                          <FolderOpen className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate">Keywords file</span>
                          <input type="file" accept=".json,application/json" className="hidden" onChange={handleTextFinderKeywordsFile} />
                        </label>
                        <div className="mt-2 text-[11px] text-zinc-500 break-all leading-snug">{textFinderKeywordsFileName}</div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <label className="block text-xs text-zinc-400">Word count threshold</label>
                          <span className="relative inline-flex group">
                            <Info className="h-4 w-4 text-zinc-500 cursor-help" aria-label={WORD_COUNT_THRESHOLD_HINT} />
                            <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-64 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-[11px] leading-snug text-zinc-200 opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
                              {WORD_COUNT_THRESHOLD_HINT}
                            </span>
                          </span>
                        </div>
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={textFinderWordCountThreshold}
                          onChange={(e) => setTextFinderWordCountThreshold(Number(e.target.value || 0))}
                          disabled={isActionInProgress}
                          style={{ colorScheme: 'dark' }}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={textFinderFindParagraphs}
                          onChange={(e) => setTextFinderFindParagraphs(e.target.checked)}
                          disabled={isActionInProgress}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                        />
                        Find paragraph blocks
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={textFinderFindSectionHeaders}
                          onChange={(e) => setTextFinderFindSectionHeaders(e.target.checked)}
                          disabled={isActionInProgress}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                        />
                        Find section headers
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={textFinderCountDuplicates}
                          onChange={(e) => setTextFinderCountDuplicates(e.target.checked)}
                          disabled={isActionInProgress}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                        />
                        Count duplicate keyword occurrences
                      </label>
                    </>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <label className="block text-xs text-zinc-400 mb-2">Keywords TXT file</label>
                        <label className="flex items-center justify-center gap-2 w-full min-w-0 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 cursor-pointer hover:bg-zinc-700 transition-colors overflow-hidden box-border">
                          <FolderOpen className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 truncate">Keywords file</span>
                          <input type="file" accept=".txt,text/plain" className="hidden" onChange={handleBlockFinderKeywordsFile} />
                        </label>
                        <div className="mt-2 text-[11px] text-zinc-500 break-all leading-snug">{blockFinderKeywordsFileName}</div>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={blockFinderFindTables}
                          onChange={(e) => setBlockFinderFindTables(e.target.checked)}
                          disabled={isActionInProgress}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                        />
                        Find table blocks
                      </label>
                      <label className="flex items-center gap-2 text-xs text-zinc-300">
                        <input
                          type="checkbox"
                          checked={blockFinderFindFigures}
                          onChange={(e) => setBlockFinderFindFigures(e.target.checked)}
                          disabled={isActionInProgress}
                          className="h-4 w-4 rounded border-zinc-600 bg-zinc-900"
                        />
                        Find figure blocks
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={runSelectedAction}
            disabled={loading || isActionInProgress || isBatchRunning || !canRunAction(selectedAction)}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-3 rounded-xl font-semibold transition-all"
          >
            {actionInProgress === 'edit_json'
              ? 'Edit action in progress'
              : loading
              ? 'Running action...'
              : selectedAction === 'text_finder'
              ? 'Generate highlighted artifact'
              : selectedAction === 'block_finder'
              ? 'Generate highlighted artifact'
              : 'Run action'}
          </button>
          
          {/* TODO: DEV */}
          {selectedAction === 'extract_json_from_pdf' && (
            <button
              onClick={loadDevJson}
              disabled={loading || isBatchRunning}
              className="w-full mt-2 bg-amber-600/20 hover:bg-amber-600/30 text-amber-500 border border-amber-600/50 py-2 rounded-xl font-mono text-xs transition-all"
            >
              DEV: Load test_content.json
            </button>
          )}
          {/* END DEV */}

          <button
            onClick={addSelectedActionToWorkflow}
            disabled={isActionInProgress || isBatchRunning}
            className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-900 disabled:text-zinc-500 text-zinc-200 py-2 rounded-xl font-semibold transition-all text-sm"
          >
            Add to workflow
          </button>
        </div>

        {workflowMessage && (
          <div
            className={`mt-4 text-xs p-3 rounded-xl border wrap-break-word ${
              workflowMessage.type === 'error'
                ? 'text-red-200 bg-red-950/40 border-red-900'
                : workflowMessage.type === 'success'
                ? 'text-emerald-200 bg-emerald-950/40 border-emerald-900'
                : 'text-sky-200 bg-sky-950/40 border-sky-900'
            }`}
          >
            {workflowMessage.message}
          </div>
        )}
      </div>

      <div className="mt-1">
        {editSessionEnabled ? (
          <div className="bg-zinc-950/45 border border-zinc-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold">JSON editor</div>
                <div className="text-[11px] text-zinc-400 mt-1">Only active for Edit JSON</div>
              </div>
              <div className="text-[11px] text-zinc-500">{editSessionEnabled ? 'editing' : 'preview'}</div>
            </div>

            <div className="text-xs text-zinc-400 mb-3 bg-zinc-800/50 p-3 rounded-xl">
              {editSessionEnabled
                ? 'Click a box on the PDF to edit only that box metadata.'
                : 'Run "Edit JSON" to enable box selection and editing.'}
            </div>

            {selectedTarget === null ? (
              <div className="h-36 flex items-center justify-center text-sm text-zinc-500 border border-dashed border-zinc-700 rounded-2xl px-6 text-center">
                No box selected.
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="text-xs text-zinc-500 bg-zinc-800/40 p-3 rounded-xl">
                  {selectedTarget.kind === 'tableCell'
                    ? `Selected table cell: #${selectedTarget.blockIndex + 1} R${selectedTarget.row + 1} C${selectedTarget.col + 1}`
                    : selectedTarget.kind === 'tableCaption'
                    ? `Selected table caption: #${selectedTarget.blockIndex + 1} (caption ${selectedTarget.captionIndex + 1})`
                    : `Selected box: #${selectedTarget.blockIndex + 1}`}
                </div>
                {selectedBlock && (
                  <div className="text-xs text-zinc-500 bg-zinc-800/40 p-3 rounded-xl">
                    Page: {selectedBlock.page ?? 1}
                  </div>
                )}
                <textarea
                  className="w-full h-40 p-4 bg-zinc-950 border border-zinc-700 rounded-2xl text-sm text-zinc-300 focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all shadow-inner"
                  value={selectedContent}
                  onChange={(e) => updateSelectedContent(e.target.value)}
                  disabled={!editSessionEnabled}
                  readOnly={!editSessionEnabled}
                />
              </div>
            )}

            {jsonError && (
              <div className="mt-3 text-xs text-red-300 bg-red-950/40 border border-red-900 p-3 rounded-xl">
                Invalid JSON: {jsonError}
              </div>
            )}

            <button
              onClick={applyBlockChanges}
              disabled={loading || !editSessionEnabled}
              className="mt-4 w-full bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-100 py-2 rounded-2xl font-semibold transition-all text-sm flex items-center justify-center gap-2"
            >
              {loading ? 'Saving...' : 'Save block changes'}
              <CheckCircle2 className="w-4 h-4" />
            </button>

            <button
              onClick={() => finalizeEditedJson()}
              disabled={!editSessionEnabled || actionInProgress !== 'edit_json' || loading}
              className="mt-3 w-full bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-800 disabled:text-zinc-500 text-white py-3 rounded-2xl font-semibold transition-all"
            >
              Finish editing
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
        ) : null}
      </div>

      <div className="mt-auto text-xs text-zinc-400 bg-zinc-800/40 p-3 rounded-xl border border-zinc-700">
        Only one workflow action can run at a time. Finish the current action before starting the next.
      </div>
    </div>
  );

  // Render PDF page preview and interactive overlay boxes.
  const renderPdfViewerPanel = () => {
    if (!pdfFile) {
      return (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-6 h-full flex items-center justify-center text-zinc-500 text-sm text-center">
          Import a PDF to start the workflow.
        </div>
      );
    }

    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-4 h-full flex flex-col min-h-170">
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
          <div ref={pdfViewerScrollRef} className="flex-1 min-h-120 overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950/50">
            <Document file={pdfFile} onLoadSuccess={onDocumentLoadSuccess}>
              <div className="relative" style={{ minHeight: lastRenderedPageHeight || undefined }}>
                <Page
                  key={`pdf-page-${pageRefreshTick}`}
                  pageNumber={currentPage}
                  scale={1.5}
                  onLoadSuccess={(page) => onPageLoadSuccess(page.pageNumber, page)}
                  onLoadError={() => null}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />

                {showJsonOverlays && pageSizes[currentPage] && (
                  <div
                        className="absolute top-0 left-0 pointer-events-none"
                    style={{ width: pageSizes[currentPage].width, height: pageSizes[currentPage].height }}
                  >
                    {currentPageBlocks.map(({ block, index }: { block: any; index: number }) => {
                      const box = block?.box;
                      if (!Array.isArray(box) || box.length !== 4) return null;

                      const [x1, y1, x2, y2] = box;
                      const left = x1 * pageSizes[currentPage].scale;
                      const top = y1 * pageSizes[currentPage].scale;
                      const width = (x2 - x1) * pageSizes[currentPage].scale;
                      const height = (y2 - y1) * pageSizes[currentPage].scale;
                      const isSelectedBlock = selectedTarget?.kind === 'block' && selectedTarget.blockIndex === index;
                      const isTextFinderHighlighted = Boolean(block?.text_finder_highlighted);
                      const isBlockFinderHighlighted = Boolean(block?.block_finder_highlighted);
                      const highlightMode = isTextFinderHighlighted && isBlockFinderHighlighted
                        ? 'both'
                        : isTextFinderHighlighted
                        ? 'text'
                        : isBlockFinderHighlighted
                        ? 'block'
                        : 'none';

                      if (isTableWithGrid(block)) {
                        const tableRows = Array.isArray(block.block) ? block.block : [];
                        const { rows, cols } = getTableDimensions(tableRows);
                        const safeRows = Math.max(1, rows);
                        const cellBoxesMatrix = getCellBoxesMatrix(block, safeRows, cols);
                        const hasEditableCells = cellBoxesMatrix.some((row) => row.some((cell) => cell !== null));

                        const captionBoxes = getCaptionBoxes(block);
                        const hasEditableCaption = captionBoxes.length > 0;
                        const isTableEditable = hasEditableCells || hasEditableCaption;

                        if (!isTableEditable) {
                          return (
                            <div
                              key={`${index}-not-editable`}
                              className="absolute pointer-events-none border border-rose-400/70 bg-rose-500/10 text-rose-200 text-[11px] font-medium px-2 py-1"
                              style={{ left, top, width, height: Math.max(20, Math.min(32, height)) }}
                              title="Not possible to edit this table"
                            >
                              Not possible to edit this table
                            </div>
                          );
                        }

                        return (
                          <React.Fragment key={index}>
                            {Array.from({ length: safeRows }).map((_, rowIdx) =>
                              Array.from({ length: cols }).map((__, colIdx) => {
                                const cellSelected =
                                  selectedTarget?.kind === 'tableCell' &&
                                  selectedTarget.blockIndex === index &&
                                  selectedTarget.row === rowIdx &&
                                  selectedTarget.col === colIdx;

                                const precise = cellBoxesMatrix[rowIdx][colIdx];
                                if (!precise) return null;

                                const [cx1, cy1, cx2, cy2] = precise;

                                return (
                                  <div
                                    key={`${index}-cell-${rowIdx}-${colIdx}`}
                                    className={`absolute overflow-hidden transition-colors ${
                                      editSessionEnabled
                                        ? 'pointer-events-auto cursor-pointer'
                                        : highlightMode !== 'none'
                                        ? 'pointer-events-auto cursor-help opacity-60'
                                        : 'pointer-events-none cursor-default opacity-60'
                                    } ${
                                      cellSelected
                                        ? 'border-2 border-amber-300 bg-amber-300/20'
                                        : highlightMode === 'both'
                                        ? 'border border-rose-300/90 bg-rose-300/22 hover:bg-rose-300/32'
                                        : highlightMode === 'text'
                                        ? 'border border-orange-300/90 bg-orange-300/22 hover:bg-orange-300/32'
                                        : highlightMode === 'block'
                                        ? 'border border-violet-500/95 bg-violet-500/35 hover:bg-violet-500/48'
                                        : 'border border-blue-400/80 bg-blue-400/10'
                                    }`}
                                    title={buildFinderOverlayTitle(block)}
                                    style={{
                                      left: cx1 * pageSizes[currentPage].scale,
                                      top: cy1 * pageSizes[currentPage].scale,
                                      width: Math.max(8, (cx2 - cx1) * pageSizes[currentPage].scale),
                                      height: Math.max(8, (cy2 - cy1) * pageSizes[currentPage].scale),
                                    }}
                                    onClick={() => {
                                      if (!editSessionEnabled) {
                                        setWorkflowMessage({ type: 'info', message: 'Run "Edit JSON" to enable editing.' });
                                        return;
                                      }
                                      setSelectedTarget({ kind: 'tableCell', blockIndex: index, row: rowIdx, col: colIdx });
                                    }}
                                  />
                                );
                              })
                            )}

                            {captionBoxes.map((captionBox, captionIdx) => {
                              const [cx1, cy1, cx2, cy2] = captionBox;
                              return (
                                <div
                                  key={`${index}-caption-${captionIdx}`}
                                  className={`absolute overflow-hidden transition-colors ${
                                    editSessionEnabled
                                      ? 'pointer-events-auto cursor-pointer'
                                      : highlightMode !== 'none'
                                      ? 'pointer-events-auto cursor-help opacity-60'
                                      : 'pointer-events-none cursor-default opacity-60'
                                  } ${
                                    selectedTarget?.kind === 'tableCaption' && selectedTarget.blockIndex === index && selectedTarget.captionIndex === captionIdx
                                      ? 'border-2 border-amber-300 bg-amber-300/20'
                                      : highlightMode === 'both'
                                      ? 'border border-rose-300/90 bg-rose-300/22 hover:bg-rose-300/32'
                                      : highlightMode === 'text'
                                      ? 'border border-orange-300/90 bg-orange-300/22 hover:bg-orange-300/32'
                                      : highlightMode === 'block'
                                      ? 'border border-violet-500/95 bg-violet-500/35 hover:bg-violet-500/48'
                                      : 'border border-blue-400/80 bg-blue-400/10'
                                  }`}
                                  title={buildFinderOverlayTitle(block)}
                                  style={{
                                    left: cx1 * pageSizes[currentPage].scale,
                                    top: cy1 * pageSizes[currentPage].scale,
                                    width: Math.max(8, (cx2 - cx1) * pageSizes[currentPage].scale),
                                    height: Math.max(8, (cy2 - cy1) * pageSizes[currentPage].scale),
                                  }}
                                  onClick={() => {
                                    if (!editSessionEnabled) {
                                      setWorkflowMessage({ type: 'info', message: 'Run "Edit JSON" to enable editing.' });
                                      return;
                                    }
                                    setSelectedTarget({ kind: 'tableCaption', blockIndex: index, captionIndex: captionIdx });
                                  }}
                                />
                              );
                            })}
                          </React.Fragment>
                        );
                      }

                      return (
                        <div
                          key={index}
                          className={`absolute overflow-hidden transition-colors ${
                            editSessionEnabled
                              ? 'pointer-events-auto cursor-pointer'
                              : highlightMode !== 'none'
                              ? 'pointer-events-auto cursor-help opacity-60'
                              : 'pointer-events-none cursor-default opacity-60'
                          } ${
                            isSelectedBlock
                              ? 'border-2 border-amber-300 bg-amber-300/20'
                              : highlightMode === 'both'
                              ? 'border-2 border-rose-300 bg-rose-300/20 hover:bg-rose-300/30'
                              : highlightMode === 'text'
                              ? 'border-2 border-orange-300 bg-orange-300/20 hover:bg-orange-300/30'
                              : highlightMode === 'block'
                              ? 'border-2 border-violet-500 bg-violet-500/34 hover:bg-violet-500/48'
                              : 'border border-blue-400/80 bg-blue-400/10'
                          }`}
                          style={{ left, top, width, height }}
                          title={buildFinderOverlayTitle(block)}
                          onClick={() => {
                            if (!editSessionEnabled) {
                              setWorkflowMessage({ type: 'info', message: 'Run "Edit JSON" to enable editing.' });
                              return;
                            }
                            setSelectedTarget({ kind: 'block', blockIndex: index });
                          }}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </Document>
          </div>

          <div className="flex items-center justify-between gap-3 p-3 border border-zinc-800 rounded-2xl bg-zinc-950/60">
            <button
              onClick={goToPreviousPage}
              disabled={currentPage <= 1}
              className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span>Page</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={pageJumpValue}
                onChange={(e) => setPageJumpValue(e.target.value.replace(/\D/g, ''))}
                onBlur={submitPageJump}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitPageJump();
                  }
                }}
                className="w-20 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-200 outline-none focus:border-blue-600"
              />
              <span>/ {numPages || 1}</span>
            </div>
            <button
              onClick={goToNextPage}
              disabled={currentPage >= (numPages || 1)}
              className="px-4 py-2 rounded-xl bg-zinc-800 text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render artifact availability badges for current workflow state.
  const renderArtifactsBar = () => (
    <div className="w-full mb-3">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-4 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-zinc-300">
          <Braces className="w-4 h-4 text-blue-500" />
          <span className="text-zinc-500 uppercase tracking-[0.2em] text-[11px]">Artifacts</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <div className={`px-3 py-2 rounded-xl border ${hasPdfArtifact ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900' : 'text-zinc-400 bg-zinc-800/40 border-zinc-700'}`}>
            PDF: {hasPdfArtifact ? 'available' : 'missing'}
          </div>
          <div className={`px-3 py-2 rounded-xl border ${hasJsonArtifact ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900' : 'text-zinc-400 bg-zinc-800/40 border-zinc-700'}`}>
            JSON: {hasJsonArtifact ? 'available' : 'missing'}
          </div>
          <div className={`px-3 py-2 rounded-xl border ${hasEditedJson ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900' : 'text-zinc-400 bg-zinc-800/40 border-zinc-700'}`}>
            Edited: {hasEditedJson ? 'available' : 'missing'}
          </div>
          <div className={`px-3 py-2 rounded-xl border ${hasUpgradedArtifact ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900' : 'text-zinc-400 bg-zinc-800/40 border-zinc-700'}`}>
            Upgraded: {hasUpgradedArtifact ? 'available' : 'missing'}
          </div>
          <div className={`px-3 py-2 rounded-xl border ${hasTextFinderArtifact ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900' : 'text-zinc-400 bg-zinc-800/40 border-zinc-700'}`}>
            Text Finder: {hasTextFinderArtifact ? 'available' : 'missing'}
          </div>
          <div className={`px-3 py-2 rounded-xl border ${hasBlockFinderArtifact ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900' : 'text-zinc-400 bg-zinc-800/40 border-zinc-700'}`}>
            Block Finder: {hasBlockFinderArtifact ? 'available' : 'missing'}
          </div>
        </div>
      </div>
    </div>
  );

  // Render export controls and status feedback panel.
  const renderExportCard = () => (
    <div style={{ width: RIGHT_RAIL_WIDTH_PX }} className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500 font-semibold mb-3">Export</div>
      <button
        onClick={chooseOutputFolder}
        className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-2xl font-semibold transition-all flex items-center justify-center gap-2"
      >
        <FolderOpen className="w-4 h-4" /> Choose Output Folder
      </button>
      <div
        className={`mt-3 text-xs rounded-xl px-3 py-2 border whitespace-normal break-all leading-relaxed ${
          outputFolderHandle
            ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900'
            : 'text-zinc-400 bg-zinc-950/40 border-zinc-700'
        }`}
      >
        {outputFolderHandle ? `Selected: ${outputFolderName}` : 'No folder selected yet'}
      </div>
      <button
        onClick={exportJson}
        disabled={!parsedData || !outputFolderHandle}
        className="mt-3 w-full py-3 bg-white text-black rounded-2xl font-black text-base hover:bg-zinc-200 transition-all disabled:bg-zinc-800 disabled:text-zinc-500 flex items-center justify-center gap-3"
      >
        <Download className="w-5 h-5" />
        Export artifacts
      </button>
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
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center p-6 font-sans">
      {!pdfFile && (
        <div className="mt-20 bg-zinc-900 p-16 rounded-3xl border border-zinc-800 text-center shadow-2xl max-w-lg w-full">
          <div className="bg-blue-600/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <FileText className="w-10 h-10 text-blue-500" />
          </div>
          <h1 className="text-4xl font-black mb-2 tracking-tighter">PDF METADATA EDITOR</h1>
          <p className="text-zinc-500 mb-10 text-lg">Choose a PDF to start the workflow.</p>

          <label className="cursor-pointer group">
            <div className="bg-blue-600 group-hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-2xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-3">
              <Upload className="w-5 h-5" /> Import PDF
            </div>
            <input type="file" onChange={handleImportPdf} className="hidden" accept=".pdf" />
          </label>

          {loading && (
            <div className="mt-10 flex items-center justify-center gap-3 text-blue-400 font-mono text-sm animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" /> PROCESSING...
            </div>
          )}
        </div>
      )}

      {pdfFile && (
        <div className="w-full max-w-420 grid gap-6" style={{ gridTemplateColumns: `minmax(0, 1fr) ${RIGHT_RAIL_WIDTH_PX}px` }}>
          <div className="min-w-0">
            {renderArtifactsBar()}

            <div className="grid gap-6" style={{ gridTemplateColumns: '360px minmax(0, 1fr)' }}>
              <div>{renderActionsColumn()}</div>

              <div>
                {renderPdfViewerPanel()}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            {renderExportCard()}
            <div className="flex-1">{renderWorkflowRail()}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;