// Shared PDF artifact helpers for URL building, bounding boxes, table overlays,
// and canonical JSON export formatting.

export const API_BASE = 'http://localhost:8000';

export type Box4 = [number, number, number, number];

export const buildAssetUrl = (docId: string, assetPath: string) => {
  const encodedDocId = encodeURIComponent(docId);
  const encodedPath = assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return `${API_BASE}/api/assets/${encodedDocId}/${encodedPath}`;
};

export const buildManifestUrl = (docId: string) => `${API_BASE}/api/assets-manifest/${encodeURIComponent(docId)}`;

export const stripNativeImagesPrefix = (assetPath: string) => {
  const parts = assetPath.split('/').filter(Boolean);
  const idx = parts.findIndex((part) => part.toLowerCase().endsWith('_images'));
  if (idx >= 0 && idx + 1 < parts.length) {
    return parts.slice(idx + 1).join('/');
  }
  return parts.length ? parts.slice(-1).join('/') : assetPath;
};

export const sanitizePathSegments = (pathValue: string) =>
  pathValue
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9._-]/g, '_'));

export const isTableWithGrid = (block: any) =>
  String(block?.type ?? '').toLowerCase() === 'table' && Array.isArray(block?.block);

export const toBox4 = (value: any): Box4 | null => {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const nums = value.map((n) => Number(n));
  if (nums.some((n) => Number.isNaN(n))) return null;
  return [nums[0], nums[1], nums[2], nums[3]];
};

export const getCellBoxesMatrix = (block: any, rowCount: number, colCount: number): Array<Array<Box4 | null>> => {
  const empty = Array.from({ length: rowCount }).map(() => Array.from({ length: colCount }).map(() => null as Box4 | null));
  const raw = block?.cell_boxes;
  if (!Array.isArray(raw)) return empty;

  // Preferred shape: cell_boxes[row][col] = [x1, y1, x2, y2]
  if (raw.some((entry) => Array.isArray(entry) && Array.isArray(entry[0]))) {
    for (let r = 0; r < rowCount; r += 1) {
      const row = Array.isArray(raw[r]) ? raw[r] : [];
      for (let c = 0; c < colCount; c += 1) {
        empty[r][c] = toBox4(row[c]);
      }
    }
    return empty;
  }

  // Legacy flat fallback: cell_boxes[idx] = [x1, y1, x2, y2]
  for (let r = 0; r < rowCount; r += 1) {
    for (let c = 0; c < colCount; c += 1) {
      const idx = r * colCount + c;
      empty[r][c] = toBox4(raw[idx]);
    }
  }
  return empty;
};

export const getCaptionBoxes = (block: any): Box4[] => {
  const singular = toBox4(block?.caption_box);
  if (singular) {
    return [singular];
  }

  const raw = block?.caption_boxes;
  if (!raw) return [];

  if (Array.isArray(raw) && raw.length === 4 && !Array.isArray(raw[0])) {
    const single = toBox4(raw);
    return single ? [single] : [];
  }

  if (Array.isArray(raw)) {
    return raw.map((entry) => toBox4(entry)).filter((b): b is Box4 => b !== null);
  }

  return [];
};

export const getTableDimensions = (tableRows: any[]) => {
  const rows = tableRows.length;
  const cols = tableRows.reduce((max, row) => {
    if (!Array.isArray(row)) return max;
    return Math.max(max, row.length);
  }, 0);
  return {
    rows,
    cols: Math.max(1, cols),
  };
};

export const toCanonicalContentJson = (raw: any) => {
  const metadata = raw && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const references = Array.isArray(raw?.references) ? raw.references : [];
  const blocksInput = Array.isArray(raw?.blocks) ? raw.blocks : [];

  const blocks = blocksInput
    .filter((block: any) => Array.isArray(block?.box) && block.box.length === 4)
    .map((block: any) => {
      const canonical: any = {
        type: String(block?.type ?? 'paragraph'),
        content: String(block?.content ?? ''),
        page: Number(block?.page ?? 1),
        box: block.box.map((n: any) => Number(n)),
      };

      for (const optionalKey of ['filepath', 'number', 'caption', 'footnotes', 'block', 'cell_boxes', 'caption_box', 'caption_boxes', 'column_headers', 'row_indexes']) {
        if (optionalKey in block) {
          canonical[optionalKey] = block[optionalKey];
        }
      }

      return canonical;
    });

  return {
    metadata,
    blocks,
    references,
  };
};
