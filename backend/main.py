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

app = FastAPI()

ASSET_CACHE_ROOT = Path(tempfile.gettempdir()) / "pdfwf_assets"
ASSET_CACHE_ROOT.mkdir(parents=True, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _normalize_block_type(block: dict) -> str:
    raw = str(block.get("type") or "").strip().lower()
    if raw in {"section_header", "paragraph"}:
        return raw
    if raw in {"title", "header", "heading"}:
        return "section_header"
    if raw in {"table", "figure", "equation"}:
        return raw.capitalize()
    return "paragraph"


def _normalize_layout_label(raw_label: str) -> str:
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


def _build_columnar_fields(blocks: list[dict]) -> dict:
    text_list: list[str] = []
    type_list: list[str] = []
    coordinates_list: list[list[float]] = []

    for block in blocks:
        content = str(block.get("content") or "")
        box = block.get("box")
        if not isinstance(box, list) or len(box) != 4:
            continue

        text_list.append(content)
        type_list.append(_normalize_block_type(block))
        coordinates_list.append([float(c) for c in box])

    return {
        "Text": text_list,
        "Type": type_list,
        "Coordinates": coordinates_list,
    }


def _persist_extracted_assets(file_id: str, output_tmp: str) -> int:
    output_root = Path(output_tmp)
    cache_folder = ASSET_CACHE_ROOT / file_id
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


def _list_cached_assets(doc_id: str) -> list[str]:
    doc_folder = (ASSET_CACHE_ROOT / doc_id).resolve()
    if not doc_folder.exists() or not doc_folder.is_dir():
        return []

    image_suffixes = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"}
    assets: list[str] = []
    for item in doc_folder.rglob("*"):
        if not item.is_file() or item.suffix.lower() not in image_suffixes:
            continue
        assets.append(item.relative_to(doc_folder).as_posix())

    return sorted(assets)


class SaveEditedPayload(BaseModel):
    output_folder: str
    data: dict
    document_name: str | None = None


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


def _safe_int(value: Any, default: int = 1) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value: Any, default: float = 11.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


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
                "page": _safe_int(block.get("page", 1), 1),
                "box": [float(c) for c in box],
                "originalBox": [float(c) for c in box],
                "content": str(content or ""),
                "type": _normalize_layout_label(block_type),
                "layout_type": str(block.get("layout_type") or block_type or _normalize_layout_label(block_type)),
                "font_size": _safe_float(block.get("font_size", 11.0), 11.0),
                "color": block.get("color", (0, 0, 0)),
                "source": source,
            }
        )

    return normalized


def _find_first_content_json(output_tmp: str) -> Path:
    content_files = sorted(Path(output_tmp).rglob("*_content.json"))
    if not content_files:
        raise RuntimeError("Pipeline finished without generating *_content.json output.")
    return content_files[0]


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


def _extract_with_pdf2data_cli(input_tmp: str, output_tmp: str) -> list[dict]:
    # Always run in the same interpreter as the API process to avoid venv/path mismatches.
    base_cmd = [sys.executable, "-m", "pdf2data.cli.pdf2data", input_tmp, output_tmp]
    
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
            "0.7",
            "--table_model_threshold",
            "0.5",
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
            if result.returncode != 0:
                stderr_text = (result.stderr or "")
                try:
                    _find_first_content_json(output_tmp)
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

    content_path = _find_first_content_json(output_tmp)
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
            _find_first_content_json(output_tmp)
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

    content_path = _find_first_content_json(output_tmp)
    with open(content_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    if not isinstance(raw_blocks, list):
        raw_blocks = []

    return _normalize_raw_blocks(raw_blocks, source="docling")


def _extract_with_pipeline(input_tmp: str, output_tmp: str, processor_alias: str) -> list[dict]:
    pipeline_name = FRIENDLY_PROCESSOR_ALIASES[processor_alias]

    if pipeline_name == "NotDefined":
        _require_modules(["pdf2data", "paddleocr"], "PDF2Data")
        _require_torchvision_runtime()
        # Run pdf2data in a subprocess so native runtime issues cannot kill the API process.
        return _extract_with_pdf2data_cli(input_tmp=input_tmp, output_tmp=output_tmp)
    elif pipeline_name == "MinerU":
        _require_modules(["pdf2data", "mineru", "ultralytics", "accelerate", "ftfy", "dill", "omegaconf"], "MinerU")
        # Use MinerU CLI path directly; more stable across MinerU output layout changes.
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
async def upload_and_process(file: UploadFile = File(...), processor: str = Form("pdf2data")):
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

            blocks_data = _extract_with_pipeline(
                input_tmp=input_tmp,
                output_tmp=output_tmp,
                processor_alias=processor_name,
            )

            copied_assets = _persist_extracted_assets(file_id=file_id, output_tmp=output_tmp)

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
                "blocks": blocks_data,
                **_build_columnar_fields(blocks_data),
                "amount": len(blocks_data),
                "doi": "",
                "pdf_size": pdf_size,
                "page_sizes": page_sizes,
                "assets_count": copied_assets,
            }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save-edited-json")
async def save_edited_json(payload: SaveEditedPayload):
    try:
        output_root = Path(payload.output_folder).expanduser()
        output_root.mkdir(parents=True, exist_ok=True)

        data = dict(payload.data)
        blocks = data.get("blocks")
        if isinstance(blocks, list):
            data.update(_build_columnar_fields(blocks))
            data["amount"] = len(blocks)

        data.setdefault("doi", "")
        raw_name = str(payload.document_name or data.get("id") or uuid.uuid4()).strip()
        safe_name = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in raw_name)
        safe_name = safe_name or str(uuid.uuid4())

        doc_folder = output_root / safe_name
        images_folder = doc_folder / f"{safe_name}_images"
        doc_folder.mkdir(parents=True, exist_ok=True)
        images_folder.mkdir(parents=True, exist_ok=True)

        filename = f"{safe_name}_content.json"
        file_path = doc_folder / filename

        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        return {
            "saved_path": str(file_path),
            "saved_folder": str(doc_folder),
            "images_folder": str(images_folder),
            "filename": filename,
        }
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to save edited JSON: {e}")


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