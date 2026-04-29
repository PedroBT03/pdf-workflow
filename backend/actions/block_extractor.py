import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Callable

import fitz

from utils.utils import (
    find_first_content_json,
    format_as_content_json,
    normalize_layout_label,
    persist_extracted_assets,
    read_native_content_envelope,
    safe_float,
    safe_int,
)
from .extract_json_from_pdf import (
    FRIENDLY_PROCESSOR_ALIASES,
    PDF2DATA_LAYOUT_AUTO,
    PDF2DATA_LAYOUT_MODELS,
    require_modules,
    require_torchvision_runtime,
)
from .upgrade_json import prepare_blocks_for_upgrade


# Normalize incoming blocks into a stable schema for block extraction.
def prepare_blocks_for_block_extractor(blocks: list[Any]) -> list[dict[str, Any]]:
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
        block["type"] = str(raw.get("type") or raw.get("layout_type") or "")
        block["content"] = str(raw.get("content") or raw.get("caption") or raw.get("legend") or "")
        block["page"] = safe_int(raw.get("page", 1), 1)
        block["box"] = normalized_box

        if "caption" in block:
            block["caption"] = str(block.get("caption") or "")

        prepared.append(block)

    return prepared


def _run_pdf2data_direct(
    input_tmp: str,
    output_tmp: str,
    layout_model: str,
    table_model: str | None,
    layout_model_threshold: str,
    table_model_threshold: str,
) -> None:
    """Execute pdf2data directly using the Python API to avoid frozen CLI subprocess issues."""
    temp_home = tempfile.mkdtemp(prefix="pdfwf_home_")
    pdf2doi_config_dir = os.path.join(temp_home, "pdf2doi")
    os.makedirs(pdf2doi_config_dir, exist_ok=True)

    previous_home = os.environ.get("HOME")
    previous_userprofile = os.environ.get("USERPROFILE")
    previous_pdf2doi_config = os.environ.get("PDF2DOI_CONFIG_DIR")

    try:
        os.environ["HOME"] = temp_home
        os.environ["USERPROFILE"] = temp_home
        os.environ["PDF2DOI_CONFIG_DIR"] = pdf2doi_config_dir

        from pdf2data.pdf2data_pipeline import PDF2Data

        pdf2data_pipeline = PDF2Data(
            layout_model=layout_model,
            layout_model_threshold=float(layout_model_threshold),
            table_model=table_model,
            table_model_threshold=float(table_model_threshold),
            table_structure_model="microsoft/table-structure-recognition-v1.1-all",
            device="cpu",
            input_folder=input_tmp,
            output_folder=output_tmp,
            extract_tables=True,
            extract_figures=True,
            extract_text=True,
            extract_equations=True,
            extract_references=False,
        )
        pdf2data_pipeline.pdf_transform()
    finally:
        if previous_home:
            os.environ["HOME"] = previous_home
        else:
            os.environ.pop("HOME", None)
        if previous_userprofile:
            os.environ["USERPROFILE"] = previous_userprofile
        else:
            os.environ.pop("USERPROFILE", None)
        if previous_pdf2doi_config:
            os.environ["PDF2DOI_CONFIG_DIR"] = previous_pdf2doi_config
        else:
            os.environ.pop("PDF2DOI_CONFIG_DIR", None)

        shutil.rmtree(temp_home, ignore_errors=True)


# Keep only table-compatible blocks in canonical content JSON format.
def _normalize_block_extractor_result(data: dict[str, Any]) -> dict[str, Any]:
    formatted = format_as_content_json(dict(data))
    blocks = prepare_blocks_for_upgrade(json.loads(json.dumps(formatted.get("blocks", []))))
    blocks = prepare_blocks_for_block_extractor(blocks)

    table_blocks: list[dict[str, Any]] = []
    for block in blocks:
        if normalize_layout_label(str(block.get("type") or block.get("layout_type") or "")) != "Table":
            continue

        table_block = dict(block)
        table_block["type"] = "Table"
        if "caption" in table_block:
            table_block["caption"] = str(table_block.get("caption") or "")
        table_blocks.append(table_block)

    result = dict(formatted)
    result["blocks"] = table_blocks
    return result


# Execute pdf2data block_extractor CLI and parse the resulting content JSON.
def extract_with_block_extractor_cli(
    input_tmp: str,
    output_tmp: str,
    processor_alias: str,
    pdf2data_layout_model: str,
    pdf2data_table_model: str | None,
    run_cmd: Callable[..., Any] | None = None,
) -> dict[str, Any]:
    if run_cmd is None:
        run_cmd = subprocess.run

    pipeline_name = FRIENDLY_PROCESSOR_ALIASES[processor_alias]
    requested_layout = (pdf2data_layout_model or PDF2DATA_LAYOUT_AUTO).strip()
    if requested_layout == PDF2DATA_LAYOUT_AUTO:
        layout_model = "DocLayout-YOLO-DocStructBench"
    elif requested_layout in PDF2DATA_LAYOUT_MODELS:
        layout_model = requested_layout
    else:
        allowed_layouts = ", ".join(sorted(PDF2DATA_LAYOUT_MODELS | {PDF2DATA_LAYOUT_AUTO}))
        raise RuntimeError(f"Invalid pdf2data layout model: {requested_layout}. Use one of: {allowed_layouts}.")

    requested_table_model = (pdf2data_table_model or "").strip() or None
    if requested_table_model == "none":
        requested_table_model = None
    if requested_table_model not in {None, "microsoft/table-transformer-detection"}:
        raise RuntimeError(
            "Invalid pdf2data table model. Use 'none' or 'microsoft/table-transformer-detection'."
        )

    cli_args = [
        input_tmp,
        output_tmp,
        "--pipeline",
        pipeline_name,
        "--layout_model",
        layout_model,
        "--layout_model_threshold",
        "0.7",
        "--table_model_threshold",
        "0.5",
        "--struct_model",
        "microsoft/table-structure-recognition-v1.1-all",
        "--device",
        "cpu",
    ]
    if requested_table_model:
        cli_args.extend(["--table_model", requested_table_model])

    child_env = os.environ.copy()
    child_env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
    child_env.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
    child_env.setdefault("OMP_NUM_THREADS", "1")
    child_env.setdefault("CUDA_VISIBLE_DEVICES", "-1")
    
    # For frozen PyInstaller builds, provide temporary config directory for pdf2doi
    import tempfile
    temp_home = None
    if getattr(sys, "frozen", False):
        temp_home = tempfile.mkdtemp(prefix="pdfwf_home_")
        pdf2doi_config_dir = os.path.join(temp_home, "pdf2doi")
        os.makedirs(pdf2doi_config_dir, exist_ok=True)
        child_env["HOME"] = temp_home
        child_env["USERPROFILE"] = temp_home
        child_env["PDF2DOI_CONFIG_DIR"] = pdf2doi_config_dir

    try:
        if getattr(sys, "frozen", False):
            _run_pdf2data_direct(
                input_tmp=input_tmp,
                output_tmp=output_tmp,
                layout_model=layout_model,
                table_model=requested_table_model,
                layout_model_threshold="0.7",
                table_model_threshold="0.5",
            )
        else:
            cmd = [sys.executable, "-m", "pdf2data.cli.block_extractor", *cli_args]
            result = run_cmd(
                cmd,
                check=False,
                timeout=900,
                env=child_env,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                stderr_text = result.stderr or ""
                try:
                    find_first_content_json(output_tmp)
                    has_content = True
                except Exception:
                    has_content = False

                if has_content and "anystyle" in stderr_text.lower():
                    pass
                else:
                    raise RuntimeError("Block extractor execution failed via pdf2data CLI.")
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("Block extractor timed out during conversion.") from exc

    content_path = find_first_content_json(output_tmp)
    with open(content_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    if not isinstance(raw_blocks, list):
        raw_blocks = []

    base_payload = dict(parsed) if isinstance(parsed, dict) else {}
    base_payload["blocks"] = raw_blocks
    normalized = _normalize_block_extractor_result(base_payload)
    normalized["blocks"] = [block for block in normalized.get("blocks", []) if normalize_layout_label(str(block.get("type") or "")) == "Table"]
    return normalized


# Fast-path extractor that filters an existing JSON payload without running the PDF pipeline.
def run_block_extractor_from_json(data: dict[str, Any]) -> dict[str, Any]:
    return _normalize_block_extractor_result(dict(data))


# Run block extraction directly from PDF and enrich output with page metadata/assets.
def run_block_extractor_from_pdf(
    file_path: str,
    file_id: str,
    input_tmp: str,
    output_tmp: str,
    processor_alias: str,
    pdf2data_layout_model: str,
    pdf2data_table_model: str | None,
    require_modules_fn: Callable[[list[str], str], None] = require_modules,
    require_torchvision_runtime_fn: Callable[[], None] = require_torchvision_runtime,
    extract_with_block_extractor_cli_fn: Callable[..., dict[str, Any]] = extract_with_block_extractor_cli,
    read_native_content_envelope_fn: Callable[[str], dict[str, Any]] = read_native_content_envelope,
    persist_extracted_assets_fn: Callable[[str, str], int] = persist_extracted_assets,
) -> dict[str, Any]:
    pipeline_name = FRIENDLY_PROCESSOR_ALIASES[processor_alias]

    if pipeline_name == "NotDefined":
        require_modules_fn(["pdf2data", "paddleocr"], "Block Extractor")
        require_torchvision_runtime_fn()
    elif pipeline_name == "MinerU":
        require_modules_fn(["pdf2data", "mineru", "ultralytics", "accelerate", "ftfy", "dill", "omegaconf"], "Block Extractor")
    elif pipeline_name == "Docling":
        require_modules_fn(["pdf2data", "docling"], "Block Extractor")
    elif pipeline_name in {"PaddlePPStructure", "PaddleVL"}:
        raise RuntimeError("Processor temporarily disabled: paddleppstructure/paddlevl are not enabled in this build.")
    elif pipeline_name == "MinerUVL":
        raise RuntimeError("Processor temporarily disabled: mineruvl is not enabled in this build.")

    extractor_payload = extract_with_block_extractor_cli_fn(
        input_tmp=input_tmp,
        output_tmp=output_tmp,
        processor_alias=processor_alias,
        pdf2data_layout_model=pdf2data_layout_model,
        pdf2data_table_model=pdf2data_table_model,
    )

    blocks_data = extractor_payload.get("blocks", []) if isinstance(extractor_payload, dict) else []
    if not isinstance(blocks_data, list):
        blocks_data = []

    native_content = read_native_content_envelope_fn(output_tmp)
    copied_assets = persist_extracted_assets_fn(file_id=file_id, output_tmp=output_tmp)

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
        "processor": processor_alias,
        "processor_options": {
            "pdf2data_layout_model": pdf2data_layout_model,
            "pdf2data_table_model": pdf2data_table_model,
        },
        "metadata": native_content.get("metadata", {}),
        "references": native_content.get("references", []),
        "blocks": blocks_data,
        "pdf_size": pdf_size,
        "page_sizes": page_sizes,
        "assets_count": copied_assets,
    }


# Orchestrate endpoint behavior: optional JSON fast-path, otherwise PDF-first extraction.
def run_block_extractor_action(
    file: Any | None,
    processor: str = "pdf2data",
    pdf2data_layout_model: str = PDF2DATA_LAYOUT_AUTO,
    pdf2data_table_model: str = "none",
    use_existing_json: bool = False,
    existing_json: str = "",
    require_modules_fn: Callable[[list[str], str], None] = require_modules,
    require_torchvision_runtime_fn: Callable[[], None] = require_torchvision_runtime,
    extract_with_block_extractor_cli_fn: Callable[..., dict[str, Any]] = extract_with_block_extractor_cli,
    read_native_content_envelope_fn: Callable[[str], dict[str, Any]] = read_native_content_envelope,
    persist_extracted_assets_fn: Callable[[str, str], int] = persist_extracted_assets,
) -> dict[str, Any]:
    if use_existing_json and existing_json.strip():
        return run_block_extractor_from_json(json.loads(existing_json))

    if file is None:
        raise ValueError("Upload a PDF or provide an existing JSON artifact.")

    file_id = str(uuid.uuid4())
    processor_name = processor.strip().lower()
    if processor_name not in FRIENDLY_PROCESSOR_ALIASES:
        allowed = ", ".join(sorted(FRIENDLY_PROCESSOR_ALIASES.keys()))
        raise ValueError(f"Invalid processor. Use one of: {allowed}.")

    with tempfile.TemporaryDirectory(prefix="pdfwf_block_in_") as input_tmp, tempfile.TemporaryDirectory(
        prefix="pdfwf_block_out_"
    ) as output_tmp:
        filename = f"{file_id}.pdf"
        file_path = Path(input_tmp) / filename

        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        return run_block_extractor_from_pdf(
            file_path=str(file_path),
            file_id=file_id,
            input_tmp=input_tmp,
            output_tmp=output_tmp,
            processor_alias=processor_name,
            pdf2data_layout_model=pdf2data_layout_model,
            pdf2data_table_model=pdf2data_table_model,
            require_modules_fn=require_modules_fn,
            require_torchvision_runtime_fn=require_torchvision_runtime_fn,
            extract_with_block_extractor_cli_fn=extract_with_block_extractor_cli_fn,
            read_native_content_envelope_fn=read_native_content_envelope_fn,
            persist_extracted_assets_fn=persist_extracted_assets_fn,
        )
