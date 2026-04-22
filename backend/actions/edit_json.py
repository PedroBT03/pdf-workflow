from typing import Any

from pydantic import BaseModel
from pdf2data.edit import JsonBoxEditor


class EditTarget(BaseModel):
    kind: str
    block_index: int
    row: int | None = None
    col: int | None = None
    caption_index: int | None = None


class EditJsonPayload(BaseModel):
    data: dict
    target: EditTarget
    value: str


# Apply edit operations to JSON data using JsonBoxEditor for structured modifications.
def run_edit_json_action(payload: EditJsonPayload) -> dict[str, Any]:
    editor = JsonBoxEditor(data=payload.data)

    target_dict: dict[str, Any] = {
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
