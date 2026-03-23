import uuid
import shutil
import traceback
import tempfile
import json
import importlib.util
import subprocess
import os
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import fitz

app = FastAPI()

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


class SaveEditedPayload(BaseModel):
    output_folder: str
    data: dict
    document_name: str | None = None


def _extract_with_pdf2data(file_path: Path, input_tmp: str, output_tmp: str) -> list[dict]:
    from pdf2data.pdf2data_pipeline import PDF2Data

    pipeline = PDF2Data(
        layout_model="DocLayout-YOLO-DocStructBench",
        layout_model_threshold=0.5,
        table_model=None,
        table_model_threshold=0.5,
        device="cpu",
        input_folder=input_tmp,
        output_folder=output_tmp,
        extract_text=True,
        extract_tables=True,
        extract_figures=True,
        extract_equations=True,
        extract_references=False,
    )
    pipeline.pdf_transform()

    content_files = sorted(Path(output_tmp).rglob("*_content.json"))
    if not content_files:
        raise RuntimeError(
            "PDF2Data did not generate any *_content.json output. Verify pdf2data-tools installation/version."
        )

    with open(content_files[0], "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    blocks_data: list[dict] = []
    for idx, block in enumerate(raw_blocks):
        box = block.get("box")
        if not isinstance(box, list) or len(box) != 4:
            continue

        block_type = str(block.get("type") or "")
        content = block.get("content")
        if not content:
            content = block.get("legend") or block.get("caption") or block_type

        normalized_block = {
            **block,
            "id": idx,
            "page": int(block.get("page", 1)),
            "box": [float(c) for c in box],
            "originalBox": [float(c) for c in box],
            "content": str(content or ""),
            "type": _normalize_layout_label(block_type),
            "layout_type": block_type or _normalize_layout_label(block_type),
            "font_size": float(block.get("font_size", 11.0)),
            "color": block.get("color", (0, 0, 0)),
            "source": "pdf2data",
        }
        blocks_data.append(normalized_block)

    print(f"DEBUG: PDF2Data normalized {len(blocks_data)} blocks from *_content.json.")
    return blocks_data


def _extract_with_mineru(input_tmp: str, output_tmp: str) -> list[dict]:
    if importlib.util.find_spec("ultralytics") is None:
        raise RuntimeError(
            "Missing dependency for MinerU: 'ultralytics'. Install requirements-ml.txt."
        )

    if importlib.util.find_spec("accelerate") is None:
        raise RuntimeError(
            "Missing dependency for MinerU: 'accelerate'. Install requirements-ml.txt."
        )

    if importlib.util.find_spec("ftfy") is None:
        raise RuntimeError(
            "Missing dependency for MinerU: 'ftfy'. Install requirements-ml.txt."
        )

    if importlib.util.find_spec("dill") is None:
        raise RuntimeError(
            "Missing dependency for MinerU: 'dill'. Install requirements-ml.txt."
        )

    if importlib.util.find_spec("omegaconf") is None:
        raise RuntimeError(
            "Missing dependency for MinerU: 'omegaconf'. Install requirements-ml.txt."
        )

    mineru_cli = shutil.which("mineru") or shutil.which("magic-pdf")
    if mineru_cli is None:
        raise RuntimeError(
            "MinerU CLI executable not found. Install and configure the 'mineru' command in this environment."
        )

    # Force MinerU to run on CPU with pipeline backend for low-memory GPUs.
    mineru_env = os.environ.copy()
    # Torch >=2.6 defaults to weights_only=True in torch.load, which breaks
    # some MinerU/doclayout checkpoints. Force legacy-compatible loading.
    mineru_env.pop("TORCH_FORCE_WEIGHTS_ONLY_LOAD", None)
    mineru_env["TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD"] = "1"

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
    except subprocess.CalledProcessError as e:
        raise RuntimeError(
            "MinerU execution failed. Check MinerU logs above (for example model download or runtime dependency errors)."
        ) from e
    except FileNotFoundError as e:
        raise RuntimeError(
            "MinerU failed to produce expected output files. Check MinerU logs above for the first dependency/runtime error."
        ) from e

    middle_files = sorted(Path(output_tmp).rglob("*_middle.json"))
    if not middle_files:
        raise RuntimeError(
            "MinerU completed but did not generate any *_middle.json output. Check MinerU logs above for the first dependency/runtime error."
        )

    with open(middle_files[0], "r", encoding="utf-8") as f:
        middle_data = json.load(f)

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

    print(f"DEBUG: MinerU normalized {len(normalized)} blocks.")
    return normalized

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
    if processor_name not in {"pdf2data", "mineru"}:
        raise HTTPException(status_code=400, detail="Invalid processor. Use 'pdf2data' or 'mineru'.")

    try:
        with tempfile.TemporaryDirectory(prefix="pdfwf_in_") as input_tmp, tempfile.TemporaryDirectory(
            prefix="pdfwf_out_"
        ) as output_tmp:
            filename = f"{file_id}.pdf"
            file_path = Path(input_tmp) / filename

            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            if processor_name == "pdf2data":
                blocks_data = _extract_with_pdf2data(file_path=file_path, input_tmp=input_tmp, output_tmp=output_tmp)
            else:
                blocks_data = _extract_with_mineru(input_tmp=input_tmp, output_tmp=output_tmp)

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

            if processor_name == "pdf2data":
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

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)