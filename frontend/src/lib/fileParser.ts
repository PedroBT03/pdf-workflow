/**
 * File parsing utilities for keywords and configuration files
 */

export const parseTextFinderKeywordsFile = async (file: File): Promise<Record<string, number>> => {
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

export const parseBlockFinderKeywordsFile = async (file: File): Promise<string> => {
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
