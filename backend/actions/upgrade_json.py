import json
from typing import Any

from pydantic import BaseModel

from utils.utils import format_as_content_json, safe_int


class UpgradePayload(BaseModel):
    data: dict
    mode: str = "both"
    distance_threshold: float = 50.0


# Validate and normalize block structure before upgrade processing.
def prepare_blocks_for_upgrade(blocks: list[Any]) -> list[dict[str, Any]]:
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
        block["page"] = safe_int(raw.get("page", 1), 1)
        block["box"] = normalized_box

        # Ensure required fields exist based on block type
        block_type = block["type"]
        if block_type in ["paragraph", "section_header"]:
            block["content"] = str(raw.get("content") or "")
        elif block_type == "Table":
            block["caption"] = str(raw.get("caption") or "")
            # Ensure 'block' field exists (nested table rows/cells)
            if "block" not in block:
                block["block"] = raw.get("block", [])
        elif block_type == "Figure":
            block["caption"] = str(raw.get("caption") or "")
        else:
            block["content"] = str(raw.get("content") or "")

        prepared.append(block)

    return prepared


# Upgrade JSON by correcting text encoding and/or merging nearby figure blocks.
def run_upgrade_json_action(payload: UpgradePayload) -> dict[str, Any]:
    mode = str(payload.mode or "both").strip().lower()
    if mode not in {"text", "figures", "both"}:
        raise ValueError("Invalid upgrade mode. Use one of: text, figures, both.")

    from pdf2data.upgrade import Upgrader

    formatted = format_as_content_json(dict(payload.data))
    blocks = prepare_blocks_for_upgrade(json.loads(json.dumps(formatted.get("blocks", []))))

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
