import json
import re
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel

from utils.utils import format_as_content_json, safe_int, write_json_file
from .upgrade_json import prepare_blocks_for_upgrade


class BlockFinderPayload(BaseModel):
    data: dict
    keywords: str
    find_tables: bool = True
    find_figures: bool = False


# Normalize raw keywords string into list by splitting on newlines and stripping whitespace.
def normalize_block_finder_keywords(raw_keywords: str) -> list[str]:
    return [line.strip() for line in str(raw_keywords or "").splitlines() if line.strip()]


# Build case-insensitive regex pattern from keywords list for block matching.
def build_block_finder_regex(keywords: list[str]) -> re.Pattern[str] | None:
    if not keywords:
        return None
    escaped = [re.escape(keyword) for keyword in keywords]
    escaped.sort(key=len, reverse=True)
    return re.compile(rf"\b(?:{'|'.join(escaped)})\b(?!-)", re.IGNORECASE | re.MULTILINE)


# Execute pdf2data block finder CLI to locate table/figure blocks by keywords.
def extract_with_block_finder_cli(
    input_tmp: str,
    output_tmp: str,
    keywords_file: str,
    find_tables: bool,
    find_figures: bool,
    run_cmd: Callable[..., Any] | None = None,
) -> list[dict[str, Any]]:
    if run_cmd is None:
        run_cmd = subprocess.run

    cli_args = [
        input_tmp,
        output_tmp,
        keywords_file,
        "--find_tables",
        "true" if find_tables else "false",
        "--find_figures",
        "true" if find_figures else "false",
    ]
    
    child_env = os.environ.copy()
    temp_home = None
    
    # For frozen PyInstaller builds, provide temporary config directory for pdf2doi
    if getattr(sys, "frozen", False):
        temp_home = tempfile.mkdtemp(prefix="pdfwf_home_")
        pdf2doi_config_dir = os.path.join(temp_home, "pdf2doi")
        os.makedirs(pdf2doi_config_dir, exist_ok=True)
        child_env["HOME"] = temp_home
        child_env["USERPROFILE"] = temp_home
        child_env["PDF2DOI_CONFIG_DIR"] = pdf2doi_config_dir

    try:
        if getattr(sys, "frozen", False):
            from pdf2data.keywords import BlockFinder

            finder = BlockFinder(keywords_file_path=keywords_file)
            blocks_path = Path(input_tmp) / "document" / "document_content.json"
            results = finder.find(str(blocks_path), tables=find_tables, figures=find_figures)
            matched = results.get("blocks", []) if isinstance(results, dict) else []
            return [block for block in matched if isinstance(block, dict)]

        cmd = [sys.executable, "-m", "pdf2data.cli.block_finder", *cli_args]
        result = run_cmd(cmd, check=False, capture_output=True, text=True, env=child_env)
        if result.returncode != 0:
            raise RuntimeError("Block Finder execution failed via pdf2data CLI.")
    finally:
        if temp_home and os.path.isdir(temp_home):
            try:
                import shutil

                shutil.rmtree(temp_home)
            except Exception:
                pass

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


# Extract searchable text from block: caption for figures, cell content for tables.
def block_finder_search_text(block: dict[str, Any]) -> str:
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


# Create unique tuple signature of block for matching and deduplication.
def block_signature(block: dict[str, Any]) -> tuple[Any, ...]:
    raw_box = block.get("box") if isinstance(block.get("box"), list) else []
    box = tuple(round(float(value), 5) for value in raw_box[:4]) if len(raw_box) == 4 else tuple()
    return (
        str(block.get("type") or ""),
        safe_int(block.get("page", 0), 0),
        box,
        str(block.get("content") or "").strip(),
        str(block.get("caption") or block.get("legend") or "").strip(),
    )


# Annotate blocks with match scores and highlighting based on block finder results.
def annotate_block_finder_blocks(
    blocks: list[dict[str, Any]],
    matched_blocks: list[dict[str, Any]],
    keyword_regex: re.Pattern[str] | None,
) -> tuple[list[dict[str, Any]], int]:
    matched_scores_by_signature: dict[tuple[Any, ...], list[int]] = {}

    for block in matched_blocks:
        text = block_finder_search_text(block)
        score = len(keyword_regex.findall(text)) if keyword_regex is not None and text else 1
        signature = block_signature(block)
        matched_scores_by_signature.setdefault(signature, []).append(max(int(score), 1))

    annotated: list[dict[str, Any]] = []
    highlighted_count = 0

    for block in blocks:
        signature = block_signature(block)
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


# Normalize document payload structure for block finder CLI input.
def prepare_payload_for_block_finder_cli(formatted_doc: dict[str, Any], blocks: list[dict[str, Any]]) -> dict[str, Any]:
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


# Orchestrate block finder action: prepare payload, run CLI, annotate blocks with results.
def run_block_finder_action(
    payload: BlockFinderPayload,
    extract_with_block_finder_cli_fn: Callable[..., list[dict[str, Any]]],
) -> dict[str, Any]:
    if not payload.find_tables and not payload.find_figures:
        raise ValueError("Enable at least one target type: tables or figures.")

    keywords_list = normalize_block_finder_keywords(payload.keywords)
    if not keywords_list:
        raise ValueError("Keywords file is empty or invalid.")

    keyword_regex = build_block_finder_regex(keywords_list)

    formatted = format_as_content_json(dict(payload.data))
    blocks = prepare_blocks_for_upgrade(json.loads(json.dumps(formatted.get("blocks", []))))

    with tempfile.TemporaryDirectory(prefix="pdfwf_blockfinder_in_") as input_tmp, tempfile.TemporaryDirectory(
        prefix="pdfwf_blockfinder_out_"
    ) as output_tmp, tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as keywords_tmp:
        try:
            doc_folder = Path(input_tmp) / "document"
            doc_folder.mkdir(parents=True, exist_ok=True)

            doc_payload = prepare_payload_for_block_finder_cli(formatted, blocks)
            write_json_file(doc_folder / "document_content.json", doc_payload)

            keywords_tmp.write("\n".join(keywords_list) + "\n")
            keywords_tmp.flush()

            matched_blocks = extract_with_block_finder_cli_fn(
                input_tmp=input_tmp,
                output_tmp=output_tmp,
                keywords_file=keywords_tmp.name,
                find_tables=bool(payload.find_tables),
                find_figures=bool(payload.find_figures),
            )
        finally:
            try:
                Path(keywords_tmp.name).unlink(missing_ok=True)
            except Exception:
                pass

    annotated_blocks, highlighted_count = annotate_block_finder_blocks(blocks, matched_blocks, keyword_regex)

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
                    "block_finder_match_score": max(len(keyword_regex.findall(block_finder_search_text(block))), 1)
                    if keyword_regex is not None
                    else 1,
                }
                for block in matched_blocks
            ],
            "total_matches": len(matched_blocks),
            "unique_matches": len({block_signature(block) for block in matched_blocks}),
            "settings": {
                "find_tables": bool(payload.find_tables),
                "find_figures": bool(payload.find_figures),
            },
        },
        "data": result,
    }
