import json
import os
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel

from utils.utils import format_as_content_json, write_json_file
from .upgrade_json import prepare_blocks_for_upgrade
from .block_finder import prepare_payload_for_block_finder_cli


class TextFinderPayload(BaseModel):
    data: dict
    keywords: dict[str, Any]
    word_count_threshold: float = 6.0
    find_paragraphs: bool = True
    find_section_headers: bool = True
    count_duplicates: bool = False


# Normalize raw keywords dict into normalized dict with aggregated weights.
def normalize_text_finder_keywords(raw_keywords: dict[str, Any]) -> dict[str, float]:
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


# Execute pdf2data text finder CLI to locate paragraphs and headers by keywords.
def extract_with_text_finder_cli(
    input_tmp: str,
    output_tmp: str,
    keywords_file: str,
    word_count_threshold: int,
    find_paragraphs: bool,
    find_section_headers: bool,
    count_duplicates: bool,
    run_cmd: Callable[..., Any] | None = None,
) -> list[str]:
    if run_cmd is None:
        run_cmd = subprocess.run

    cli_args = [
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
            from pdf2data.keywords import TextFinder

            finder = TextFinder(keywords_file_path=keywords_file)
            text_path = Path(input_tmp) / "document" / "document_content.json"
            results = finder.find(
                str(text_path),
                int(word_count_threshold),
                paragraph=find_paragraphs,
                section_header=find_section_headers,
                count_duplicates=count_duplicates,
            )
            return results.get("text", []) if isinstance(results, dict) else []

        cmd = [sys.executable, "-m", "pdf2data.cli.text_finder", *cli_args]
        result = run_cmd(cmd, check=False, capture_output=True, text=True, env=child_env)
        if result.returncode != 0:
            raise RuntimeError("Text Finder execution failed via pdf2data CLI.")
    finally:
        if temp_home and os.path.isdir(temp_home):
            try:
                import shutil

                shutil.rmtree(temp_home)
            except Exception:
                pass

    results_path = Path(output_tmp) / "found_texts.txt"
    if not results_path.exists():
        return []

    with open(results_path, "r", encoding="utf-8") as f:
        return [line.rstrip("\n") for line in f if line.strip()]


# Annotate blocks with text finder highlighting and match scores.
def annotate_text_finder_blocks(blocks: list[dict[str, Any]], matched_texts: list[str]) -> tuple[list[dict[str, Any]], int]:
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

        annotated.append(
            {
                **block,
                "text_finder_highlighted": is_highlighted,
                "text_finder_match_score": match_score if is_highlighted else 0,
            }
        )

    return annotated, highlighted_count


# Orchestrate text finder action: normalize keywords, run CLI, annotate matched blocks.
def run_text_finder_action(
    payload: TextFinderPayload,
    extract_with_text_finder_cli_fn: Callable[..., list[str]],
) -> dict[str, Any]:
    if not payload.find_paragraphs and not payload.find_section_headers:
        raise ValueError("Enable at least one target type: paragraphs or section headers.")

    keyword_weights = normalize_text_finder_keywords(dict(payload.keywords or {}))
    if not keyword_weights:
        raise ValueError("Keywords file is empty or invalid.")

    formatted = format_as_content_json(dict(payload.data))
    blocks = prepare_blocks_for_upgrade(json.loads(json.dumps(formatted.get("blocks", []))))
    threshold = int(float(payload.word_count_threshold))

    with tempfile.TemporaryDirectory(prefix="pdfwf_textfinder_in_") as input_tmp, tempfile.TemporaryDirectory(
        prefix="pdfwf_textfinder_out_"
    ) as output_tmp, tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8") as keywords_tmp:
        try:
            doc_folder = Path(input_tmp) / "document"
            doc_folder.mkdir(parents=True, exist_ok=True)

            doc_payload = prepare_payload_for_block_finder_cli(formatted, blocks)
            write_json_file(doc_folder / "document_content.json", doc_payload)

            write_json_file(Path(keywords_tmp.name), keyword_weights)
            keywords_tmp.flush()

            matched_texts = extract_with_text_finder_cli_fn(
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

    annotated_blocks, highlighted_count = annotate_text_finder_blocks(blocks, matched_texts)
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
