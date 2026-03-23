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
import fitz

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    )

    doc_layout = pipeline._mask.get_layout(str(file_path))
    boxes_by_page = doc_layout.get("boxes", []) if isinstance(doc_layout, dict) else []

    blocks_data: list[dict] = []
    next_id = 0
    for page_idx, page_boxes in enumerate(boxes_by_page):
        page_number = page_idx + 1
        print(f"DEBUG: PDF2Data detected {len(page_boxes)} blocks on page {page_number}.")
        for box in page_boxes:
            blocks_data.append(
                {
                    "id": next_id,
                    "page": page_number,
                    "box": [float(c) for c in box],
                    "originalBox": [float(c) for c in box],
                    "content": "",
                    "font_size": 11.0,
                    "color": (0, 0, 0),
                    "source": "pdf2data",
                }
            )
            next_id += 1

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
                # Fill content from original PDF text boxes for PDF2Data boxes.
                for block in blocks_data:
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
                "pdf_size": pdf_size,
                "page_sizes": page_sizes,
            }

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)