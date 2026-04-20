"""Helpers for PDF workflow content JSON files and per-document asset cache handling."""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

ASSET_CACHE_ROOT = Path(tempfile.gettempdir()) / "pdfwf_assets"
ASSET_CACHE_ROOT.mkdir(parents=True, exist_ok=True)


def safe_int(value: Any, default: int = 1) -> int:
    # Convert a value to int, returning a fallback on conversion errors.
    try:
        return int(value)
    except Exception:
        return default


def safe_float(value: Any, default: float = 11.0) -> float:
    # Convert a value to float, returning a fallback on conversion errors.
    try:
        return float(value)
    except Exception:
        return default


def normalize_layout_label(raw_label: str) -> str:
    # Map pipeline-specific layout labels to canonical schema labels.
    label = raw_label.strip().lower()
    if label in {"text", "paragraph"}:
        return "paragraph"
    if label in {"title", "header", "heading", "section_header"}:
        return "section_header"
    if label == "figure":
        return "Figure"
    if label == "table":
        return "Table"
    if label == "equation":
        return "Equation"
    return raw_label.strip() or "paragraph"


def format_as_content_json(data: dict) -> dict:
    # Normalize arbitrary extraction payloads into the canonical content JSON shape.
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    references = data.get("references") if isinstance(data.get("references"), list) else []
    raw_blocks = data.get("blocks") if isinstance(data.get("blocks"), list) else []

    formatted_blocks: list[dict] = []
    for raw in raw_blocks:
        if not isinstance(raw, dict):
            continue

        box = raw.get("box")
        if not isinstance(box, list) or len(box) != 4:
            continue

        block: dict[str, Any] = {
            "type": str(raw.get("type") or "paragraph"),
            "content": str(raw.get("content") or ""),
            "page": safe_int(raw.get("page", 1), 1),
            "box": [float(c) for c in box],
        }

        if "caption" in raw:
            block["caption"] = str(raw.get("caption") or "")

        for optional_key in [
            "filepath",
            "number",
            "footnotes",
            "block",
            "cell_boxes",
            "caption_box",
            "caption_boxes",
            "column_headers",
            "row_indexes",
        ]:
            if optional_key in raw:
                block[optional_key] = raw.get(optional_key)

        formatted_blocks.append(block)

    return {
        "metadata": metadata,
        "blocks": formatted_blocks,
        "references": references,
    }


def persist_extracted_assets(file_id: str, output_tmp: str, asset_root: Path | None = None) -> int:
    # Copy extracted image assets into a document-scoped cache folder.
    output_root = Path(output_tmp)
    root = asset_root or ASSET_CACHE_ROOT
    cache_folder = root / file_id
    if cache_folder.exists():
        shutil.rmtree(cache_folder)
    cache_folder.mkdir(parents=True, exist_ok=True)

    copied = 0
    image_suffixes = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}

    for src in output_root.rglob("*"):
        if not src.is_file() or src.suffix.lower() not in image_suffixes:
            continue

        rel = src.relative_to(output_root)
        dest = cache_folder / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        copied += 1

    return copied


def list_cached_assets(doc_id: str, asset_root: Path | None = None) -> list[str]:
    # Return sorted relative paths of cached image assets for a document.
    root = asset_root or ASSET_CACHE_ROOT
    doc_folder = (root / doc_id).resolve()
    if not doc_folder.exists() or not doc_folder.is_dir():
        return []

    image_suffixes = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
    assets: list[str] = []
    for item in doc_folder.rglob("*"):
        if not item.is_file() or item.suffix.lower() not in image_suffixes:
            continue
        assets.append(item.relative_to(doc_folder).as_posix())

    return sorted(assets)


def find_first_content_json(output_tmp: str) -> Path:
    # Find the first generated *_content.json file in a pipeline output folder.
    content_files = sorted(Path(output_tmp).rglob("*_content.json"))
    if not content_files:
        raise RuntimeError("Pipeline finished without generating *_content.json output.")
    return content_files[0]


def read_native_content_envelope(output_tmp: str) -> dict[str, Any]:
    # Read metadata and references from native content JSON, with safe fallbacks.
    try:
        content_path = find_first_content_json(output_tmp)
    except Exception:
        return {"metadata": {}, "references": []}

    try:
        with open(content_path, "r", encoding="utf-8") as f:
            parsed = json.load(f)
    except Exception:
        return {"metadata": {}, "references": []}

    if not isinstance(parsed, dict):
        return {"metadata": {}, "references": []}

    metadata = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
    references = parsed.get("references") if isinstance(parsed.get("references"), list) else []
    return {
        "metadata": metadata,
        "references": references,
    }
