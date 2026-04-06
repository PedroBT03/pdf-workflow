import pytest
import main
import json
from pathlib import Path

from main import _normalize_layout_label


pytestmark = pytest.mark.unit


def test_normalize_layout_label_maps_known_aliases():
    # Verifies that known layout aliases are normalized to canonical labels used by the editor/export schema.
    assert _normalize_layout_label("text") == "paragraph"
    assert _normalize_layout_label("header") == "section_header"
    assert _normalize_layout_label("table") == "Table"


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


def test_read_native_content_envelope_reads_metadata_and_references(tmp_path):
    # Verifies that metadata/references are preserved when native *_content.json is present.
    out = Path(tmp_path)
    data = {
        "metadata": {"title": ["Example"]},
        "blocks": [{"type": "paragraph", "content": "x", "page": 1, "box": [0, 0, 1, 1]}],
        "references": [{"citation-number": ["1"]}],
    }
    (out / "paper_content.json").write_text(json.dumps(data), encoding="utf-8")

    envelope = main._read_native_content_envelope(str(out))

    assert envelope["metadata"] == {"title": ["Example"]}
    assert envelope["references"] == [{"citation-number": ["1"]}]
