/**
 * Export service for building snapshots and writing files
 */

import { toCanonicalContentJson, buildAssetUrl, stripNativeImagesPrefix, sanitizePathSegments } from '../lib/pdfArtifacts';
import * as api from '../api/actions';

export const cloneJson = (value: any): any => JSON.parse(JSON.stringify(value));

export const rewriteAssetPaths = (
  snapshot: any,
  exportedAssetPaths: Map<string, string>
): void => {
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

export const buildFinderExportSnapshot = (
  snapshot: any,
  foundArtifact: any,
  mode: 'text' | 'block',
  fallbackSettings: Record<string, any>
): any => {
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

export interface ExportContext {
  parsedData: any;
  docData: any;
  editedJson: any;
  upgradedJson: any;
  textFinderArtifact: any;
  blockFinderArtifact: any;
  blockExtractorArtifact: any;
  textFinderFoundArtifact: any;
  blockFinderFoundArtifact: any;
  sourceFilename: string;
  outputFolderHandle: any;
  tfThreshold: number;
  tfFindParagraphs: boolean;
  tfFindSectionHeaders: boolean;
  tfCountDuplicates: boolean;
  bfFindTables: boolean;
  bfFindFigures: boolean;
}

export const handleExport = async (context: ExportContext): Promise<string> => {
  if (!context.parsedData || !context.outputFolderHandle) {
    throw new Error('Missing parsed data or output folder');
  }

  const baseName = context.sourceFilename.replace(/\.[^/.]+$/, '') || 'metadata';
  const safeName = baseName.split('').map((ch) => (/^[a-zA-Z0-9_-]$/.test(ch) ? ch : '_')).join('');
  const folderName = safeName || 'metadata';

  const docFolder = await context.outputFolderHandle.getDirectoryHandle(folderName, { create: true });
  const imagesFolder = await docFolder.getDirectoryHandle(`${folderName}_images`, { create: true });

  const docId = String(context.docData?.id || '').trim();
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
    } catch {
      /* skip failed image */
    }
  }

  const snapshots: Array<{ name: string; data: any }> = [];

  const baseSnapshot = cloneJson(context.docData ?? context.parsedData);
  rewriteAssetPaths(baseSnapshot, exportedAssetPaths);
  snapshots.push({ name: `${folderName}_content.json`, data: toCanonicalContentJson(baseSnapshot) });

  if (context.editedJson) {
    const editedSnapshot = cloneJson(context.editedJson);
    rewriteAssetPaths(editedSnapshot, exportedAssetPaths);
    snapshots.push({
      name: `${folderName}_edited_content.json`,
      data: toCanonicalContentJson(editedSnapshot),
    });
  }

  if (context.upgradedJson) {
    const upgradedSnapshot = cloneJson(context.upgradedJson);
    rewriteAssetPaths(upgradedSnapshot, exportedAssetPaths);
    snapshots.push({
      name: `${folderName}_upgraded_content.json`,
      data: toCanonicalContentJson(upgradedSnapshot),
    });
  }

  if (context.textFinderArtifact) {
    const textSnapshot = cloneJson(context.textFinderArtifact);
    rewriteAssetPaths(textSnapshot, exportedAssetPaths);
    snapshots.push({
      name: `${folderName}_text_finder_content.json`,
      data: buildFinderExportSnapshot(textSnapshot, context.textFinderFoundArtifact, 'text', {
        word_count_threshold: context.tfThreshold,
        find_paragraphs: context.tfFindParagraphs,
        find_section_headers: context.tfFindSectionHeaders,
        count_duplicates: context.tfCountDuplicates,
      }),
    });
  }

  if (context.blockFinderArtifact) {
    const blockSnapshot = cloneJson(context.blockFinderArtifact);
    rewriteAssetPaths(blockSnapshot, exportedAssetPaths);
    snapshots.push({
      name: `${folderName}_block_finder_content.json`,
      data: buildFinderExportSnapshot(blockSnapshot, context.blockFinderFoundArtifact, 'block', {
        find_tables: context.bfFindTables,
        find_figures: context.bfFindFigures,
      }),
    });
  }

  if (context.blockExtractorArtifact) {
    const blockExtractorSnapshot = cloneJson(context.blockExtractorArtifact);
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

  return `Export completed successfully (${snapshots.length} JSON file(s)).`;
};
