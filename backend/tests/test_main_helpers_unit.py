import pytest
import main
import json
from pathlib import Path

from utils.utils import normalize_layout_label, read_native_content_envelope, format_as_content_json


pytestmark = pytest.mark.unit


def test_normalize_layout_label_maps_known_aliases():
    # Verifies that known layout aliases are normalized to canonical labels used by the editor/export schema.
    assert normalize_layout_label("text") == "paragraph"
    assert normalize_layout_label("header") == "section_header"
    assert normalize_layout_label("table") == "Table"



def test_read_native_content_envelope_reads_metadata_and_references(tmp_path):
    # Verifies that metadata/references are preserved when native *_content.json is present.
    out = Path(tmp_path)
    data = {
        "metadata": {"title": ["Example"]},
        "blocks": [{"type": "paragraph", "content": "x", "page": 1, "box": [0, 0, 1, 1]}],
        "references": [{"citation-number": ["1"]}],
    }
    (out / "paper_content.json").write_text(json.dumps(data), encoding="utf-8")

    envelope = read_native_content_envelope(str(out))

    assert envelope["metadata"] == {"title": ["Example"]}
    assert envelope["references"] == [{"citation-number": ["1"]}]


def test_format_as_content_json_keeps_caption_optional():
    # Verifies canonical formatting preserves caption only when present in the block.
    payload = {
        "metadata": {},
        "references": [],
        "blocks": [
            {"type": "paragraph", "content": "hello", "page": 1, "box": [0, 0, 10, 10]},
            {"type": "Table", "content": "t", "page": 1, "box": [1, 1, 9, 9], "caption": "Table 1"},
        ],
    }

    formatted = format_as_content_json(payload)
    assert isinstance(formatted.get("blocks"), list)
    assert "caption" not in formatted["blocks"][0]
    assert formatted["blocks"][1]["caption"] == "Table 1"

