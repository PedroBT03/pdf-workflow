import json
import shutil
import subprocess
import tempfile
import traceback
import uuid
import sys
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from actions import extract_json_from_pdf as extract_action
from actions.block_extractor import *
from actions.block_finder import *
from actions.edit_json import *
from actions.extract_json_from_pdf import *
from actions.text_finder import *
from actions.upgrade_json import *

from utils.utils import (
    ASSET_CACHE_ROOT,
    find_first_content_json,
    list_cached_assets,
    persist_extracted_assets,
    read_native_content_envelope,
)

FRIENDLY_PROCESSOR_ALIASES = extract_action.FRIENDLY_PROCESSOR_ALIASES
PDF2DATA_LAYOUT_AUTO = extract_action.PDF2DATA_LAYOUT_AUTO


def get_project_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).resolve().parent))
    return Path(__file__).resolve().parent.parent

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount frontend static files
frontend_dist = get_project_root() / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")


# TODO: DEV
# Development endpoint: load test JSON from file to bypass PDF extraction.
@app.get("/api/dev/load-test-json")
async def load_test_json():
    file_path = get_project_root() / "test_content.json"

    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Ficheiro test_content.json não encontrado na raiz.")

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        if "id" not in data:
            data["id"] = "dev-static-id"
        if "blocks" not in data:
            data["blocks"] = []

        return data
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Erro ao ler JSON: {str(exc)}") from exc

# TODO: DEV

@app.get("/api/processors")
# Return available processors with their enabled state for the frontend selector.
async def list_processors():
    return extract_action.build_processors_payload()


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
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                f"Missing dependency for PDF processing: '{exc.name}'. "
                "Install the ML dependencies to use /api/upload."
            ),
        ) from exc

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

            return run_upload_and_process(
                file_path=str(file_path),
                file_id=file_id,
                input_tmp=input_tmp,
                output_tmp=output_tmp,
                processor_alias=processor_name,
                pdf2data_layout_model=pdf2data_layout_model,
                pdf2data_table_model=pdf2data_table_model,
                require_modules_fn=require_modules,
                require_torchvision_runtime_fn=require_torchvision_runtime,
                extract_with_pdf2data_cli_fn=lambda **kwargs: extract_with_pdf2data_cli(find_first_content_json=find_first_content_json, **kwargs),
                extract_with_mineru_pdf2data_cli_fn=lambda **kwargs: extract_with_mineru_pdf2data_cli(find_first_content_json=find_first_content_json, run_cmd=subprocess.run, **kwargs),
                extract_with_mineru_cli_fn=lambda **kwargs: extract_with_mineru_cli(find_first_content_json=find_first_content_json, **kwargs),
                extract_with_docling_cli_fn=lambda **kwargs: extract_with_docling_cli(find_first_content_json=find_first_content_json, **kwargs),
                read_native_content_envelope_fn=read_native_content_envelope,
                persist_extracted_assets_fn=persist_extracted_assets,
            )

    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/actions/edit-json")
# Apply edit operations to JSON data at specified block locations.
async def edit_json_action(payload: EditJsonPayload):
    try:
        return run_edit_json_action(payload)
    except (ValueError, IndexError) as exc:
        raise HTTPException(status_code=400, detail=f"Edit failed: {str(exc)}") from exc
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Edit action failed: {str(exc)}") from exc


@app.post("/api/actions/upgrade-json")
# Upgrade extracted JSON by correcting text and/or merging nearby figure blocks.
async def upgrade_json_action(payload: UpgradePayload):
    try:
        return run_upgrade_json_action(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ModuleNotFoundError as exc:
        raise HTTPException(status_code=500, detail="Upgrade dependency is unavailable in this environment.") from exc
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upgrade action failed: {exc}") from exc


@app.post("/api/actions/text-finder")
# Run keyword matching and return blocks annotated with text-finder highlights.
async def text_finder_action(payload: TextFinderPayload):
    try:
        return run_text_finder_action(
            payload=payload,
            extract_with_text_finder_cli_fn=lambda **kwargs: extract_with_text_finder_cli(run_cmd=subprocess.run, **kwargs),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Text finder action failed: {exc}") from exc


@app.post("/api/actions/block-finder")
# Run keyword matching over table/figure blocks and return blocks annotated with block-finder highlights.
async def block_finder_action(payload: BlockFinderPayload):
    try:
        return run_block_finder_action(
            payload=payload,
            extract_with_block_finder_cli_fn=lambda **kwargs: extract_with_block_finder_cli(run_cmd=subprocess.run, **kwargs),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Block finder action failed: {exc}") from exc


@app.post("/api/actions/block-extractor")
# Extract table blocks from the PDF using pdf2data-tools; optionally reuse an existing JSON artifact as a fast path.
async def block_extractor_action(
    file: UploadFile | None = File(None),
    processor: str = Form("pdf2data"),
    pdf2data_layout_model: str = Form(PDF2DATA_LAYOUT_AUTO),
    pdf2data_table_model: str = Form("none"),
    use_existing_json: bool = Form(False),
    existing_json: str = Form(""),
):
    try:
        return run_block_extractor_action(
            file=file,
            processor=processor,
            pdf2data_layout_model=pdf2data_layout_model,
            pdf2data_table_model=pdf2data_table_model,
            use_existing_json=use_existing_json,
            existing_json=existing_json,
            require_modules_fn=require_modules,
            require_torchvision_runtime_fn=require_torchvision_runtime,
            extract_with_block_extractor_cli_fn=lambda **kwargs: extract_with_block_extractor_cli(run_cmd=subprocess.run, **kwargs),
            read_native_content_envelope_fn=read_native_content_envelope,
            persist_extracted_assets_fn=persist_extracted_assets,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Block extractor action failed: {exc}") from exc


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
        "assets": list_cached_assets(doc_id=doc_id, asset_root=ASSET_CACHE_ROOT),
    }


@app.get("/")
async def serve_frontend_index():
    index_file = frontend_dist / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend not built")
    return FileResponse(index_file)


@app.get("/{full_path:path}")
async def serve_frontend_spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")

    index_file = frontend_dist / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="Frontend not built")
    return FileResponse(index_file)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
