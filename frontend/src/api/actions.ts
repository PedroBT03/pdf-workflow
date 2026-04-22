import { API_BASE } from '../lib/pdfArtifacts';
import { UpgradeMode } from '../lib/workflow';

/**
 * Utility function for handling API responses.
 */
async function handleResponse(response: Response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.detail;
    const message = Array.isArray(detail)
      ? detail.map((item) => (typeof item === 'string' ? item : item?.msg || JSON.stringify(item))).join('; ')
      : typeof detail === 'string'
        ? detail
        : detail
          ? JSON.stringify(detail)
          : `Erro na API (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

/**
 * Fetch the available processors from the backend.
 */
export async function fetchProcessors() {
  const response = await fetch(`${API_BASE}/api/processors`);
  return handleResponse(response);
}

/**
 * Upload the initial PDF for JSON extraction.
 */
export async function uploadPdf(
  file: Blob, 
  filename: string, 
  processor: string, 
  pdf2dataLayoutModel?: string, 
  pdf2dataTableModel?: string
) {
  const formData = new FormData();
  formData.append('file', file, filename);
  formData.append('processor', processor);
  
  if (processor === 'pdf2data') {
    if (pdf2dataLayoutModel) formData.append('pdf2data_layout_model', pdf2dataLayoutModel);
    if (pdf2dataTableModel) formData.append('pdf2data_table_model', pdf2dataTableModel);
  }

  const response = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse(response);
}

/**
 * Action: Edit JSON - Modify the content of a specific block.
 */
export async function editJsonBlock(data: any, target: any, value: string) {
  const normalizedTarget = {
    kind: target.kind,
    block_index: target.blockIndex,
    ...(target.kind === 'tableCell' ? { row: target.row, col: target.col } : {}),
    ...(target.kind === 'tableCaption' ? { caption_index: target.captionIndex } : {}),
  };

  const response = await fetch(`${API_BASE}/api/actions/edit-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, target: normalizedTarget, value }),
  });
  return handleResponse(response);
}

/**
 * Action: Upgrade JSON - Fix unicode or merge figures.
 */
export async function upgradeJson(data: any, mode: UpgradeMode) {
  const response = await fetch(`${API_BASE}/api/actions/upgrade-json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, mode }),
  });
  return handleResponse(response);
}

/**
 * Action: Text Finder - Search for keywords in paragraphs/headers.
 */
export async function runTextFinder(params: {
  data: any;
  keywords: Record<string, number>;
  wordCountThreshold: number;
  findParagraphs: boolean;
  findSectionHeaders: boolean;
  countDuplicates: boolean;
}) {
  const response = await fetch(`${API_BASE}/api/actions/text-finder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: params.data,
      keywords: params.keywords,
      word_count_threshold: params.wordCountThreshold,
      find_paragraphs: params.findParagraphs,
      find_section_headers: params.findSectionHeaders,
      count_duplicates: params.countDuplicates,
    }),
  });
  return handleResponse(response);
}

/**
 * Action: Block Finder - Search for tables or figures using keywords.
 */
export async function runBlockFinder(params: {
  data: any;
  keywords: string;
  findTables: boolean;
  findFigures: boolean;
}) {
  const response = await fetch(`${API_BASE}/api/actions/block-finder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: params.data,
      keywords: params.keywords,
      find_tables: params.findTables,
      find_figures: params.findFigures,
    }),
  });
  return handleResponse(response);
}

/**
 * Fetch the asset manifest (images) for a document.
 */
export async function fetchAssetManifest(docId: string) {
  const response = await fetch(`${API_BASE}/api/assets-manifest/${encodeURIComponent(docId)}`);
  return handleResponse(response);
}

/**
 * DEV: Load the static test_content.json file from the backend root.
 */
export async function loadDevTestJson() {
  const response = await fetch(`${API_BASE}/api/dev/load-test-json`);
  return handleResponse(response);
}