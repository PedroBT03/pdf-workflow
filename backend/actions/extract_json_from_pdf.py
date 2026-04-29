import importlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

import fitz

from utils.utils import normalize_layout_label, safe_float, safe_int

PDF2DATA_LAYOUT_AUTO = "auto"
PDF2DATA_LAYOUT_MODELS = {
    "PP-DocLayout-L",
    "DocLayout-YOLO-DocStructBench",
}

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


# Validate that required modules are installed; raise error with helpful message if missing.
def require_modules(module_names: list[str], pipeline_name: str) -> None:
    missing: list[str] = []
    for name in module_names:
        try:
            importlib.import_module(name)
        except Exception:
            missing.append(name)
    if missing:
        raise RuntimeError(
            f"Missing dependency for {pipeline_name}: {', '.join(missing)}. Install requirements-ml.txt."
        )


# Validate torch/torchvision availability and binary compatibility (NMS operation).
def require_torchvision_runtime() -> None:
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


def _run_pdf2data_direct(
    input_tmp: str,
    output_tmp: str,
    layout_models: list[str],
    table_model: str | None,
    layout_model_threshold: str,
    table_model_threshold: str,
) -> None:
    """Execute pdf2data directly using the Python API to bypass CLI subprocess issues in frozen builds."""
    import os
    import tempfile
    
    # Set up temporary home for pdf2doi
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
        
        for layout_model in layout_models:
            pdf2data_pipeline = PDF2Data(
                layout_model=layout_model,
                layout_model_threshold=float(layout_model_threshold),
                table_model=table_model,
                table_model_threshold=float(table_model_threshold),
                device="cpu",
                input_folder=input_tmp,
                output_folder=output_tmp,
                extract_references=True,
            )
            pdf2data_pipeline.pdf_transform()
            break  # Success on first model
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
        
        if os.path.isdir(temp_home):
            try:
                shutil.rmtree(temp_home)
            except Exception:
                pass


def _docling_item_to_block(item: dict, default_type: str) -> dict | None:
    if not isinstance(item, dict):
        return None

    prov = item.get("prov") or []
    if not isinstance(prov, list) or not prov:
        return None

    first_prov = prov[0]
    if not isinstance(first_prov, dict):
        return None

    bbox = first_prov.get("bbox")
    if not isinstance(bbox, dict):
        return None

    try:
        box = [
            float(bbox.get("l", 0.0)),
            float(bbox.get("t", 0.0)),
            float(bbox.get("r", 0.0)),
            float(bbox.get("b", 0.0)),
        ]
    except Exception:
        return None

    page_no = first_prov.get("page_no", 1)
    content = (
        item.get("text")
        or item.get("orig")
        or item.get("caption")
        or item.get("content")
        or item.get("name")
        or item.get("label")
        or default_type
    )
    block_type = str(item.get("label") or item.get("type") or default_type or "text")

    return {
        "page": safe_int(page_no, 1),
        "box": box,
        "originalBox": box,
        "content": str(content or ""),
        "type": normalize_layout_label(block_type),
        "layout_type": block_type,
        "font_size": 11.0,
        "color": (0, 0, 0),
        "source": "docling",
    }


def _run_docling_direct(input_tmp: str, output_tmp: str) -> list[dict]:
    """Execute Docling directly using the Python API to avoid frozen subprocess issues."""
    import tempfile
    from pathlib import Path

    # Find the PDF file in input_tmp directory
    input_path = Path(input_tmp)
    pdf_files = list(input_path.glob("*.pdf"))
    
    if not pdf_files:
        raise RuntimeError(f"No PDF files found in input directory: {input_tmp}")
    
    pdf_file_path = str(pdf_files[0])  # Use first PDF found

    temp_home = tempfile.mkdtemp(prefix="pdfwf_home_")
    pdf2doi_config_dir = os.path.join(temp_home, "pdf2doi")
    os.makedirs(pdf2doi_config_dir, exist_ok=True)

    previous_home = os.environ.get("HOME")
    previous_userprofile = os.environ.get("USERPROFILE")
    previous_pdf2doi_config = os.environ.get("PDF2DOI_CONFIG_DIR")
    previous_cuda_visible_devices = os.environ.get("CUDA_VISIBLE_DEVICES")
    previous_omp_num_threads = os.environ.get("OMP_NUM_THREADS")
    previous_tf_enable_onednn = os.environ.get("TF_ENABLE_ONEDNN_OPTS")

    try:
        os.environ["HOME"] = temp_home
        os.environ["USERPROFILE"] = temp_home
        os.environ["PDF2DOI_CONFIG_DIR"] = pdf2doi_config_dir
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
        os.environ["OMP_NUM_THREADS"] = "1"
        os.environ["TF_ENABLE_ONEDNN_OPTS"] = "0"

        # Monkey patch importlib.metadata.version to handle missing metadata in PyInstaller executables
        import importlib.metadata as metadata_module
        _original_version = metadata_module.version
        
        def _patched_version(package_name):
            try:
                return _original_version(package_name)
            except metadata_module.PackageNotFoundError:
                # Return dummy version for packages with missing metadata (common in PyInstaller)
                return "0.0.0"
        
        metadata_module.version = _patched_version

        from docling.document_converter import DocumentConverter

        converter = DocumentConverter()
        result = converter.convert(pdf_file_path)
        document = result.document
        doc_data = document.export_to_dict()

        raw_blocks: list[dict] = []
        for section_name, default_type in (
            ("texts", "text"),
            ("tables", "table"),
            ("pictures", "picture"),
            ("key_value_items", "key_value"),
            ("form_items", "form"),
        ):
            section_items = doc_data.get(section_name, []) if isinstance(doc_data, dict) else []
            if not isinstance(section_items, list):
                continue
            for item in section_items:
                block = _docling_item_to_block(item, default_type)
                if block is not None:
                    raw_blocks.append(block)

        if not raw_blocks:
            raise RuntimeError("Docling did not produce any extractable blocks.")

        return normalize_raw_blocks(raw_blocks, source="docling")
    finally:
        if previous_home is not None:
            os.environ["HOME"] = previous_home
        else:
            os.environ.pop("HOME", None)

        if previous_userprofile is not None:
            os.environ["USERPROFILE"] = previous_userprofile
        else:
            os.environ.pop("USERPROFILE", None)

        if previous_pdf2doi_config is not None:
            os.environ["PDF2DOI_CONFIG_DIR"] = previous_pdf2doi_config
        else:
            os.environ.pop("PDF2DOI_CONFIG_DIR", None)

        if previous_cuda_visible_devices is not None:
            os.environ["CUDA_VISIBLE_DEVICES"] = previous_cuda_visible_devices
        else:
            os.environ.pop("CUDA_VISIBLE_DEVICES", None)

        if previous_omp_num_threads is not None:
            os.environ["OMP_NUM_THREADS"] = previous_omp_num_threads
        else:
            os.environ.pop("OMP_NUM_THREADS", None)

        if previous_tf_enable_onednn is not None:
            os.environ["TF_ENABLE_ONEDNN_OPTS"] = previous_tf_enable_onednn
        else:
            os.environ.pop("TF_ENABLE_ONEDNN_OPTS", None)

        if os.path.isdir(temp_home):
            try:
                shutil.rmtree(temp_home)
            except Exception:
                pass


# Normalize extracted blocks with standardized types, boxes, content, and metadata.
def normalize_raw_blocks(raw_blocks: list[dict], source: str) -> list[dict]:
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


# Execute MinerU CLI to extract content blocks from PDF and normalize the output.
def extract_with_mineru_cli(
    input_tmp: str,
    output_tmp: str,
    find_first_content_json: Callable[[str], str],
) -> list[dict]:
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
            return normalize_raw_blocks(raw_blocks, source="mineru")
    except Exception:
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

    return normalize_raw_blocks(normalized, source="mineru")


# Execute pdf2data CLI with layout models to extract content blocks from PDF.
def extract_with_pdf2data_cli(
    input_tmp: str,
    output_tmp: str,
    find_first_content_json: Callable[[str], str],
    layout_models: list[str] | None = None,
    table_model: str | None = None,
    layout_model_threshold: str = "0.7",
    table_model_threshold: str = "0.5",
) -> list[dict]:
    import tempfile
    
    if layout_models is None:
        layout_models = ["PP-DocLayout-L", "DocLayout-YOLO-DocStructBench"]
    last_error: Exception | None = None

    for layout_model in layout_models:
        try:
            if getattr(sys, "frozen", False):
                # In frozen mode, use direct Python API instead of subprocess
                _run_pdf2data_direct(
                    input_tmp=input_tmp,
                    output_tmp=output_tmp,
                    layout_models=[layout_model],
                    table_model=table_model,
                    layout_model_threshold=layout_model_threshold,
                    table_model_threshold=table_model_threshold,
                )
            else:
                # In development, use subprocess with sys.executable (pointing to venv python)
                cli_args = [
                    input_tmp,
                    output_tmp,
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
                    cli_args.extend(["--table_model", table_model])

                child_env = os.environ.copy()
                child_env.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
                child_env.setdefault("TF_ENABLE_ONEDNN_OPTS", "0")
                child_env.setdefault("OMP_NUM_THREADS", "1")
                child_env.setdefault("CUDA_VISIBLE_DEVICES", "-1")
                
                cmd = [sys.executable, "-m", "pdf2data.cli.pdf2data", *cli_args]
                result = subprocess.run(
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
        except Exception as exc:
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
            f"PDF2Data execution failed: {str(last_error)}"
        ) from last_error

    content_path = find_first_content_json(output_tmp)
    with open(content_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    if not isinstance(raw_blocks, list):
        raw_blocks = []

    return normalize_raw_blocks(raw_blocks, source="pdf2data")


# Execute Docling CLI to extract content blocks from PDF.
def extract_with_docling_cli(
    input_tmp: str,
    output_tmp: str,
    find_first_content_json: Callable[[str], str],
) -> list[dict]:
    try:
        return _run_docling_direct(input_tmp=input_tmp, output_tmp=output_tmp)
    except Exception as exc:
        raise RuntimeError("Docling execution failed in-process.") from exc


# Execute MinerU via pdf2data CLI wrapper to extract content blocks from PDF.
def extract_with_mineru_pdf2data_cli(
    input_tmp: str,
    output_tmp: str,
    find_first_content_json: Callable[[str], str],
    run_cmd: Callable[..., Any] | None = None,
) -> list[dict]:
    import tempfile
    
    if run_cmd is None:
        run_cmd = subprocess.run

    cli_args = [
        input_tmp,
        output_tmp,
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
    
    # For frozen PyInstaller builds, provide temporary config directory for pdf2doi
    temp_home = None
    if getattr(sys, "frozen", False):
        temp_home = tempfile.mkdtemp(prefix="pdfwf_home_")
        pdf2doi_config_dir = os.path.join(temp_home, "pdf2doi")
        os.makedirs(pdf2doi_config_dir, exist_ok=True)
        child_env["HOME"] = temp_home
        child_env["USERPROFILE"] = temp_home
        child_env["PDF2DOI_CONFIG_DIR"] = pdf2doi_config_dir

    try:
        cmd = [sys.executable, "-m", "pdf2data.cli.pdf2data", *cli_args]
        result = run_cmd(
            cmd,
            check=False,
            timeout=900,
            env=child_env,
            capture_output=True,
            text=True,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("MinerU timed out during conversion.") from exc
    finally:
        if temp_home and os.path.isdir(temp_home):
            try:
                shutil.rmtree(temp_home)
            except Exception:
                pass

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
            raise RuntimeError("MinerU execution failed via pdf2data CLI.")

    content_path = find_first_content_json(output_tmp)
    with open(content_path, "r", encoding="utf-8") as f:
        parsed = json.load(f)

    raw_blocks = parsed.get("blocks", []) if isinstance(parsed, dict) else []
    if not isinstance(raw_blocks, list):
        raw_blocks = []

    return normalize_raw_blocks(raw_blocks, source="mineru")


# Route extraction to appropriate function based on processor type; validate dependencies.
def extract_with_pipeline_options(
    input_tmp: str,
    output_tmp: str,
    processor_alias: str,
    pdf2data_layout_model: str,
    pdf2data_table_model: str | None,
    require_modules_fn: Callable[[list[str], str], None],
    require_torchvision_runtime_fn: Callable[[], None],
    extract_with_pdf2data_cli_fn: Callable[..., list[dict]],
    extract_with_mineru_pdf2data_cli_fn: Callable[..., list[dict]],
    extract_with_mineru_cli_fn: Callable[..., list[dict]],
    extract_with_docling_cli_fn: Callable[..., list[dict]],
) -> list[dict]:
    pipeline_name = FRIENDLY_PROCESSOR_ALIASES[processor_alias]

    if pipeline_name == "NotDefined":
        require_modules_fn(["pdf2data", "paddleocr"], "PDF2Data")
        require_torchvision_runtime_fn()
        requested_layout = (pdf2data_layout_model or PDF2DATA_LAYOUT_AUTO).strip()
        if requested_layout == PDF2DATA_LAYOUT_AUTO:
            layout_models = ["PP-DocLayout-L", "DocLayout-YOLO-DocStructBench"]
        else:
            if requested_layout not in PDF2DATA_LAYOUT_MODELS:
                allowed_layouts = ", ".join(sorted(PDF2DATA_LAYOUT_MODELS | {PDF2DATA_LAYOUT_AUTO}))
                raise RuntimeError(
                    f"Invalid pdf2data layout model: {requested_layout}. Use one of: {allowed_layouts}."
                )
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

        return extract_with_pdf2data_cli_fn(
            input_tmp=input_tmp,
            output_tmp=output_tmp,
            layout_models=layout_models,
            table_model=requested_table_model,
            layout_model_threshold="0.7",
            table_model_threshold="0.5",
        )
    if pipeline_name == "MinerU":
        require_modules_fn(["pdf2data", "mineru", "ultralytics", "accelerate", "ftfy", "dill", "omegaconf"], "MinerU")
        try:
            return extract_with_mineru_pdf2data_cli_fn(input_tmp=input_tmp, output_tmp=output_tmp)
        except Exception:
            return extract_with_mineru_cli_fn(input_tmp=input_tmp, output_tmp=output_tmp)
    if pipeline_name == "Docling":
        require_modules_fn(["pdf2data", "docling"], "Docling")
        return extract_with_docling_cli_fn(input_tmp=input_tmp, output_tmp=output_tmp)
    if pipeline_name in {"PaddlePPStructure", "PaddleVL"}:
        raise RuntimeError(
            "Processor temporarily disabled: paddleppstructure/paddlevl are not enabled in this build."
        )
    if pipeline_name == "MinerUVL":
        raise RuntimeError(
            "Processor temporarily disabled: mineruvl is not enabled in this build."
        )

    raise RuntimeError(f"Unsupported pipeline: {pipeline_name}")


# Build JSON payload listing available processors and their enabled status.
def build_processors_payload() -> dict[str, Any]:
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


def run_upload_and_process(
    file_path: str,
    file_id: str,
    input_tmp: str,
    output_tmp: str,
    processor_alias: str,
    pdf2data_layout_model: str,
    pdf2data_table_model: str | None,
    require_modules_fn: Callable[[list[str], str], None],
    require_torchvision_runtime_fn: Callable[[], None],
    extract_with_pdf2data_cli_fn: Callable[..., list[dict]],
    extract_with_mineru_pdf2data_cli_fn: Callable[..., list[dict]],
    extract_with_mineru_cli_fn: Callable[..., list[dict]],
    extract_with_docling_cli_fn: Callable[..., list[dict]],
    read_native_content_envelope_fn: Callable[[str], dict[str, Any]],
    persist_extracted_assets_fn: Callable[[str, str], int],
) -> dict[str, Any]:
    """
    Orchestrate the complete PDF upload and extraction process.
    
    Extracts blocks, reads metadata, persists assets, and enriches blocks with PDF page data.
    """
    # Extract blocks using selected processor
    blocks_data = extract_with_pipeline_options(
        input_tmp=input_tmp,
        output_tmp=output_tmp,
        processor_alias=processor_alias,
        pdf2data_layout_model=pdf2data_layout_model,
        pdf2data_table_model=pdf2data_table_model,
        require_modules_fn=require_modules_fn,
        require_torchvision_runtime_fn=require_torchvision_runtime_fn,
        extract_with_pdf2data_cli_fn=extract_with_pdf2data_cli_fn,
        extract_with_mineru_pdf2data_cli_fn=extract_with_mineru_pdf2data_cli_fn,
        extract_with_mineru_cli_fn=extract_with_mineru_cli_fn,
        extract_with_docling_cli_fn=extract_with_docling_cli_fn,
    )

    # Read native content metadata
    native_content = read_native_content_envelope_fn(output_tmp)
    
    # Persist extracted assets (images, tables, etc.)
    copied_assets = persist_extracted_assets_fn(file_id=file_id, output_tmp=output_tmp)

    # Extract page sizes and PDF metadata
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

    # Backfill missing text content from PDF for any empty text-like block
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
        "metadata": native_content["metadata"],
        "references": native_content["references"],
        "blocks": blocks_data,
        "pdf_size": pdf_size,
        "page_sizes": page_sizes,
        "assets_count": copied_assets,
    }
