/**
 * UI helper functions for App state and display logic
 */

import { WorkflowActionId } from './workflow';

export const canRunAction = (
  action: WorkflowActionId,
  pdfFile: Blob | null,
  docData: any,
  parsedData: any,
  tfFile: File | null,
  bfFile: File | null
): boolean => {
  if (action === 'extract_json_from_pdf') return !!pdfFile;
  if (action === 'edit_json') return docData || parsedData;
  if (action === 'upgrade_json') return docData || parsedData;
  if (action === 'text_finder') return (docData || parsedData) && !!tfFile;
  if (action === 'block_finder') return (docData || parsedData) && !!bfFile;
  if (action === 'block_extractor') return !!pdfFile || !!(docData || parsedData);
  return false;
};

export const buildFinderOverlayTitle = (block: any): string => {
  let title = '';
  if (block?.text_finder_highlighted) {
    title += `Text match (${block.text_finder_match_score || 0})`;
  }
  if (block?.block_finder_highlighted) {
    title += `${title ? ' | ' : ''}Block match (${block.block_finder_match_score || 0})`;
  }
  return title;
};
