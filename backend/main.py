import uuid
import shutil
import traceback
import tempfile
import json
import importlib.util
import os
import sys
import subprocess
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


def _persist_extracted_assets(file_id: str, output_tmp: str) -> int:
    return persist_extracted_assets(file_id=file_id, output_tmp=output_tmp, asset_root=ASSET_CACHE_ROOT)


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


def _require_modules(module_names: list[str], pipeline_name: str) -> None:
    missing = [name for name in module_names if importlib.util.find_spec(name) is None]
    if missing:
        raise RuntimeError(
            f"Missing dependency for {pipeline_name}: {', '.join(missing)}. Install requirements-ml.txt."
        )


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

        normalized.append(
            {
                **block,
                "id": idx,
                "page": safe_int(block.get("page", 1), 1),
                "box": [float(c) for c in box],
                "originalBox": [float(c) for c in box],
                "content": str(content or ""),
                "type": normalize_layout_label(block_type),
                "layout_type": str(block.get("layout_type") or block_type or normalize_layout_label(block_type)),
                "font_size": safe_float(block.get("font_size", 11.0), 11.0),
                "color": block.get("color", (0, 0, 0)),
                "source": source,
            }
        )

    return normalized


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


def _prepare_blocks_for_upgrade(blocks: list[Any]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for raw in blocks:
        if not isinstance(raw, dict):
            continue

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


@app.get("/api/processors")
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
            "canonical": editor.to_canonical_content_json(),
        }
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=400, detail=f"Edit failed: {str(exc)}") from exc
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Edit action failed: {str(exc)}") from exc


@app.post("/api/actions/upgrade-json")
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


@app.get("/api/assets/{doc_id}/{asset_path:path}")
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
async def get_assets_manifest(doc_id: str):
    return {
        "doc_id": doc_id,
        "assets": _list_cached_assets(doc_id),
    }

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)