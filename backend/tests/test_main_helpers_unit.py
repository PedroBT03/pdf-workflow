import pytest
import main

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


def test_extract_with_pipeline_routes_pdf2data_options(monkeypatch):
    # Verifies that pdf2data layout/table options are forwarded into the CLI runner.
    monkeypatch.setattr(main, "_require_modules", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(main, "_require_torchvision_runtime", lambda *_args, **_kwargs: None)

    captured: dict = {}

    def fake_pdf2data_runner(**kwargs):
        captured.update(kwargs)
        return [{"box": [0, 0, 10, 10], "type": "paragraph", "content": "ok", "page": 1}]

    monkeypatch.setattr(main, "_extract_with_pdf2data_cli", fake_pdf2data_runner)

    result = main._extract_with_pipeline_options(
        "/tmp/in",
        "/tmp/out",
        "pdf2data",
        pdf2data_layout_model="PP-DocLayout-L",
        pdf2data_table_model="microsoft/table-transformer-detection",
    )

    assert isinstance(result, list)
    assert captured["layout_models"] == ["PP-DocLayout-L"]
    assert captured["table_model"] == "microsoft/table-transformer-detection"
