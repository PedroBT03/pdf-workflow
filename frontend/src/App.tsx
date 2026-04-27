import React, { useEffect, useState } from 'react';
import { FileText, Upload, Loader2 } from 'lucide-react';

// API and Libs
import * as api from './api/actions';
import { toCanonicalContentJson } from './lib/pdfArtifacts';
import { WorkflowActionId, UpgradeMode, WORKFLOW_ACTION_LABELS } from './lib/workflow';

// Services and Utilities
import { parseTextFinderKeywordsFile, parseBlockFinderKeywordsFile } from './lib/fileParser';
import { canRunAction, buildFinderOverlayTitle } from './lib/uiHelpers';
import { handleExport, ExportContext } from './services/exportService';
import {
  handleExtract,
  handleUpgrade,
  handleTextFinder,
  handleBlockFinder,
  handleBlockExtractor,
  handleSaveEdit,
  finalizeEditedJson,
  handleAddDrawnBlock,
  WorkflowActionDependencies,
} from './services/workflowActions';
import { continueBatchWorkflow, runBatchWorkflow, BatchWorkflowDependencies } from './lib/batchWorkflow';

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
import { BlockDrawer } from './features/viewer/BlockDrawer';
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
  const [bfFindFigures, setBfFindFigures] = useState(true);
  const [bfFile, setBfFile] = useState<File | null>(null);
  const [bfFileName, setBfFileName] = useState('No file selected');

  const [beUseExistingJson, setBeUseExistingJson] = useState(false);

  const [drawBlockActive, setDrawBlockActive] = useState(false);
  const [pendingNewBlock, setPendingNewBlock] = useState<{ box: [number, number, number, number]; page: number } | null>(null);

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

  // Handle PDF file selection
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
    setPendingNewBlock(null);
    setBeUseExistingJson(false);
  };

  // Batch resume worker
  useEffect(() => {
    if (!pendingBatchResumeQueue) return;
    if (workflow.actionInProgress !== null) return;
    if (workflow.actionInProgress === 'edit_json') return;

    const queueToResume = pendingBatchResumeQueue;
    setPendingBatchResumeQueue(null);
    
    const batchDeps: BatchWorkflowDependencies = {
      workflow,
      artifacts,
      onSetProcessor: setProcessor,
      onSetLayoutModel: setLayoutModel,
      onSetTableModel: setTableModel,
      onSetUpgradeMode: setUpgradeMode,
      onSetBeUseExistingJson: setBeUseExistingJson,
      onSetSelectedAction: setSelectedAction,
      onHandleExtract: () => handleExtract(processor, layoutModel, tableModel, { workflow, artifacts, pdf, setLoading }),
      onHandleUpgrade: () => handleUpgrade(upgradeMode, { workflow, artifacts, pdf, setLoading }),
      onHandleTextFinder: () =>
        handleTextFinder(tfFile, tfThreshold, tfFindParagraphs, tfFindSectionHeaders, tfCountDuplicates, {
          workflow,
          artifacts,
          pdf,
          setLoading,
        }),
      onHandleBlockFinder: () =>
        handleBlockFinder(bfFile, bfFindTables, bfFindFigures, { workflow, artifacts, pdf, setLoading }),
      onHandleBlockExtractor: () =>
        handleBlockExtractor(processor, layoutModel, tableModel, beUseExistingJson, { workflow, artifacts, pdf, setLoading }),
    };

    void continueBatchWorkflow(queueToResume, batchDeps, () => {}, setPendingBatchResumeQueue);
  }, [pendingBatchResumeQueue, workflow.actionInProgress]);

  // Cleanup effect for workflow messages
  useEffect(() => {
    if (!workflow.workflowMessage) return;
    if (workflow.workflowMessage.type === 'error') return;

    const timeoutId = window.setTimeout(() => {
      workflow.setWorkflowMessage(null);
    }, 3600);

    return () => window.clearTimeout(timeoutId);
  }, [workflow.workflowMessage]);

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
                  canRunAction={canRunAction(selectedAction, pdf.pdfFile, artifacts.docData, artifacts.parsedData, tfFile, bfFile)}
                  onRunAction={() => {
                    const deps: WorkflowActionDependencies = {
                      workflow,
                      artifacts,
                      pdf,
                      setLoading,
                    };
                    if (selectedAction === 'extract_json_from_pdf')
                      handleExtract(processor, layoutModel, tableModel, deps);
                    if (selectedAction === 'upgrade_json') handleUpgrade(upgradeMode, deps);
                    if (selectedAction === 'text_finder')
                      handleTextFinder(tfFile, tfThreshold, tfFindParagraphs, tfFindSectionHeaders, tfCountDuplicates, deps);
                    if (selectedAction === 'block_finder')
                      handleBlockFinder(bfFile, bfFindTables, bfFindFigures, deps);
                    if (selectedAction === 'block_extractor')
                      handleBlockExtractor(processor, layoutModel, tableModel, beUseExistingJson, deps);
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
                      isPendingNewBlock={!!pendingNewBlock}
                      selectedTarget={artifacts.selectedTarget}
                      selectedBlock={artifacts.selectedTarget ? artifacts.parsedData?.blocks[artifacts.selectedTarget.blockIndex] : null}
                      selectedContent={artifacts.selectedContent}
                      setSelectedContent={artifacts.setSelectedContent}
                      onSaveBlock={async () => {
                        const deps: WorkflowActionDependencies = {
                          workflow,
                          artifacts,
                          pdf,
                          setLoading,
                        };
                        await handleSaveEdit(pendingNewBlock, artifacts.selectedContent, deps, setPendingNewBlock);
                      }}
                      onFinishEditing={async () => {
                        const deps: WorkflowActionDependencies = {
                          workflow,
                          artifacts,
                          pdf,
                          setLoading,
                        };
                        await finalizeEditedJson(deps, setPendingNewBlock, setPendingBatchResumeQueue);
                      }}
                      onDrawBlockToggle={(active) => {
                        if (active) {
                          setPendingNewBlock(null);
                          artifacts.setSelectedTarget(null);
                          artifacts.setSelectedContent('');
                        }
                        setDrawBlockActive(active);
                      }}
                      drawBlockActive={drawBlockActive}
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
                  pendingNewBlock={pendingNewBlock} 
                  onSelectTarget={(target) => {
                    setPendingNewBlock(null);
                    artifacts.setSelectedTarget(target);
                    const block = artifacts.parsedData?.blocks[target.blockIndex];
                    if (target.kind === 'block') artifacts.setSelectedContent(block?.content || '');
                    else if (target.kind === 'tableCell') artifacts.setSelectedContent(block?.block?.[target.row]?.[target.col] || '');
                    else if (target.kind === 'tableCaption') artifacts.setSelectedContent(block?.caption || '');
                  }}
                  buildFinderOverlayTitle={buildFinderOverlayTitle}
                />
                <BlockDrawer 
                  isActive={drawBlockActive && workflow.actionInProgress === 'edit_json'}
                  currentPage={pdf.currentPage}
                  pageDimensions={pdf.pageSizes[pdf.currentPage] || { width: 0, height: 0, scale: 1 }}
                  onBlockCreated={(box, page) => {
                    const deps: WorkflowActionDependencies = {
                      workflow,
                      artifacts,
                      pdf,
                      setLoading,
                    };
                    handleAddDrawnBlock(box, page, deps, setPendingNewBlock, setDrawBlockActive);
                  }}
                  onCancel={() => setDrawBlockActive(false)}
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
              onExport={async () => {
                try {
                  const exportContext: ExportContext = {
                    parsedData: artifacts.parsedData,
                    docData: artifacts.docData,
                    editedJson: artifacts.editedJson,
                    upgradedJson: artifacts.upgradedJson,
                    textFinderArtifact: artifacts.textFinderArtifact,
                    blockFinderArtifact: artifacts.blockFinderArtifact,
                    blockExtractorArtifact: artifacts.blockExtractorArtifact,
                    textFinderFoundArtifact: artifacts.textFinderFoundArtifact,
                    blockFinderFoundArtifact: artifacts.blockFinderFoundArtifact,
                    sourceFilename: pdf.sourceFilename,
                    outputFolderHandle: artifacts.outputFolderHandle,
                    tfThreshold,
                    tfFindParagraphs,
                    tfFindSectionHeaders,
                    tfCountDuplicates,
                    bfFindTables,
                    bfFindFigures,
                  };
                  const message = await handleExport(exportContext);
                  artifacts.setExportFeedback({ type: 'success', message });
                } catch (err: any) {
                  artifacts.setExportFeedback({ type: 'error', message: err.message });
                }
              }}
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
              onRunBatch={async () => {
                const batchDeps: BatchWorkflowDependencies = {
                  workflow,
                  artifacts,
                  onSetProcessor: setProcessor,
                  onSetLayoutModel: setLayoutModel,
                  onSetTableModel: setTableModel,
                  onSetUpgradeMode: setUpgradeMode,
                  onSetBeUseExistingJson: setBeUseExistingJson,
                  onSetSelectedAction: setSelectedAction,
                  onHandleExtract: () => handleExtract(processor, layoutModel, tableModel, { workflow, artifacts, pdf, setLoading }),
                  onHandleUpgrade: () => handleUpgrade(upgradeMode, { workflow, artifacts, pdf, setLoading }),
                  onHandleTextFinder: () =>
                    handleTextFinder(tfFile, tfThreshold, tfFindParagraphs, tfFindSectionHeaders, tfCountDuplicates, {
                      workflow,
                      artifacts,
                      pdf,
                      setLoading,
                    }),
                  onHandleBlockFinder: () =>
                    handleBlockFinder(bfFile, bfFindTables, bfFindFigures, { workflow, artifacts, pdf, setLoading }),
                  onHandleBlockExtractor: () =>
                    handleBlockExtractor(processor, layoutModel, tableModel, beUseExistingJson, { workflow, artifacts, pdf, setLoading }),
                };
                await runBatchWorkflow(workflow.plannedWorkflow, batchDeps, () => {}, setPendingBatchResumeQueue);
              }}
              onClear={workflow.clearQueue}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default App;