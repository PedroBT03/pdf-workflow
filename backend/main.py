import uuid
import shutil
import traceback
import tempfile
import json
import importlib.util
import os
import sys
import subprocess
import re
from collections import Counter
from pathlib import Path
from typing import Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import fitz
from pdf2data.edit import JsonBoxEditor

from core.content_json import (
    ASSET_CACHE_ROOT,
    find_first_content_json,
    format_as_content_json,
    list_cached_assets,
    normalize_layout_label,
    persist_extracted_assets,
    read_native_content_envelope,
    safe_float,
    safe_int,
)

# Backward-compatible aliases kept for existing tests and call sites.
_normalize_layout_label = normalize_layout_label
_format_as_content_json = format_as_content_json
_persist_extracted_assets = persist_extracted_assets
_list_cached_assets = list_cached_assets
_find_first_content_json = find_first_content_json
_read_native_content_envelope = read_native_content_envelope
_safe_int = safe_int
_safe_float = safe_float


# Persist extracted image assets into the shared asset cache.
def _persist_extracted_assets(file_id: str, output_tmp: str) -> int:
    return persist_extracted_assets(file_id=file_id, output_tmp=output_tmp, asset_root=ASSET_CACHE_ROOT)


# List cached asset paths for a specific extracted document.
def _list_cached_assets(doc_id: str) -> list[str]:
    return list_cached_assets(doc_id=doc_id, asset_root=ASSET_CACHE_ROOT)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class UpgradePayload(BaseModel):
    data: dict
    mode: str = "both"
    distance_threshold: float = 50.0


class TextFinderPayload(BaseModel):
    data: dict
    keywords: dict[str, Any]
    word_count_threshold: float = 6.0
    find_paragraphs: bool = True
    find_section_headers: bool = True
    count_duplicates: bool = False


class BlockFinderPayload(BaseModel):
    data: dict
    keywords: str
    find_tables: bool = True
    find_figures: bool = False


class EditTarget(BaseModel):
    kind: str  # "block", "tableCell", "tableCaption"
    block_index: int
    row: int | None = None
    col: int | None = None
    caption_index: int | None = None


class EditJsonPayload(BaseModel):
    data: dict
    target: EditTarget
    value: str


PROCESSOR_CATALOG: list[dict[str, Any]] = [
    {
        "alias": "pdf2data",
        "label": "PDF2Data",
        "pipeline": "NotDefined",
        "enabled": True,
        "reason": None,
    },
    {
        "alias": "mineru",
        "label": "MinerU",
        "pipeline": "MinerU",
        "enabled": True,
        "reason": None,
    },
    {
        "alias": "docling",
        "label": "Docling",
        "pipeline": "Docling",
        "enabled": True,
        "reason": None,
    },
    {
        "alias": "paddleppstructure",
        "label": "Paddle PPStructure",
        "pipeline": "PaddlePPStructure",
        "enabled": False,
        "reason": "Temporarily disabled in this build.",
    },
    {
        "alias": "paddlevl",
        "label": "Paddle VL",
        "pipeline": "PaddleVL",
        "enabled": False,
        "reason": "Temporarily disabled in this build.",
    },
    {
        "alias": "mineruvl",
        "label": "MinerU VL",
        "pipeline": "MinerUVL",
        "enabled": False,
        "reason": "Temporarily disabled in this build.",
    },
]

FRIENDLY_PROCESSOR_ALIASES: dict[str, str] = {
    item["alias"]: str(item["pipeline"]) for item in PROCESSOR_CATALOG
}

PDF2DATA_LAYOUT_AUTO = "auto"
PDF2DATA_LAYOUT_MODELS = {
    "PP-DocLayout-L",
    "DocLayout-YOLO-DocStructBench",
}


# Fail early when optional pipeline modules are missing in the runtime.
def _require_modules(module_names: list[str], pipeline_name: str) -> None:
    missing = [name for name in module_names if importlib.util.find_spec(name) is None]
    if missing:
        raise RuntimeError(
            f"Missing dependency for {pipeline_name}: {', '.join(missing)}. Install requirements-ml.txt."
        )


# Validate torch/torchvision runtime compatibility before running ML pipelines.
def _require_torchvision_runtime() -> None:
    try:
        import torch  # noqa: F401
        import torchvision  # noqa: F401
    except Exception as exc:
        raise RuntimeError(
            "Could not import torch/torchvision runtime. Install/update requirements-ml.txt."
        ) from exc

    try:
        from torchvision.ops import nms  # noqa: F401
    except Exception as exc:
        raise RuntimeError(
            "Detected torch/torchvision binary mismatch (missing torchvision::nms). "
            "Reinstall torch, torchvision and torchaudio from the same source (CPU or same CUDA build)."
        ) from exc


# Normalize heterogeneous raw blocks to a consistent editor-friendly schema.
def _normalize_raw_blocks(raw_blocks: list[dict], source: str) -> list[dict]:
    normalized: list[dict] = []
    for idx, block in enumerate(raw_blocks):
        if not isinstance(block, dict):
            continue

        box = block.get("box")
        if not isinstance(box, list) or len(box) != 4:
            continue

        block_type = str(block.get("type") or block.get("layout_type") or "")
        content = block.get("content")
        if content in (None, ""):
            content = block.get("legend") or block.get("caption") or block_type

        normalized_type = normalize_layout_label(block_type)

        normalized.append(
            {
                **block,
                "id": idx,
                "page": safe_int(block.get("page", 1), 1),
                "box": [float(c) for c in box],
                "originalBox": [float(c) for c in box],
                "content": str(content or ""),
                "type": normalized_type,
                "layout_type": str(block.get("layout_type") or block_type or normalize_layout_label(block_type)),
                "font_size": safe_float(block.get("font_size", 11.0), 11.0),
                "color": block.get("color", (0, 0, 0)),
                "source": source,
            }
        )

    return normalized


# Run MinerU CLI extraction and normalize produced blocks.
def _extract_with_mineru_cli(input_tmp: str, output_tmp: str) -> list[dict]:
    mineru_cli = shutil.which("mineru") or shutil.which("magic-pdf")
    if mineru_cli is None:
        raise RuntimeError("MinerU CLI executable not found in environment PATH.")

    mineru_env = os.environ.copy()
    mineru_env.pop("TORCH_FORCE_WEIGHTS_ONLY_LOAD", None)
    mineru_env["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"

    try:
        subprocess.run(
            [
                mineru_cli,
                "-p",
                input_tmp,
                "-o",
                output_tmp,
                "-l",
                "en",
                "-b",
                "pipeline",
                "-m",
                "auto",
                "-d",
                "cpu",
            ],
            check=True,
            env=mineru_env,
        )
    except subprocess.CalledProcessError as exc:
        raise RuntimeError("MinerU CLI execution failed. Check backend logs for details.") from exc

    try:
        content_path = find_first_content_json(output_tmp)
        with open(content_path, "r", encoding="utf-8") as f:
            parsed = json.load(f)

        raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
        if isinstance(raw_blocks, list) and raw_blocks:
            return _normalize_raw_blocks(raw_blocks, source="mineru")
    except Exception:
        # Fallback to middle.json parsing for older MinerU outputs.
        pass

    middle_files = sorted(Path(output_tmp).rglob("*_middle.json"))
    if not middle_files:
        raise RuntimeError("MinerU did not generate *_middle.json output.")

    with open(middle_files[0], "r", encoding="utf-8") as f:
        middle_data = json.load(f)

    def _span_text(span: dict) -> str:
        return str(span.get("content") or "").strip()

    def _lines_text(lines: list[dict]) -> str:
        parts: list[str] = []
        for line in lines:
            for span in line.get("spans", []):
                text = _span_text(span)
                if text:
                    parts.append(text)
        return " ".join(parts).strip()

    def _content_from_para_block(para_block: dict) -> str:
        base = _lines_text(para_block.get("lines", []))
        if base:
            return base

        sub_parts: list[str] = []
        for sub_block in para_block.get("blocks", []):
            text = _lines_text(sub_block.get("lines", []))
            if text:
                sub_parts.append(text)
        return " ".join(sub_parts).strip()

    pdf_info = middle_data.get("pdf_info", []) if isinstance(middle_data, dict) else []
    normalized: list[dict] = []
    next_id = 0
    for page_idx, page in enumerate(pdf_info):
        page_number = page_idx + 1
        para_blocks = page.get("para_blocks", []) if isinstance(page, dict) else []
        for para_block in para_blocks:
            box = para_block.get("bbox") or para_block.get("box")
            if not isinstance(box, list) or len(box) != 4:
                continue

            block_type = str(para_block.get("type", ""))
            content = _content_from_para_block(para_block) or block_type

            normalized.append(
                {
                    "id": next_id,
                    "page": page_number,
                    "box": [float(c) for c in box],
                    "originalBox": [float(c) for c in box],
                    "content": str(content),
                    "font_size": 11.0,
                    "color": (0, 0, 0),
                    "source": "mineru",
                    "type": block_type,
                }
            )
            next_id += 1

    return _normalize_raw_blocks(normalized, source="mineru")


def _extract_with_pdf2data_cli(
    input_tmp: str,
    output_tmp: str,
    layout_models: list[str] | None = None,
    table_model: str | None = None,
    layout_model_threshold: str = "0.7",
    table_model_threshold: str = "0.5",
) -> list[dict]:
    # Run pdf2data CLI extraction with optional layout/table model controls.
    # Always run in the same interpreter as the API process to avoid venv/path mismatches.
    base_cmd = [sys.executable, "-m", "pdf2data.cli.pdf2data", input_tmp, output_tmp]
    
    if layout_models is None:
        layout_models = ["PP-DocLayout-L", "DocLayout-YOLO-DocStructBench"]
    last_error: Exception | None = None

    for layout_model in layout_models:
        cmd = [
            *base_cmd,
            "--pipeline",
            "NotDefined",
            "--layout_model",
            layout_model,
            "--layout_model_threshold",
            layout_model_threshold,
            "--table_model_threshold",
            table_model_threshold,
            "--device",
            "cpu",
        ]
        if table_model:
            cmd.extend(["--table_model", table_model])

        child_env = os.environ.copy()
        child_env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
        child_env.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
        child_env.setdefault("OMP_NUM_THREADS", "1")
        child_env.setdefault("CUDA_VISIBLE_DEVICES", "-1")

        try:
            result = subprocess.run(
                cmd,
                check=False,
                timeout=900,
                env=child_env,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                stderr_text = (result.stderr or "")
                try:
                    find_first_content_json(output_tmp)
                    has_content = True
                except Exception:
                    has_content = False

                if not (has_content and "anystyle" in stderr_text.lower()):
                    raise subprocess.CalledProcessError(
                        returncode=result.returncode,
                        cmd=cmd,
                        output=result.stdout,
                        stderr=result.stderr,
                    )
            last_error = None
            break
        except subprocess.TimeoutExpired as exc:
            last_error = exc
            continue
        except subprocess.CalledProcessError as exc:
            last_error = exc
            continue

    if last_error is not None:
        if isinstance(last_error, subprocess.TimeoutExpired):
            raise RuntimeError(
                "PDF2Data timed out. The process likely got stuck in model/runtime initialization."
            ) from last_error

        if isinstance(last_error, subprocess.CalledProcessError) and last_error.returncode == -11:
            raise RuntimeError(
                "PDF2Data crashed with SIGSEGV (native runtime fault) even after fallback. "
                "Use processor='mineru' or 'docling' on this environment."
            ) from last_error

        if isinstance(last_error, subprocess.CalledProcessError):
            stderr_text = (last_error.stderr or "").strip()
            stdout_text = (last_error.output or "").strip()
            combined = "\n".join(part for part in [stdout_text, stderr_text] if part)
            tail_lines = [line for line in combined.splitlines() if line.strip()][-25:]
            tail = "\n".join(tail_lines)
            raise RuntimeError(
                "PDF2Data execution failed in isolated subprocess. "
                f"Exit code: {last_error.returncode}. Last logs:\n{tail}"
            ) from last_error

        raise RuntimeError(
            "PDF2Data execution failed in isolated subprocess. Check backend logs for native runtime errors."
        ) from last_error

    content_path = find_first_content_json(output_tmp)
    with open(content_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    if not isinstance(raw_blocks, list):
        raw_blocks = []

    return _normalize_raw_blocks(raw_blocks, source="pdf2data")


def _extract_with_docling_cli(input_tmp: str, output_tmp: str) -> list[dict]:
    # Run Docling via pdf2data CLI and normalize extracted blocks.
    # Always run in the same interpreter as the API process to avoid venv/path mismatches.
    base_cmd = [sys.executable, "-m", "pdf2data.cli.pdf2data", input_tmp, output_tmp]

    cmd = [
        *base_cmd,
        "--pipeline",
        "Docling",
    ]

    child_env = os.environ.copy()
    child_env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    child_env.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
    child_env.setdefault("OMP_NUM_THREADS", "1")
    # Force CPU path for torch/docling models.
    child_env.setdefault("CUDA_VISIBLE_DEVICES", "-1")

    try:
        result = subprocess.run(
            cmd,
            check=False,
            timeout=900,
            env=child_env,
            capture_output=True,
            text=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Docling timed out during conversion.") from exc

    if result.returncode != 0:
        stderr_text = (result.stderr or "")
        try:
            find_first_content_json(output_tmp)
            has_content = True
        except Exception:
            has_content = False

        if has_content and "anystyle" in stderr_text.lower():
            pass
        elif "cudnn_status_not_initialized" in stderr_text.lower() or "cudnn" in stderr_text.lower():
            raise RuntimeError(
                "Docling failed due to CUDA/cuDNN runtime initialization. "
                "This environment should run Docling in CPU mode only; try again or use processor='mineru'/'pdf2data'."
            )
        else:
            raise RuntimeError("Docling execution failed in isolated subprocess.")

    content_path = find_first_content_json(output_tmp)
    with open(content_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    if not isinstance(raw_blocks, list):
        raw_blocks = []

    return _normalize_raw_blocks(raw_blocks, source="docling")


def _extract_with_mineru_pdf2data_cli(input_tmp: str, output_tmp: str) -> list[dict]:
    # Run MinerU through the pdf2data wrapper path to preserve table metadata fields.
    # Match the same execution path used by pdf2data-tools so table metadata
    # (block/cell_boxes/caption_box) is preserved when MinerU is selected.
    base_cmd = [sys.executable, "-m", "pdf2data.cli.pdf2data", input_tmp, output_tmp]
    cmd = [
        *base_cmd,
        "--pipeline",
        "MinerU",
        "--extract_tables",
        "true",
        "--extract_figures",
        "true",
        "--device",
        "cpu",
    ]

    child_env = os.environ.copy()
    child_env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    child_env.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
    child_env.setdefault("OMP_NUM_THREADS", "1")
    child_env.setdefault("CUDA_VISIBLE_DEVICES", "-1")

    try:
        result = subprocess.run(
            cmd,
            check=False,
            timeout=900,
            env=child_env,
            capture_output=True,
            text=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("MinerU timed out during conversion.") from exc

    if result.returncode != 0:
        stderr_text = (result.stderr or "")
        try:
            find_first_content_json(output_tmp)
            has_content = True
        except Exception:
            has_content = False

        if has_content and "anystyle" in stderr_text.lower():
            pass
        else:
            raise RuntimeError("MinerU execution failed via pdf2data CLI.")

    content_path = find_first_content_json(output_tmp)
    with open(content_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    if not isinstance(raw_blocks, list):
        raw_blocks = []

    return _normalize_raw_blocks(raw_blocks, source="mineru")


# Backward-compatible extraction entrypoint using default pipeline options.
def _extract_with_pipeline(input_tmp: str, output_tmp: str, processor_alias: str) -> list[dict]:
    return _extract_with_pipeline_options(
        input_tmp=input_tmp,
        output_tmp=output_tmp,
        processor_alias=processor_alias,
        pdf2data_layout_model=PDF2DATA_LAYOUT_AUTO,
        pdf2data_table_model=None,
    )


def _extract_with_pipeline_options(
    input_tmp: str,
    output_tmp: str,
    processor_alias: str,
    pdf2data_layout_model: str = PDF2DATA_LAYOUT_AUTO,
    pdf2data_table_model: str | None = None,
) -> list[dict]:
    # Route extraction requests to the selected processor implementation.
    pipeline_name = FRIENDLY_PROCESSOR_ALIASES[processor_alias]

    if pipeline_name == "NotDefined":
        _require_modules(["pdf2data", "paddleocr"], "PDF2Data")
        _require_torchvision_runtime()
        requested_layout = (pdf2data_layout_model or PDF2DATA_LAYOUT_AUTO).strip()
        if requested_layout == PDF2DATA_LAYOUT_AUTO:
            layout_models = ["PP-DocLayout-L", "DocLayout-YOLO-DocStructBench"]
        else:
            if requested_layout not in PDF2DATA_LAYOUT_MODELS:
                allowed_layouts = ", ".join(sorted(PDF2DATA_LAYOUT_MODELS | {PDF2DATA_LAYOUT_AUTO}))
                raise RuntimeError(f"Invalid pdf2data layout model: {requested_layout}. Use one of: {allowed_layouts}.")
            layout_models = [requested_layout]

        requested_table_model = (pdf2data_table_model or "").strip() or None
        if requested_table_model == "none":
            requested_table_model = None
        if requested_table_model == "microsoft/table-transformer-detection":
            pass
        elif requested_table_model is not None:
            raise RuntimeError(
                "Invalid pdf2data table model. Use 'none' or 'microsoft/table-transformer-detection'."
            )

        # Run pdf2data in a subprocess so native runtime issues cannot kill the API process.
        return _extract_with_pdf2data_cli(
            input_tmp=input_tmp,
            output_tmp=output_tmp,
            layout_models=layout_models,
            table_model=requested_table_model,
            layout_model_threshold="0.7",
            table_model_threshold="0.5",
        )
    elif pipeline_name == "MinerU":
        _require_modules(["pdf2data", "mineru", "ultralytics", "accelerate", "ftfy", "dill", "omegaconf"], "MinerU")
        # Prefer the same path used by pdf2data-tools so table metadata is kept.
        try:
            return _extract_with_mineru_pdf2data_cli(input_tmp=input_tmp, output_tmp=output_tmp)
        except Exception:
            # Fallback to direct MinerU CLI for environments where the wrapper path fails.
            return _extract_with_mineru_cli(input_tmp=input_tmp, output_tmp=output_tmp)
    elif pipeline_name == "Docling":
        _require_modules(["pdf2data", "docling"], "Docling")
        return _extract_with_docling_cli(input_tmp=input_tmp, output_tmp=output_tmp)
    elif pipeline_name in {"PaddlePPStructure", "PaddleVL"}:
        raise RuntimeError(
            "Processor temporarily disabled: paddleppstructure/paddlevl are not enabled in this build."
        )
    elif pipeline_name == "MinerUVL":
        raise RuntimeError(
            "Processor temporarily disabled: mineruvl is not enabled in this build."
        )
    else:
        raise RuntimeError(f"Unsupported pipeline: {pipeline_name}")


# Keep only upgrade-eligible blocks with valid page and box coordinates.
def _prepare_blocks_for_upgrade(blocks: list[Any]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for raw in blocks:
        if not isinstance(raw, dict):
            continue
        # Keep only upgrade-eligible blocks with valid page and box coordinates.

        box = raw.get("box")
        if not isinstance(box, list) or len(box) != 4:
            continue

        try:
            normalized_box = [float(c) for c in box]
        except Exception:
            continue

        block = dict(raw)
        block["type"] = str(raw.get("type") or "paragraph")
        block["content"] = str(raw.get("content") or "")
        block["page"] = safe_int(raw.get("page", 1), 1)
        block["box"] = normalized_box

        # Keep caption optional while normalizing type when it exists.
        if "caption" in block:
            block["caption"] = str(block.get("caption") or "")

        prepared.append(block)

    return prepared


# Normalize and aggregate keyword weights from user-provided JSON.
def _normalize_text_finder_keywords(raw_keywords: dict[str, Any]) -> dict[str, float]:
    normalized: dict[str, float] = {}
    for raw_key, raw_weight in raw_keywords.items():
        key = str(raw_key or "").strip().lower()
        if not key:
            continue

        try:
            weight = float(raw_weight)
        except Exception:
            continue

        normalized[key] = normalized.get(key, 0.0) + weight
    return normalized


# Serialize a payload as UTF-8 JSON at the given path.
def _write_json_file(path: Path, payload: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def _extract_with_text_finder_cli(
    input_tmp: str,
    output_tmp: str,
    keywords_file: str,
    word_count_threshold: int,
    find_paragraphs: bool,
    find_section_headers: bool,
    count_duplicates: bool,
) -> list[str]:
    # Delegate text finder matching to the upstream pdf2data CLI module.
    cmd = [
        sys.executable,
        "-m",
        "pdf2data.cli.text_finder",
        input_tmp,
        output_tmp,
        keywords_file,
        "--word_count_threshold",
        str(int(word_count_threshold)),
        "--find_paragraphs",
        "true" if find_paragraphs else "false",
        "--find_section_headers",
        "true" if find_section_headers else "false",
        "--count_duplicates",
        "true" if count_duplicates else "false",
    ]

    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("Text Finder execution failed via pdf2data CLI.")

    results_path = Path(output_tmp) / "found_texts.txt"
    if not results_path.exists():
        return []

    with open(results_path, "r", encoding="utf-8") as f:
        return [line.rstrip("\n") for line in f if line.strip()]


def _normalize_block_finder_keywords(raw_keywords: str) -> list[str]:
    return [line.strip() for line in str(raw_keywords or "").splitlines() if line.strip()]


def _build_block_finder_regex(keywords: list[str]) -> re.Pattern[str] | None:
    if not keywords:
        return None
    escaped = [re.escape(keyword) for keyword in keywords]
    # Sort by length to prioritize multi-word terms when regex engines backtrack.
    escaped.sort(key=len, reverse=True)
    return re.compile(rf"\b(?:{'|'.join(escaped)})\b(?!-)", re.IGNORECASE | re.MULTILINE)


def _extract_with_block_finder_cli(
    input_tmp: str,
    output_tmp: str,
    keywords_file: str,
    find_tables: bool,
    find_figures: bool,
) -> list[dict[str, Any]]:
    cmd = [
        sys.executable,
        "-m",
        "pdf2data.cli.block_finder",
        input_tmp,
        output_tmp,
        keywords_file,
        "--find_tables",
        "true" if find_tables else "false",
        "--find_figures",
        "true" if find_figures else "false",
    ]

    result = subprocess.run(cmd, check=False, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("Block Finder execution failed via pdf2data CLI.")

    results_path = Path(output_tmp) / "found_blocks.json"
    if not results_path.exists():
        return []

    with open(results_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    if not isinstance(parsed, dict) or not parsed:
        return []

    doc_payload = parsed.get("document")
    if not isinstance(doc_payload, dict):
        doc_payload = next((value for value in parsed.values() if isinstance(value, dict)), {})

    blocks = doc_payload.get("blocks", []) if isinstance(doc_payload, dict) else []
    return [block for block in blocks if isinstance(block, dict)]


def _block_finder_search_text(block: dict[str, Any]) -> str:
    caption_text = str(block.get("caption") or block.get("legend") or "").strip()
    if caption_text:
        return caption_text

    matrix = block.get("block", [])
    if not isinstance(matrix, list):
        return ""

    cell_values: list[str] = []
    for row in matrix:
        if not isinstance(row, list):
            continue
        for entry in row:
            cell_values.append(str(entry or "").strip())

    return " ".join(value for value in cell_values if value).strip()


def _block_signature(block: dict[str, Any]) -> tuple[Any, ...]:
    raw_box = block.get("box") if isinstance(block.get("box"), list) else []
    box = tuple(round(float(value), 5) for value in raw_box[:4]) if len(raw_box) == 4 else tuple()
    return (
        str(block.get("type") or ""),
        safe_int(block.get("page", 0), 0),
        box,
        str(block.get("content") or "").strip(),
        str(block.get("caption") or block.get("legend") or "").strip(),
    )


def _annotate_block_finder_blocks(
    blocks: list[dict[str, Any]],
    matched_blocks: list[dict[str, Any]],
    keyword_regex: re.Pattern[str] | None,
) -> tuple[list[dict[str, Any]], int]:
    matched_scores_by_signature: dict[tuple[Any, ...], list[int]] = {}

    for block in matched_blocks:
        text = _block_finder_search_text(block)
        score = len(keyword_regex.findall(text)) if keyword_regex is not None and text else 1
        signature = _block_signature(block)
        matched_scores_by_signature.setdefault(signature, []).append(max(int(score), 1))

    annotated: list[dict[str, Any]] = []
    highlighted_count = 0

    for block in blocks:
        signature = _block_signature(block)
        available_scores = matched_scores_by_signature.get(signature, [])
        is_highlighted = len(available_scores) > 0
        score = int(available_scores.pop(0)) if is_highlighted else 0
        if is_highlighted:
            highlighted_count += 1

        annotated.append(
            {
                **block,
                "block_finder_highlighted": is_highlighted,
                "block_finder_match_score": score,
            }
        )

    return annotated, highlighted_count


def _prepare_payload_for_block_finder_cli(formatted_doc: dict[str, Any], blocks: list[dict[str, Any]]) -> dict[str, Any]:
    # Upstream BlockFinder expects metadata.doi and direct block keys like caption/block.
    payload = dict(formatted_doc)
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    if not str(metadata.get("doi") or "").strip():
        metadata = {**metadata, "doi": "unknown-doi"}
    payload["metadata"] = metadata

    normalized_blocks: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        block_type = str(block.get("type") or "")
        normalized = dict(block)

        if block_type in {"Table", "Figure"}:
            caption = str(normalized.get("caption") or normalized.get("legend") or normalized.get("content") or "").strip()
            normalized["caption"] = caption

        if block_type == "Table":
            matrix = normalized.get("block")
            normalized["block"] = matrix if isinstance(matrix, list) else []

        normalized_blocks.append(normalized)

    payload["blocks"] = normalized_blocks
    return payload


# Annotate blocks with highlight and match-score metadata from matched texts.
def _annotate_text_finder_blocks(blocks: list[dict[str, Any]], matched_texts: list[str]) -> tuple[list[dict[str, Any]], int]:
    content_scores = Counter(text.strip().replace("\n", " ") for text in matched_texts if str(text).strip())
    remaining = Counter(content_scores)
    annotated: list[dict[str, Any]] = []
    highlighted_count = 0

    for block in blocks:
        content = str(block.get("content") or "").replace("\n", " ").strip()
        if not content:
            annotated.append({**block, "text_finder_highlighted": False, "text_finder_match_score": 0})
            continue

        match_score = int(content_scores.get(content, 0))
        is_highlighted = remaining.get(content, 0) > 0
        if is_highlighted:
            remaining[content] -= 1
            highlighted_count += 1

        annotated.append({
            **block,
            "text_finder_highlighted": is_highlighted,
            "text_finder_match_score": match_score if is_highlighted else 0,
        })

    return annotated, highlighted_count


@app.get("/api/processors")
# Return available processors with their enabled state for the frontend selector.
async def list_processors():
    default_processor = next(
        (item["alias"] for item in PROCESSOR_CATALOG if item.get("enabled")),
        PROCESSOR_CATALOG[0]["alias"],
    )
    return {
        "default_processor": default_processor,
        "processors": [
            {
                "alias": item["alias"],
                "label": item["label"],
                "enabled": bool(item.get("enabled", False)),
                "reason": item.get("reason"),
            }
            for item in PROCESSOR_CATALOG
        ],
    }

@app.post("/api/upload")
# Extract PDF content blocks using the selected processor and return canonical JSON.
async def upload_and_process(
    file: UploadFile = File(...),
    processor: str = Form("pdf2data"),
    pdf2data_layout_model: str = Form(PDF2DATA_LAYOUT_AUTO),
    pdf2data_table_model: str = Form("none"),
):
    try:
        import pdf2data  # noqa: F401
    except ModuleNotFoundError as e:
        # Keep the API alive even if optional ML dependencies are missing.
        raise HTTPException(
            status_code=500,
            detail=(
                f"Missing dependency for PDF processing: '{e.name}'. "
                "Install the ML dependencies to use /api/upload."
            ),
        )

    file_id = str(uuid.uuid4())
    processor_name = processor.strip().lower()
    if processor_name not in FRIENDLY_PROCESSOR_ALIASES:
        allowed = ", ".join(sorted(FRIENDLY_PROCESSOR_ALIASES.keys()))
        raise HTTPException(status_code=400, detail=f"Invalid processor. Use one of: {allowed}.")

    try:
        with tempfile.TemporaryDirectory(prefix="pdfwf_in_") as input_tmp, tempfile.TemporaryDirectory(
            prefix="pdfwf_out_"
        ) as output_tmp:
            filename = f"{file_id}.pdf"
            file_path = Path(input_tmp) / filename

            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            blocks_data = _extract_with_pipeline_options(
                input_tmp=input_tmp,
                output_tmp=output_tmp,
                processor_alias=processor_name,
                pdf2data_layout_model=pdf2data_layout_model,
                pdf2data_table_model=pdf2data_table_model,
            )

            native_content = read_native_content_envelope(output_tmp)

            copied_assets = persist_extracted_assets(file_id=file_id, output_tmp=output_tmp)

            doc = fitz.open(str(file_path))
            page_sizes = []

            for page_idx in range(doc.page_count):
                page_number = page_idx + 1
                page = doc[page_idx]
                page_sizes.append(
                    {
                        "page": page_number,
                        "width": page.rect.width,
                        "height": page.rect.height,
                    }
                )

            # Backfill missing text content from PDF for any empty text-like block.
            for block in blocks_data:
                if str(block.get("content") or "").strip():
                    continue
                page_number = int(block.get("page", 1))
                if page_number < 1 or page_number > doc.page_count:
                    continue
                page = doc[page_number - 1]
                rect = fitz.Rect(block["box"])
                block["content"] = page.get_textbox(rect).strip() or " "

            pdf_size = (
                {"width": page_sizes[0]["width"], "height": page_sizes[0]["height"]}
                if page_sizes
                else {"width": 0, "height": 0}
            )
            doc.close()

            return {
                "id": file_id,
                "processor": processor_name,
                "processor_options": {
                    "pdf2data_layout_model": pdf2data_layout_model,
                    "pdf2data_table_model": pdf2data_table_model,
                },
                "metadata": native_content["metadata"],
                "references": native_content["references"],
                "blocks": blocks_data,
                "pdf_size": pdf_size,
                "page_sizes": page_sizes,
                    # Return available processors with their enabled state for the frontend selector.
                "assets_count": copied_assets,
            }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/actions/edit-json")
async def edit_json_action(payload: EditJsonPayload):
    """Edit a specific target (block, tableCell, or tableCaption) in the JSON data using JsonBoxEditor."""
    try:
        editor = JsonBoxEditor(data=payload.data)
        
        # Convert EditTarget to the dict format expected by JsonBoxEditor
        target_dict = {
            "kind": payload.target.kind,
            "block_index": payload.target.block_index,
        }
        if payload.target.kind == "tableCell":
            target_dict["row"] = payload.target.row
            target_dict["col"] = payload.target.col
        elif payload.target.kind == "tableCaption":
            target_dict["caption_index"] = payload.target.caption_index
        
        editor.update_target(target_dict, payload.value)
        
        return {
            "success": True,
            "data": editor.data,
                    # Extract PDF content blocks using the selected processor and return canonical JSON.
            "canonical": editor.to_canonical_content_json(),
        }
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=400, detail=f"Edit failed: {str(exc)}") from exc
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Edit action failed: {str(exc)}") from exc


@app.post("/api/actions/upgrade-json")
# Upgrade extracted JSON by correcting text and/or merging nearby figure blocks.
async def upgrade_json_action(payload: UpgradePayload):
    mode = str(payload.mode or "both").strip().lower()
    if mode not in {"text", "figures", "both"}:
        raise HTTPException(status_code=400, detail="Invalid upgrade mode. Use one of: text, figures, both.")

    try:
        from pdf2data.upgrade import Upgrader
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Upgrade dependency is unavailable in this environment.") from exc

    try:
        formatted = format_as_content_json(dict(payload.data))
        blocks = _prepare_blocks_for_upgrade(json.loads(json.dumps(formatted.get("blocks", []))))

        upgrader = Upgrader(
            correct_unicodes=mode in {"text", "both"},
            merge_figures=mode in {"figures", "both"},
            all_documents=False,
            distance_threshold=float(payload.distance_threshold),
        )

        if upgrader.correct_unicodes:
            blocks = upgrader.correct_unicodes_in_blocks(blocks)
        if upgrader.merge_figures:
            blocks = upgrader.merge_close_figures(blocks)

        formatted["blocks"] = blocks
        return {
            "mode": mode,
            "summary": {
                "blocks_before": len(payload.data.get("blocks", [])) if isinstance(payload.data.get("blocks"), list) else 0,
                "blocks_after": len(blocks),
            },
            "data": formatted,
        }
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upgrade action failed: {exc}") from exc


@app.post("/api/actions/text-finder")
# Run keyword matching and return blocks annotated with text-finder highlights.
async def text_finder_action(payload: TextFinderPayload):
    if not payload.find_paragraphs and not payload.find_section_headers:
        raise HTTPException(status_code=400, detail="Enable at least one target type: paragraphs or section headers.")

    keyword_weights = _normalize_text_finder_keywords(dict(payload.keywords or {}))
    if not keyword_weights:
        raise HTTPException(status_code=400, detail="Keywords file is empty or invalid.")

    try:
        formatted = format_as_content_json(dict(payload.data))
        blocks = _prepare_blocks_for_upgrade(json.loads(json.dumps(formatted.get("blocks", []))))
        threshold = int(float(payload.word_count_threshold))

        with tempfile.TemporaryDirectory(prefix="pdfwf_textfinder_in_") as input_tmp, tempfile.TemporaryDirectory(
            prefix="pdfwf_textfinder_out_"
        ) as output_tmp, tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as keywords_tmp:
            try:
                doc_folder = Path(input_tmp) / "document"
                doc_folder.mkdir(parents=True, exist_ok=True)

                doc_payload = _prepare_payload_for_block_finder_cli(formatted, blocks)
                _write_json_file(doc_folder / "document_content.json", doc_payload)

                _write_json_file(Path(keywords_tmp.name), keyword_weights)
                keywords_tmp.flush()

                matched_texts = _extract_with_text_finder_cli(
                    input_tmp=input_tmp,
                    output_tmp=output_tmp,
                    keywords_file=keywords_tmp.name,
                    word_count_threshold=threshold,
                    find_paragraphs=bool(payload.find_paragraphs),
                    find_section_headers=bool(payload.find_section_headers),
                    count_duplicates=bool(payload.count_duplicates),
                )
            finally:
                try:
                    os.unlink(keywords_tmp.name)
                except Exception:
                    pass

        annotated_blocks, highlighted_count = _annotate_text_finder_blocks(blocks, matched_texts)
        normalized_matches = [str(text).strip().replace("\n", " ") for text in matched_texts if str(text).strip()]
        match_counts = Counter(normalized_matches)

        result = dict(formatted)
        result["blocks"] = annotated_blocks
        max_match_score = max((int(block.get("text_finder_match_score", 0)) for block in annotated_blocks), default=0)

        return {
            "summary": {
                "blocks_before": len(blocks),
                "blocks_after": highlighted_count,
                "highlighted_count": highlighted_count,
                "max_match_score": max_match_score,
                "threshold": threshold,
                "keywords_count": len(keyword_weights),
            },
            "found_texts": normalized_matches,
            "found_texts_artifact": {
                "matches": [
                    {
                        "content": text,
                        "score": int(match_counts.get(text, 0)),
                    }
                    for text in normalized_matches
                ],
                "total_matches": len(normalized_matches),
                "unique_matches": len(match_counts),
                "settings": {
                    "word_count_threshold": threshold,
                    "find_paragraphs": bool(payload.find_paragraphs),
                    "find_section_headers": bool(payload.find_section_headers),
                    "count_duplicates": bool(payload.count_duplicates),
                },
            },
            "data": result,
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Text finder action failed: {exc}") from exc


@app.post("/api/actions/block-finder")
# Run keyword matching over table/figure blocks and return blocks annotated with block-finder highlights.
async def block_finder_action(payload: BlockFinderPayload):
    if not payload.find_tables and not payload.find_figures:
        raise HTTPException(status_code=400, detail="Enable at least one target type: tables or figures.")

    keywords_list = _normalize_block_finder_keywords(payload.keywords)
    if not keywords_list:
        raise HTTPException(status_code=400, detail="Keywords file is empty or invalid.")

    keyword_regex = _build_block_finder_regex(keywords_list)

    try:
        formatted = format_as_content_json(dict(payload.data))
        blocks = _prepare_blocks_for_upgrade(json.loads(json.dumps(formatted.get("blocks", []))))

        with tempfile.TemporaryDirectory(prefix="pdfwf_blockfinder_in_") as input_tmp, tempfile.TemporaryDirectory(
            prefix="pdfwf_blockfinder_out_"
        ) as output_tmp, tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as keywords_tmp:
            try:
                doc_folder = Path(input_tmp) / "document"
                doc_folder.mkdir(parents=True, exist_ok=True)

                doc_payload = _prepare_payload_for_block_finder_cli(formatted, blocks)
                _write_json_file(doc_folder / "document_content.json", doc_payload)

                keywords_tmp.write("\n".join(keywords_list) + "\n")
                keywords_tmp.flush()

                matched_blocks = _extract_with_block_finder_cli(
                    input_tmp=input_tmp,
                    output_tmp=output_tmp,
                    keywords_file=keywords_tmp.name,
                    find_tables=bool(payload.find_tables),
                    find_figures=bool(payload.find_figures),
                )
            finally:
                try:
                    os.unlink(keywords_tmp.name)
                except Exception:
                    pass

        annotated_blocks, highlighted_count = _annotate_block_finder_blocks(blocks, matched_blocks, keyword_regex)

        result = dict(formatted)
        result["blocks"] = annotated_blocks
        max_match_score = max((int(block.get("block_finder_match_score", 0)) for block in annotated_blocks), default=0)

        return {
            "summary": {
                "blocks_before": len(blocks),
                "blocks_after": highlighted_count,
                "highlighted_count": highlighted_count,
                "max_match_score": max_match_score,
                "keywords_count": len(keywords_list),
                "find_tables": bool(payload.find_tables),
                "find_figures": bool(payload.find_figures),
            },
            "found_blocks_artifact": {
                "blocks": [
                    {
                        **block,
                        "block_finder_match_score": max(len(keyword_regex.findall(_block_finder_search_text(block))), 1)
                        if keyword_regex is not None
                        else 1,
                    }
                    for block in matched_blocks
                ],
                "total_matches": len(matched_blocks),
                "unique_matches": len({_block_signature(block) for block in matched_blocks}),
                "settings": {
                    "find_tables": bool(payload.find_tables),
                    "find_figures": bool(payload.find_figures),
                },
            },
            "data": result,
        }
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Block finder action failed: {exc}") from exc


@app.get("/api/assets/{doc_id}/{asset_path:path}")
# Serve a cached extracted asset file while blocking path traversal.
async def get_extracted_asset(doc_id: str, asset_path: str):
    doc_folder = (ASSET_CACHE_ROOT / doc_id).resolve()
    if not doc_folder.exists() or not doc_folder.is_dir():
        raise HTTPException(status_code=404, detail="Asset document not found")

    # Prevent path traversal and serve only files inside the per-document cache.
    target = (doc_folder / asset_path).resolve()
    if doc_folder not in target.parents and target != doc_folder:
        raise HTTPException(status_code=400, detail="Invalid asset path")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Asset file not found")

    return FileResponse(path=target)


@app.get("/api/assets-manifest/{doc_id}")
# Return the list of cached image assets for a given document id.
async def get_assets_manifest(doc_id: str):
    return {
        "doc_id": doc_id,
        "assets": _list_cached_assets(doc_id),
    }

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)