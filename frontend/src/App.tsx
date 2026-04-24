import React, { useEffect, useState } from 'react';
import { FileText, Upload, Loader2 } from 'lucide-react';

// API and Libs
import * as api from './api/actions';
import { 
  toCanonicalContentJson, 
  buildAssetUrl, 
  stripNativeImagesPrefix, 
  sanitizePathSegments 
} from './lib/pdfArtifacts';
import { WorkflowActionId, UpgradeMode, WORKFLOW_ACTION_LABELS } from './lib/workflow';

// Hooks
import { usePDFState, useWorkflow, useArtifacts } from './hooks';

// Components
import { ArtifactsBar } from './components/layout/ArtifactsBar';
import { ActionSelector } from './features/actions/ActionSelector';
import { ExtractionAction } from './features/actions/ExtractionAction';
import { BlockExtractorAction } from './features/actions/BlockExtractorAction';
import { UpgradeAction } from './features/actions/UpgradeAction';
import { TextFinderAction } from './features/actions/TextFinderAction';
import { BlockFinderAction } from './features/actions/BlockFinderAction';
import { EditJsonAction } from './features/actions/EditJsonAction';
import { PDFViewer } from './features/viewer/PDFViewer';
import { BoundingBoxes } from './features/viewer/BoundingBoxes';
import { WorkflowRail } from './features/workflow/WorkflowRail';
import { ExportPanel } from './features/export/ExportPanel';

const RIGHT_RAIL_WIDTH = 380;

const App: React.FC = () => {
  // Initialize Hooks
  const pdf = usePDFState();
  const workflow = useWorkflow();
  const artifacts = useArtifacts();

  // Local State for UI Controls
  const [selectedAction, setSelectedAction] = useState<WorkflowActionId>('extract_json_from_pdf');
  const [loading, setLoading] = useState(false);
  
  // Extraction settings
  const [processor, setProcessor] = useState('pdf2data');
  const [processorOptions, setProcessorOptions] = useState<any[]>([]);
  const [layoutModel, setLayoutModel] = useState('auto');
  const [tableModel, setTableModel] = useState('none');
  
  // Upgrade settings
  const [upgradeMode, setUpgradeMode] = useState<UpgradeMode>('both');

  // Finder settings
  const [tfThreshold, setTfThreshold] = useState(6);
  const [tfFindParagraphs, setTfFindParagraphs] = useState(true);
  const [tfFindSectionHeaders, setTfFindSectionHeaders] = useState(true);
  const [tfCountDuplicates, setTfCountDuplicates] = useState(false);
  const [tfFile, setTfFile] = useState<File | null>(null);
  const [tfFileName, setTfFileName] = useState('No file selected');

  const [bfFindTables, setBfFindTables] = useState(true);
  const [bfFindFigures, setBfFindFigures] = useState(false);
  const [bfFile, setBfFile] = useState<File | null>(null);
  const [bfFileName, setBfFileName] = useState('No file selected');

  const [beUseExistingJson, setBeUseExistingJson] = useState(true);

  const [pendingBatchResumeQueue, setPendingBatchResumeQueue] = useState<any[] | null>(null);

  // Load available processors on mount
  useEffect(() => {
    api.fetchProcessors()
      .then(res => setProcessorOptions(res.processors))
      .catch(console.error);
  }, []);

  // Cleanup effect for workflow messages
  useEffect(() => {
    if (!workflow.workflowMessage) return;
    if (workflow.workflowMessage.type === 'error') return;

    const timeoutId = window.setTimeout(() => {
      workflow.setWorkflowMessage(null);
    }, 3600);

    return () => window.clearTimeout(timeoutId);
  }, [workflow.workflowMessage]);

  // Force a fresh PDF page render whenever a new document is loaded.
  useEffect(() => {
    if (!artifacts.docData) return;
    pdf.setCurrentPage(1);
    pdf.setPageJumpValue('1');
    pdf.forcePageRefresh();
  }, [artifacts.docData, pdf.forcePageRefresh, pdf.setCurrentPage, pdf.setPageJumpValue]);

  // Batch resume worker
  useEffect(() => {
    if (!pendingBatchResumeQueue) return;
    if (workflow.actionInProgress !== null) return;
    if (workflow.actionInProgress === 'edit_json') return;

    const queueToResume = pendingBatchResumeQueue;
    setPendingBatchResumeQueue(null);
    void continueBatchWorkflow(queueToResume);
  }, [pendingBatchResumeQueue, workflow.actionInProgress]);

  // File parsing helpers
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

  const handleSelectPdfFile = (file: File) => {
    pdf.setPdfFile(file);
    pdf.setSourceFilename(file.name || 'metadata');
    pdf.setCurrentPage(1);
    pdf.setPageJumpValue('1');
    pdf.setPageSizes({});
    artifacts.resetArtifacts();
    workflow.resetWorkflowState();
    setSelectedAction('extract_json_from_pdf');
    setPendingBatchResumeQueue(null);
    setBeUseExistingJson(true);
  };

  // Condition to check if an action can be ran
  const canRunAction = (action: WorkflowActionId) => {
    if (action === 'extract_json_from_pdf') return !!pdf.pdfFile;
    if (action === 'edit_json') return artifacts.docData || artifacts.parsedData;
    if (action === 'upgrade_json') return artifacts.docData || artifacts.parsedData;
    if (action === 'text_finder') return (artifacts.docData || artifacts.parsedData) && !!tfFile;
    if (action === 'block_finder') return (artifacts.docData || artifacts.parsedData) && !!bfFile;
    if (action === 'block_extractor') return !!pdf.pdfFile || !!(artifacts.docData || artifacts.parsedData);
    return false;
  };

  // Action Handlers
  const handleExtract = async () => {
    if (!pdf.pdfFile) return false;
    workflow.setActionInProgress('extract_json_from_pdf');
    setLoading(true);
    try {
      const data = await api.uploadPdf(pdf.pdfFile, pdf.sourceFilename, processor, layoutModel, tableModel);
      artifacts.setDocData(data);
      artifacts.workflowJsonRef.current = data;
      artifacts.setJsonDraft(JSON.stringify(data, null, 2));
      artifacts.setSelectedTarget(null);
      artifacts.setSelectedContent('');
      
      workflow.appendWorkflowPath('extract_json_from_pdf', 'done', `Blocks: ${data.blocks?.length}`);
      pdf.onDocumentLoadSuccess({ numPages: data.page_sizes?.length || 0 });
      return true;
    } catch (err: any) {
      workflow.setWorkflowMessage({ type: 'error', message: err.message });
      workflow.appendWorkflowPath('extract_json_from_pdf', 'failed', err.message);
      return false;
    } finally {
      setLoading(false);
      workflow.setActionInProgress(null);
    }
  };

  const handleUpgrade = async () => {
    const currentJson = artifacts.getWorkflowJsonArtifact();
    if (!currentJson) return false;
    workflow.setActionInProgress('upgrade_json');
    setLoading(true);
    try {
      const res = await api.upgradeJson(currentJson, upgradeMode);
      artifacts.setUpgradedJson(res.data);
      artifacts.workflowJsonRef.current = res.data;
      artifacts.setJsonDraft(JSON.stringify(res.data, null, 2));
      workflow.appendWorkflowPath('upgrade_json', 'done', `Mode: ${upgradeMode}`);
      return true;
    } catch (err: any) {
      workflow.appendWorkflowPath('upgrade_json', 'failed', err.message);
      return false;
    } finally {
      setLoading(false);
      workflow.setActionInProgress(null);
    }
  };

  const handleTextFinder = async () => {
    const currentJson = artifacts.getWorkflowJsonArtifact();
    if (!currentJson || !tfFile) return false;
    workflow.setActionInProgress('text_finder');
    setLoading(true);
    try {
      const keywords = await parseTextFinderKeywordsFile(tfFile);
      const res = await api.runTextFinder({
        data: currentJson,
        keywords,
        wordCountThreshold: tfThreshold,
        findParagraphs: tfFindParagraphs,
        findSectionHeaders: tfFindSectionHeaders,
        countDuplicates: tfCountDuplicates,
      });

      const highlightedArtifact = res.data;
      artifacts.setTextFinderFoundArtifact(res.found_texts_artifact || { matches: [], total_matches: 0, unique_matches: 0, settings: {} });
      artifacts.setTextFinderArtifact(highlightedArtifact);
      artifacts.workflowJsonRef.current = highlightedArtifact;
      artifacts.setJsonDraft(JSON.stringify(highlightedArtifact, null, 2));

      workflow.appendWorkflowPath('text_finder', 'done', `Highlighted ${res.summary?.highlighted_count} blocks`);
      return true;
    } catch (err: any) {
      workflow.appendWorkflowPath('text_finder', 'failed', err.message);
      return false;
    } finally {
      setLoading(false);
      workflow.setActionInProgress(null);
    }
  };

  const handleBlockFinder = async () => {
    const currentJson = artifacts.getWorkflowJsonArtifact();
    if (!currentJson || !bfFile) return false;
    workflow.setActionInProgress('block_finder');
    setLoading(true);
    try {
      const keywords = await parseBlockFinderKeywordsFile(bfFile);
      const res = await api.runBlockFinder({
        data: currentJson,
        keywords,
        findTables: bfFindTables,
        findFigures: bfFindFigures,
      });

      const highlightedArtifact = res.data;
      artifacts.setBlockFinderFoundArtifact(res.found_blocks_artifact || { blocks: [], total_matches: 0, unique_matches: 0, settings: {} });
      artifacts.setBlockFinderArtifact(highlightedArtifact);
      artifacts.workflowJsonRef.current = highlightedArtifact;
      artifacts.setJsonDraft(JSON.stringify(highlightedArtifact, null, 2));

      workflow.appendWorkflowPath('block_finder', 'done', `Highlighted ${res.summary?.highlighted_count} blocks`);
      return true;
    } catch (err: any) {
      workflow.appendWorkflowPath('block_finder', 'failed', err.message);
      return false;
    } finally {
      setLoading(false);
      workflow.setActionInProgress(null);
    }
  };

  const handleBlockExtractor = async () => {
    const currentJson = artifacts.getWorkflowJsonArtifact();
    const hasPdf = !!pdf.pdfFile;
    const useFastPath = beUseExistingJson && !!currentJson;

    if (!hasPdf && !useFastPath) return false;
    workflow.setActionInProgress('block_extractor');
    setLoading(true);
    try {
      const res = await api.runBlockExtractor({
        file: hasPdf ? pdf.pdfFile : null,
        filename: pdf.sourceFilename,
        processor,
        pdf2dataLayoutModel: layoutModel,
        pdf2dataTableModel: tableModel,
        useExistingJson: useFastPath,
        existingJson: useFastPath ? currentJson : undefined,
      });

      const extractedArtifact = res.data;
      artifacts.setBlockExtractorArtifact(extractedArtifact);
      artifacts.workflowJsonRef.current = extractedArtifact;
      artifacts.setJsonDraft(JSON.stringify(extractedArtifact, null, 2));

      workflow.appendWorkflowPath('block_extractor', 'done', `Extracted ${res.summary?.tables_after ?? extractedArtifact?.blocks?.length ?? 0} tables`);
      return true;
    } catch (err: any) {
      workflow.appendWorkflowPath('block_extractor', 'failed', err.message);
      return false;
    } finally {
      setLoading(false);
      workflow.setActionInProgress(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!artifacts.selectedTarget || !artifacts.parsedData) return;
    setLoading(true);
    try {
      const res = await api.editJsonBlock(artifacts.parsedData, artifacts.selectedTarget, artifacts.selectedContent);
      const nextJson = res.canonical || res.data;
      artifacts.setJsonDraft(JSON.stringify(nextJson, null, 2));
      artifacts.workflowJsonRef.current = nextJson;
      artifacts.setEditorFeedback({ type: 'success', message: 'Block saved.' });
    } catch (err: any) {
      artifacts.setEditorFeedback({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const finalizeEditedJson = async () => {
    if (!artifacts.parsedData) return;
    try {
      const committed = JSON.parse(JSON.stringify(artifacts.parsedData));
      artifacts.setEditedJson(committed);
      artifacts.workflowJsonRef.current = committed;
      artifacts.setHasEditedJson(true);
      artifacts.setSelectedTarget(null);
      artifacts.setSelectedContent('');
      workflow.setActionInProgress(null);
      workflow.appendWorkflowPath('edit_json', 'done', 'Edits finalized');

      if (workflow.isBatchRunning && workflow.workflowQueue.length > 0) {
        const nextQueue = [...workflow.workflowQueue];
        workflow.setBatchStatus('running');
        setPendingBatchResumeQueue(nextQueue);
      } else if (workflow.isBatchRunning) {
        workflow.setIsBatchRunning(false);
        workflow.setBatchStatus('completed');
      }
    } catch (err: any) {
      workflow.setWorkflowMessage({ type: 'error', message: 'Failed to finalize edits.' });
    }
  };

  const continueBatchWorkflow = async (queueOverride?: any[]) => {
    let queue = queueOverride ?? workflow.workflowQueue;
    let extractedInThisBatchRun = false;

    while (queue.length > 0) {
      const [nextItem, ...rest] = queue;
      const nextAction = nextItem.actionId;

      if (!nextItem.selected) {
        workflow.appendWorkflowPath(nextAction, 'skipped', 'Deselected in workflow queue.');
        queue = rest;
        workflow.setWorkflowQueue(queue);
        await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 0));
        continue;
      }
      
      setProcessor(nextItem.processor);
      setLayoutModel(nextItem.pdf2dataLayoutModel);
      setTableModel(nextItem.pdf2dataTableModel);
      setUpgradeMode(nextItem.upgradeMode);
      setBeUseExistingJson(Boolean(nextItem.blockExtractorUseExistingJson ?? true));
      setSelectedAction(nextAction);

      if (nextAction === 'edit_json') {
        workflow.setActionInProgress('edit_json');
        workflow.setWorkflowQueue(rest);
        workflow.setBatchStatus('paused');
        return;
      }

      let ok = false;
      if (nextAction === 'extract_json_from_pdf') ok = await handleExtract();
      else if (nextAction === 'upgrade_json') ok = await handleUpgrade();
      else if (nextAction === 'text_finder') ok = await handleTextFinder();
      else if (nextAction === 'block_finder') ok = await handleBlockFinder();
      else if (nextAction === 'block_extractor') ok = await handleBlockExtractor();
      
      if (!ok) {
        workflow.setIsBatchRunning(false);
        workflow.setWorkflowQueue([]);
        workflow.setBatchStatus('failed');
        return;
      }

      if (nextAction === 'extract_json_from_pdf') {
        extractedInThisBatchRun = true;
      }

      queue = rest;
      workflow.setWorkflowQueue(queue);
      await new Promise<void>((resolve) => window.setTimeout(() => resolve(), 0));
    }

    workflow.setIsBatchRunning(false);
    workflow.setWorkflowQueue([]);
    workflow.setBatchStatus('completed');
  };

  const runBatchWorkflow = async () => {
    const selectedQueue = workflow.plannedWorkflow.filter(item => item.selected);
    if (!selectedQueue.length) return;

    workflow.setIsBatchRunning(true);
    workflow.setActiveWorkflowView('executed');
    workflow.setWorkflowQueue(selectedQueue);
    workflow.setBatchStatus('running');
    await continueBatchWorkflow(selectedQueue);
  };

  const cloneJson = (value: any) => JSON.parse(JSON.stringify(value));

  const rewriteAssetPaths = (snapshot: any, exportedAssetPaths: Map<string, string>) => {
    if (!snapshot || !Array.isArray(snapshot.blocks)) return;

    for (const block of snapshot.blocks) {
      if (typeof block?.filepath !== 'string') continue;
      const key = block.filepath.trim();
      if (!key) continue;

      const direct = exportedAssetPaths.get(key);
      if (direct) {
        block.filepath = direct;
        continue;
      }

      const bySuffix = Array.from(exportedAssetPaths.entries()).find(([src]) => src.endsWith(key));
      if (bySuffix) block.filepath = bySuffix[1];
    }
  };

  const buildFinderExportSnapshot = (snapshot: any, foundArtifact: any, mode: 'text' | 'block', fallbackSettings: Record<string, any>) => {
    const blocks = Array.isArray(snapshot?.blocks) ? snapshot.blocks : [];
    const highlightedKey = mode === 'text' ? 'text_finder_highlighted' : 'block_finder_highlighted';
    const highlightedBlocks = blocks.filter((block: any) => Boolean(block?.[highlightedKey]));

    return {
      blocks: highlightedBlocks,
      total_matches: Number(foundArtifact?.total_matches ?? highlightedBlocks.length),
      unique_matches: Number(foundArtifact?.unique_matches ?? highlightedBlocks.length),
      settings: foundArtifact?.settings ?? fallbackSettings,
    };
  };

  // Export Logic
  const handleExport = async () => {
    if (!artifacts.parsedData || !artifacts.outputFolderHandle) return;
    try {
      const baseName = pdf.sourceFilename.replace(/\.[^/.]+$/, '') || 'metadata';
      const safeName = baseName.split('').map((ch) => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_')).join('');
      const folderName = safeName || 'metadata';
      
      const docFolder = await artifacts.outputFolderHandle.getDirectoryHandle(folderName, { create: true });
      const imagesFolder = await docFolder.getDirectoryHandle(`${folderName}_images`, { create: true });
      
      const docId = String(artifacts.docData?.id || '').trim();
      if (!docId) throw new Error('Missing document id for asset export. Upload the PDF again.');

      const manifestPayload = await api.fetchAssetManifest(docId);
      const manifestAssets: string[] = Array.isArray(manifestPayload?.assets) ? manifestPayload.assets : [];

      const exportedAssetPaths = new Map<string, string>();

      for (const rawPath of manifestAssets) {
        const trimmedPath = String(rawPath || '').trim();
        if (!trimmedPath) continue;

        const normalizedRelative = stripNativeImagesPrefix(trimmedPath);
        const safeSegments = sanitizePathSegments(normalizedRelative);
        if (!safeSegments.length) continue;

        try {
          const response = await fetch(buildAssetUrl(docId, trimmedPath));
          if (!response.ok) continue;

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

          exportedAssetPaths.set(trimmedPath, `${folderName}_images/${safeSegments.join('/')}`);
        } catch { /* skip failed image */ }
      }

      const snapshots: Array<{ name: string; data: any }> = [];

      const baseSnapshot = cloneJson(artifacts.docData ?? artifacts.parsedData);
      rewriteAssetPaths(baseSnapshot, exportedAssetPaths);
      snapshots.push({ name: `${folderName}_content.json`, data: toCanonicalContentJson(baseSnapshot) });

      if (artifacts.editedJson) {
        const editedSnapshot = cloneJson(artifacts.editedJson);
        rewriteAssetPaths(editedSnapshot, exportedAssetPaths);
        snapshots.push({ name: `${folderName}_edited_content.json`, data: toCanonicalContentJson(editedSnapshot) });
      }

      if (artifacts.upgradedJson) {
        const upgradedSnapshot = cloneJson(artifacts.upgradedJson);
        rewriteAssetPaths(upgradedSnapshot, exportedAssetPaths);
        snapshots.push({ name: `${folderName}_upgraded_content.json`, data: toCanonicalContentJson(upgradedSnapshot) });
      }

      if (artifacts.textFinderArtifact) {
        const textSnapshot = cloneJson(artifacts.textFinderArtifact);
        rewriteAssetPaths(textSnapshot, exportedAssetPaths);
        snapshots.push({
          name: `${folderName}_text_finder_content.json`,
          data: buildFinderExportSnapshot(
            textSnapshot,
            artifacts.textFinderFoundArtifact,
            'text',
            {
              word_count_threshold: tfThreshold,
              find_paragraphs: tfFindParagraphs,
              find_section_headers: tfFindSectionHeaders,
              count_duplicates: tfCountDuplicates,
            },
          ),
        });
      }

      if (artifacts.blockFinderArtifact) {
        const blockSnapshot = cloneJson(artifacts.blockFinderArtifact);
        rewriteAssetPaths(blockSnapshot, exportedAssetPaths);
        snapshots.push({
          name: `${folderName}_block_finder_content.json`,
          data: buildFinderExportSnapshot(
            blockSnapshot,
            artifacts.blockFinderFoundArtifact,
            'block',
            {
              find_tables: bfFindTables,
              find_figures: bfFindFigures,
            },
          ),
        });
      }

      if (artifacts.blockExtractorArtifact) {
        const blockExtractorSnapshot = cloneJson(artifacts.blockExtractorArtifact);
        rewriteAssetPaths(blockExtractorSnapshot, exportedAssetPaths);
        snapshots.push({
          name: `${folderName}_block_extractor_content.json`,
          data: toCanonicalContentJson(blockExtractorSnapshot),
        });
      }

      for (const item of snapshots) {
        const fileHandle = await docFolder.getFileHandle(item.name, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(item.data, null, 2));
        await writable.close();
      }
      
      artifacts.setExportFeedback({ type: 'success', message: `Export completed successfully (${snapshots.length} JSON file(s)).` });
    } catch (err: any) {
      artifacts.setExportFeedback({ type: 'error', message: err.message });
    }
  };

  const buildFinderOverlayTitle = (block: any) => {
    let title = '';
    if (block?.text_finder_highlighted) title += `Text match (${block.text_finder_match_score || 0})`;
    if (block?.block_finder_highlighted) title += `${title ? ' | ' : ''}Block match (${block.block_finder_match_score || 0})`;
    return title;
  };

  // Render UI
  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center p-6 font-sans">
      {!pdf.pdfFile ? (
        <div className="mt-20 bg-zinc-900 p-16 rounded-3xl border border-zinc-800 text-center shadow-2xl max-w-lg w-full">
          <div className="bg-blue-600/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <FileText className="w-10 h-10 text-blue-500" />
          </div>
          <h1 className="text-4xl font-black mb-2 tracking-tighter uppercase">PDF Metadata Editor</h1>
          <label className="cursor-pointer group mt-10 block">
            <div className="bg-blue-600 group-hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-2xl transition-all flex items-center justify-center gap-3">
              <Upload className="w-5 h-5" /> Import PDF
            </div>
            <input type="file" className="hidden" accept=".pdf" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleSelectPdfFile(file);
            }} />
          </label>
        </div>
      ) : (
        <div className="w-full max-w-420 grid gap-6" style={{ gridTemplateColumns: `minmax(0, 1fr) ${RIGHT_RAIL_WIDTH}px` }}>
          <div className="min-w-0">
            <ArtifactsBar 
              hasPdfArtifact={!!pdf.pdfFile}
              hasJsonArtifact={!!artifacts.docData}
              hasEditedJson={artifacts.hasEditedJson}
              hasUpgradedArtifact={!!artifacts.upgradedJson}
              hasTextFinderArtifact={!!artifacts.textFinderArtifact}
              hasBlockFinderArtifact={!!artifacts.blockFinderArtifact}
              hasBlockExtractorArtifact={!!artifacts.blockExtractorArtifact}
            />

            <div className="grid gap-6" style={{ gridTemplateColumns: '360px minmax(0, 1fr)' }}>
              <div className="flex flex-col gap-4">
                <ActionSelector
                  selectedAction={selectedAction}
                  setSelectedAction={setSelectedAction}
                  isActionInProgress={workflow.actionInProgress !== null}
                  isLoading={loading}
                  isBatchRunning={workflow.isBatchRunning}
                  canRunAction={canRunAction(selectedAction)}
                  onRunAction={() => {
                    if (selectedAction === 'extract_json_from_pdf') handleExtract();
                    if (selectedAction === 'upgrade_json') handleUpgrade();
                    if (selectedAction === 'text_finder') handleTextFinder();
                    if (selectedAction === 'block_finder') handleBlockFinder();
                    if (selectedAction === 'block_extractor') handleBlockExtractor();
                    if (selectedAction === 'edit_json') workflow.setActionInProgress('edit_json');
                  }}
                  onAddActionToWorkflow={() => {
                    workflow.addToQueue({
                      actionId: selectedAction,
                      processor,
                      pdf2dataLayoutModel: layoutModel,
                      pdf2dataTableModel: tableModel,
                      upgradeMode,
                      blockExtractorUseExistingJson: beUseExistingJson,
                      selected: true,
                    } as any);
                    workflow.setActiveWorkflowView('queue');
                    workflow.setWorkflowMessage({ type: 'info', message: `${WORKFLOW_ACTION_LABELS[selectedAction]} added to queue.` });
                  }}
                  workflowMessage={workflow.workflowMessage}
                >
                  {selectedAction === 'extract_json_from_pdf' && (
                    <ExtractionAction 
                      processor={processor} setProcessor={setProcessor}
                      processorOptions={processorOptions} processorLoadWarning={null}
                      pdf2dataLayoutModel={layoutModel} setPdf2dataLayoutModel={setLayoutModel}
                      pdf2dataTableModel={tableModel} setPdf2dataTableModel={setTableModel}
                      isActionInProgress={loading}
                      onLoadDevJson={async () => {
                         const data = await api.loadDevTestJson();
                         artifacts.setDocData(data);
                         artifacts.workflowJsonRef.current = data;
                         artifacts.setJsonDraft(JSON.stringify(data, null, 2));
                         if (data.page_sizes) pdf.onDocumentLoadSuccess({ numPages: data.page_sizes.length });
                      }}
                      isLoading={loading} isBatchRunning={workflow.isBatchRunning}
                    />
                  )}
                  {selectedAction === 'upgrade_json' && (
                    <UpgradeAction 
                      upgradeMode={upgradeMode} setUpgradeMode={setUpgradeMode}
                      isActionInProgress={loading}
                    />
                  )}
                  {selectedAction === 'text_finder' && (
                    <TextFinderAction 
                      threshold={tfThreshold} setThreshold={setTfThreshold}
                      findParagraphs={tfFindParagraphs} setFindParagraphs={setTfFindParagraphs}
                      findSectionHeaders={tfFindSectionHeaders} setFindSectionHeaders={setTfFindSectionHeaders}
                      countDuplicates={tfCountDuplicates} setCountDuplicates={setTfCountDuplicates}
                      fileName={tfFileName} isActionInProgress={loading}
                      onFileChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setTfFile(file);
                        setTfFileName(file?.name || 'No file selected');
                      }}
                    />
                  )}
                  {selectedAction === 'block_finder' && (
                    <BlockFinderAction 
                      findTables={bfFindTables} setFindTables={setBfFindTables}
                      findFigures={bfFindFigures} setFindFigures={setBfFindFigures}
                      fileName={bfFileName} isActionInProgress={loading}
                      onFileChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setBfFile(file);
                        setBfFileName(file?.name || 'No file selected');
                      }}
                    />
                  )}
                  {selectedAction === 'block_extractor' && (
                    <BlockExtractorAction
                      processor={processor}
                      setProcessor={setProcessor}
                      processorOptions={processorOptions}
                      processorLoadWarning={null}
                      pdf2dataLayoutModel={layoutModel}
                      setPdf2dataLayoutModel={setLayoutModel}
                      pdf2dataTableModel={tableModel}
                      setPdf2dataTableModel={setTableModel}
                      useExistingJson={beUseExistingJson}
                      setUseExistingJson={setBeUseExistingJson}
                      hasJsonArtifact={!!(artifacts.docData || artifacts.parsedData)}
                      isActionInProgress={loading}
                    />
                  )}
                  {selectedAction === 'edit_json' && (
                    <EditJsonAction 
                      editSessionEnabled={workflow.actionInProgress === 'edit_json'}
                      selectedTarget={artifacts.selectedTarget}
                      selectedBlock={artifacts.selectedTarget ? artifacts.parsedData?.blocks[artifacts.selectedTarget.blockIndex] : null}
                      selectedContent={artifacts.selectedContent}
                      setSelectedContent={artifacts.setSelectedContent}
                      onSaveBlock={handleSaveEdit}
                      onFinishEditing={finalizeEditedJson}
                      isLoading={loading}
                      feedback={artifacts.editorFeedback}
                    />
                  )}
                </ActionSelector>
              </div>

              <PDFViewer 
                {...pdf}
                hasJsonArtifact={!!artifacts.docData}
                editSessionEnabled={workflow.actionInProgress === 'edit_json'}
                onPageJumpChange={pdf.setPageJumpValue}
                onPageJumpSubmit={() => pdf.navigateToPage(parseInt(pdf.pageJumpValue))}
                onPrevPage={() => pdf.navigateToPage(pdf.currentPage - 1)}
                onNextPage={() => pdf.navigateToPage(pdf.currentPage + 1)}
              >
                <BoundingBoxes 
                  blocks={artifacts.parsedData?.blocks || []}
                  currentPage={pdf.currentPage}
                  pageDimensions={pdf.pageSizes[pdf.currentPage] || { width: 0, height: 0, scale: 1 }}
                  editSessionEnabled={workflow.actionInProgress === 'edit_json'}
                  selectedTarget={artifacts.selectedTarget}
                  onSelectTarget={(target) => {
                    artifacts.setSelectedTarget(target);
                    const block = artifacts.parsedData?.blocks[target.blockIndex];
                    if (target.kind === 'block') artifacts.setSelectedContent(block?.content || '');
                    else if (target.kind === 'tableCell') artifacts.setSelectedContent(block?.block?.[target.row]?.[target.col] || '');
                    else if (target.kind === 'tableCaption') artifacts.setSelectedContent(block?.caption || '');
                  }}
                  buildFinderOverlayTitle={buildFinderOverlayTitle}
                />
              </PDFViewer>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <ExportPanel 
              width={RIGHT_RAIL_WIDTH}
              outputFolderHandle={artifacts.outputFolderHandle}
              outputFolderName={artifacts.outputFolderName}
              onChooseFolder={async () => {
                const handle = await (window as any).showDirectoryPicker();
                artifacts.setOutputFolderHandle(handle);
                artifacts.setOutputFolderName(handle.name);
              }}
              onExport={handleExport}
              exportFeedback={artifacts.exportFeedback}
              isExportDisabled={!artifacts.docData}
            />
            <WorkflowRail 
              activeView={workflow.activeWorkflowView}
              setActiveView={workflow.setActiveWorkflowView}
              batchStatus={workflow.batchStatus}
              batchStatusDetail={workflow.batchStatusDetail}
              workflowPath={workflow.workflowPath}
              plannedWorkflow={workflow.plannedWorkflow}
              actionInProgress={workflow.actionInProgress}
              isBatchRunning={workflow.isBatchRunning}
              isLoading={loading}
              onToggleSelected={workflow.toggleActionSelected}
              onRemove={workflow.removeFromQueue}
              onReorder={workflow.reorderQueue}
              onRunBatch={runBatchWorkflow}
              onClear={workflow.clearQueue}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;