/**
 * Workflow action handlers for all PDF processing operations
 */

import * as api from '../api/actions';
import { parseTextFinderKeywordsFile, parseBlockFinderKeywordsFile } from '../lib/fileParser';

export interface WorkflowActionDependencies {
  workflow: any;
  artifacts: any;
  pdf: any;
  setLoading: (l: boolean) => void;
}

export const handleExtract = async (
  processor: string,
  layoutModel: string,
  tableModel: string,
  deps: WorkflowActionDependencies
): Promise<boolean> => {
  if (!deps.pdf.pdfFile) return false;
  deps.workflow.setActionInProgress('extract_json_from_pdf');
  deps.setLoading(true);
  try {
    const data = await api.uploadPdf(
      deps.pdf.pdfFile,
      deps.pdf.sourceFilename,
      processor,
      layoutModel,
      tableModel
    );
    deps.artifacts.setDocData(data);
    deps.artifacts.extractedJsonRef.current = data;
    deps.artifacts.workflowJsonRef.current = data;
    deps.artifacts.setJsonDraft(JSON.stringify(data, null, 2));
    deps.artifacts.setActivePdfArtifact('docData');
    deps.artifacts.setSelectedTarget(null);
    deps.artifacts.setSelectedContent('');

    deps.workflow.appendWorkflowPath('extract_json_from_pdf', 'done', `Blocks: ${data.blocks?.length}`);
    deps.pdf.onDocumentLoadSuccess({ numPages: data.page_sizes?.length || 0 });
    return true;
  } catch (err: any) {
    deps.workflow.setWorkflowMessage({ type: 'error', message: err.message });
    deps.workflow.appendWorkflowPath('extract_json_from_pdf', 'failed', err.message);
    return false;
  } finally {
    deps.setLoading(false);
    deps.workflow.setActionInProgress(null);
  }
};

export const handleUpgrade = async (
  upgradeMode: any,
  deps: WorkflowActionDependencies,
  sourceJson?: any
): Promise<boolean> => {
  const currentJson = sourceJson ?? deps.artifacts.getExtractedJsonArtifact();
  if (!currentJson) {
    deps.workflow.setWorkflowMessage({ type: 'error', message: 'No extracted JSON available. Run Extract JSON from PDF first.' });
    return false;
  }
  deps.workflow.setActionInProgress('upgrade_json');
  deps.setLoading(true);
  try {
    const res = await api.upgradeJson(currentJson, upgradeMode);
    deps.artifacts.setUpgradedJson(res.data);
    deps.artifacts.workflowJsonRef.current = res.data;
    deps.artifacts.setJsonDraft(JSON.stringify(res.data, null, 2));
    deps.artifacts.setActivePdfArtifact('upgradedJson');
    deps.workflow.appendWorkflowPath('upgrade_json', 'done', `Mode: ${upgradeMode}`);
    return true;
  } catch (err: any) {
    deps.workflow.appendWorkflowPath('upgrade_json', 'failed', err.message);
    return false;
  } finally {
    deps.setLoading(false);
    deps.workflow.setActionInProgress(null);
  }
};

export const handleTextFinder = async (
  tfFile: File | null,
  tfThreshold: number,
  tfFindParagraphs: boolean,
  tfFindSectionHeaders: boolean,
  tfCountDuplicates: boolean,
  deps: WorkflowActionDependencies,
  sourceJson?: any
): Promise<boolean> => {
  const currentJson = sourceJson ?? deps.artifacts.getExtractedJsonArtifact();
  if (!currentJson || !tfFile) {
    if (!currentJson) {
      deps.workflow.setWorkflowMessage({ type: 'error', message: 'No extracted JSON available. Run Extract JSON from PDF first.' });
    }
    return false;
  }
  deps.workflow.setActionInProgress('text_finder');
  deps.setLoading(true);
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
    deps.artifacts.setTextFinderFoundArtifact(
      res.found_texts_artifact || {
        matches: [],
        total_matches: 0,
        unique_matches: 0,
        settings: {},
      }
    );
    deps.artifacts.setTextFinderArtifact(highlightedArtifact);
    deps.artifacts.workflowJsonRef.current = highlightedArtifact;
    deps.artifacts.setJsonDraft(JSON.stringify(highlightedArtifact, null, 2));
    deps.artifacts.setActivePdfArtifact('textFinderArtifact');

    deps.workflow.appendWorkflowPath(
      'text_finder',
      'done',
      `Highlighted ${res.summary?.highlighted_count} blocks`
    );
    return true;
  } catch (err: any) {
    deps.workflow.appendWorkflowPath('text_finder', 'failed', err.message);
    return false;
  } finally {
    deps.setLoading(false);
    deps.workflow.setActionInProgress(null);
  }
};

export const handleBlockFinder = async (
  bfFile: File | null,
  bfFindTables: boolean,
  bfFindFigures: boolean,
  deps: WorkflowActionDependencies,
  sourceJson?: any
): Promise<boolean> => {
  const currentJson = sourceJson ?? deps.artifacts.getExtractedJsonArtifact();
  if (!currentJson || !bfFile) {
    if (!currentJson) {
      deps.workflow.setWorkflowMessage({ type: 'error', message: 'No extracted JSON available. Run Extract JSON from PDF first.' });
    }
    return false;
  }
  deps.workflow.setActionInProgress('block_finder');
  deps.setLoading(true);
  try {
    const keywords = await parseBlockFinderKeywordsFile(bfFile);
    const res = await api.runBlockFinder({
      data: currentJson,
      keywords,
      findTables: bfFindTables,
      findFigures: bfFindFigures,
    });

    const highlightedArtifact = res.data;
    deps.artifacts.setBlockFinderFoundArtifact(
      res.found_blocks_artifact || {
        blocks: [],
        total_matches: 0,
        unique_matches: 0,
        settings: {},
      }
    );
    deps.artifacts.setBlockFinderArtifact(highlightedArtifact);
    deps.artifacts.workflowJsonRef.current = highlightedArtifact;
    deps.artifacts.setJsonDraft(JSON.stringify(highlightedArtifact, null, 2));
    deps.artifacts.setActivePdfArtifact('blockFinderArtifact');

    deps.workflow.appendWorkflowPath(
      'block_finder',
      'done',
      `Highlighted ${res.summary?.highlighted_count} blocks`
    );
    return true;
  } catch (err: any) {
    deps.workflow.appendWorkflowPath('block_finder', 'failed', err.message);
    return false;
  } finally {
    deps.setLoading(false);
    deps.workflow.setActionInProgress(null);
  }
};

export const handleBlockExtractor = async (
  processor: string,
  layoutModel: string,
  tableModel: string,
  beUseExistingJson: boolean,
  deps: WorkflowActionDependencies,
  sourceJson?: any
): Promise<boolean> => {
  const currentJson = sourceJson ?? deps.artifacts.getExtractedJsonArtifact();
  const hasPdf = !!deps.pdf.pdfFile;
  const useFastPath = beUseExistingJson && !!currentJson;

  if (!hasPdf && !useFastPath) return false;
  deps.workflow.setActionInProgress('block_extractor');
  deps.setLoading(true);
  try {
    const res = await api.runBlockExtractor({
      file: hasPdf ? deps.pdf.pdfFile : null,
      filename: deps.pdf.sourceFilename,
      processor,
      pdf2dataLayoutModel: layoutModel,
      pdf2dataTableModel: tableModel,
      useExistingJson: useFastPath,
      existingJson: useFastPath ? currentJson : undefined,
    });

    const extractedArtifact = res?.data ?? res;
    if (!extractedArtifact || typeof extractedArtifact !== 'object') {
      throw new Error('Block extractor returned an invalid payload.');
    }
    deps.artifacts.setBlockExtractorArtifact(extractedArtifact);
    deps.artifacts.workflowJsonRef.current = extractedArtifact;
    deps.artifacts.setJsonDraft(JSON.stringify(extractedArtifact, null, 2));
    deps.artifacts.setActivePdfArtifact('blockExtractorArtifact');

    deps.workflow.appendWorkflowPath(
      'block_extractor',
      'done',
      `Extracted ${res.summary?.tables_after ?? extractedArtifact?.blocks?.length ?? 0} tables`
    );
    return true;
  } catch (err: any) {
    deps.workflow.appendWorkflowPath('block_extractor', 'failed', err.message);
    return false;
  } finally {
    deps.setLoading(false);
    deps.workflow.setActionInProgress(null);
  }
};

export const handleSaveEdit = async (
  pendingNewBlock: { box: [number, number, number, number]; page: number } | null,
  selectedContent: string,
  deps: WorkflowActionDependencies,
  onPendingNewBlockUpdate: (block: any) => void
): Promise<void> => {
  const currentJson = deps.artifacts.getWorkflowJsonArtifact();
  if (!currentJson) return;

  if (pendingNewBlock) {
    if (!selectedContent.trim()) {
      deps.artifacts.setEditorFeedback({
        type: 'error',
        message: 'Write content before adding the new block.',
      });
      return;
    }

    deps.setLoading(true);
    try {
      const existingBlocks = Array.isArray(currentJson?.blocks) ? currentJson.blocks : [];
      const usesZeroBasedPages = existingBlocks.some((block: any) => Number(block?.page) === 0);

      const newBlock = {
        type: 'paragraph',
        content: selectedContent,
        page: usesZeroBasedPages ? pendingNewBlock.page - 1 : pendingNewBlock.page,
        box: pendingNewBlock.box,
      };

      const nextJson = JSON.parse(JSON.stringify(currentJson));
      if (!Array.isArray(nextJson.blocks)) nextJson.blocks = [];

      // Find the correct position to insert the new block based on page and Y coordinate
      const newBlockPage = newBlock.page;
      const newBlockTop = newBlock.box[1]; // Y coordinate (top)

      let insertIndex = nextJson.blocks.length;
      for (let i = 0; i < nextJson.blocks.length; i++) {
        const block = nextJson.blocks[i];
        // If block is on the same page and has a higher top coordinate, insert before it
        if (
          Number(block.page) === Number(newBlockPage) &&
          block.box &&
          block.box[1] > newBlockTop
        ) {
          insertIndex = i;
          break;
        }
      }

      nextJson.blocks.splice(insertIndex, 0, newBlock);
      const newBlockIndex = insertIndex;

      deps.artifacts.workflowJsonRef.current = nextJson;
      deps.artifacts.setJsonDraft(JSON.stringify(nextJson, null, 2));
      deps.artifacts.setEditedJson(nextJson);
      deps.artifacts.setHasEditedJson(true);
      deps.artifacts.setActivePdfArtifact('editedJson');

      if (deps.artifacts.textFinderArtifact) {
        deps.artifacts.setTextFinderArtifact(nextJson);
      } else if (deps.artifacts.blockFinderArtifact) {
        deps.artifacts.setBlockFinderArtifact(nextJson);
      } else if (deps.artifacts.blockExtractorArtifact) {
        deps.artifacts.setBlockExtractorArtifact(nextJson);
      } else if (deps.artifacts.upgradedJson) {
        deps.artifacts.setUpgradedJson(nextJson);
      }

      deps.artifacts.setSelectedTarget({ kind: 'block', blockIndex: newBlockIndex });
      onPendingNewBlockUpdate(null);
      deps.artifacts.setEditorFeedback({ type: 'success', message: 'New block added.' });
    } catch (err: any) {
      deps.artifacts.setEditorFeedback({ type: 'error', message: 'Failed to add new block.' });
    } finally {
      deps.setLoading(false);
    }
    return;
  }

  if (!deps.artifacts.selectedTarget || !deps.artifacts.parsedData) return;
  deps.setLoading(true);
  try {
    const res = await api.editJsonBlock(
      deps.artifacts.parsedData,
      deps.artifacts.selectedTarget,
      selectedContent
    );
    const nextJson = res.canonical || res.data;
    deps.artifacts.setJsonDraft(JSON.stringify(nextJson, null, 2));
    deps.artifacts.workflowJsonRef.current = nextJson;
    deps.artifacts.setEditorFeedback({ type: 'success', message: 'Block saved.' });
  } catch (err: any) {
    deps.artifacts.setEditorFeedback({ type: 'error', message: err.message });
  } finally {
    deps.setLoading(false);
  }
};

export const finalizeEditedJson = async (
  deps: WorkflowActionDependencies,
  onPendingNewBlockUpdate: (block: any) => void,
  onPendingBatchQueueUpdate: (queue: any[] | null) => void
): Promise<void> => {
  if (!deps.artifacts.parsedData) return;
  try {
    const committed = JSON.parse(JSON.stringify(deps.artifacts.parsedData));
    deps.artifacts.setEditedJson(committed);
    deps.artifacts.workflowJsonRef.current = committed;
    deps.artifacts.setHasEditedJson(true);
    deps.artifacts.setSelectedTarget(null);
    deps.artifacts.setSelectedContent('');
    onPendingNewBlockUpdate(null);
    deps.workflow.setActionInProgress(null);
    deps.workflow.appendWorkflowPath('edit_json', 'done', 'Edits finalized');

    if (deps.workflow.isBatchRunning && deps.workflow.workflowQueue.length > 0) {
      const nextQueue = [...deps.workflow.workflowQueue];
      deps.workflow.setBatchStatus('running');
      onPendingBatchQueueUpdate(nextQueue);
    } else if (deps.workflow.isBatchRunning) {
      deps.workflow.setIsBatchRunning(false);
      deps.workflow.setBatchStatus('completed');
    }
  } catch (err: any) {
    deps.workflow.setWorkflowMessage({
      type: 'error',
      message: 'Failed to finalize edits.',
    });
  }
};

export const handleAddDrawnBlock = (
  box: [number, number, number, number],
  page: number,
  deps: WorkflowActionDependencies,
  onPendingNewBlockUpdate: (block: any) => void,
  onDrawBlockActiveUpdate: (active: boolean) => void
): void => {
  onPendingNewBlockUpdate({ box, page });
  deps.artifacts.setSelectedTarget(null);
  deps.artifacts.setSelectedContent('');
  deps.artifacts.setEditorFeedback({
    type: 'info',
    message: 'Box ready. Write content and click "Add new block".',
  });
  onDrawBlockActiveUpdate(false);
};
