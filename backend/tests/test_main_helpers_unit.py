import pytest

from main import _build_columnar_fields, _normalize_layout_label


pytestmark = pytest.mark.unit


def test_normalize_layout_label_maps_known_aliases():
    # Verifies that known layout aliases are normalized to canonical labels used by the editor/export schema.
    assert _normalize_layout_label("text") == "paragraph"
    assert _normalize_layout_label("header") == "section_header"
    assert _normalize_layout_label("table") == "Table"


def test_build_columnar_fields_keeps_only_valid_blocks():
    # Verifies that the columnar projection keeps only blocks with valid 4-value coordinates and preserves aligned content/type rows.
    blocks = [
        {"content": "A", "type": "paragraph", "box": [1, 2, 3, 4]},
        {"content": "B", "type": "Figure", "box": [5, 6, 7]},
        {"content": "C", "type": "Table", "box": [10, 20, 30, 40]},
    ]

    columns = _build_columnar_fields(blocks)

    assert columns["Text"] == ["A", "C"]
    assert columns["Type"] == ["paragraph", "Table"]
    assert columns["Coordinates"] == [[1.0, 2.0, 3.0, 4.0], [10.0, 20.0, 30.0, 40.0]]
