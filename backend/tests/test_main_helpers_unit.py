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

    # Captures the forwarded options passed by the pipeline router.
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


def test_extract_with_pipeline_routes_mineru_to_pdf2data_wrapper(monkeypatch):
    # Verifies MinerU uses the same wrapper path as pdf2data-tools before any fallback.
    monkeypatch.setattr(main, "_require_modules", lambda *_args, **_kwargs: None)

    captured: dict = {}

    # Captures wrapper call arguments so route selection can be asserted.
    def fake_mineru_wrapper(**kwargs):
        captured.update(kwargs)
        return [{"box": [0, 0, 10, 10], "type": "Table", "content": "ok", "page": 1, "block": [["a"]], "cell_boxes": [[[0, 0, 1, 1]]]}]

    monkeypatch.setattr(main, "_extract_with_mineru_pdf2data_cli", fake_mineru_wrapper)

    result = main._extract_with_pipeline_options(
        "/tmp/in",
        "/tmp/out",
        "mineru",
    )

    assert isinstance(result, list)
    assert captured["input_tmp"] == "/tmp/in"
    assert captured["output_tmp"] == "/tmp/out"


def test_mineru_pdf2data_wrapper_sets_explicit_extract_flags(monkeypatch, tmp_path):
    # Verifies wrapper command keeps MinerU table/figure extraction explicit.
    content_path = tmp_path / "paper_content.json"
    content_path.write_text(
        json.dumps(
            {
                "blocks": [
                    {
                        "box": [0, 0, 10, 10],
                        "type": "Table",
                        "content": "ok",
                        "page": 1,
                        "block": [["a"]],
                        "cell_boxes": [[[0, 0, 1, 1]]],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    captured_cmd: list[str] = []

    class DummyResult:
        # Mimics subprocess result object with a successful exit code.
        def __init__(self):
            self.returncode = 0
            self.stderr = ""

    # Intercepts subprocess execution and stores the built CLI command.
    def fake_run(cmd, **_kwargs):
        captured_cmd.extend(cmd)
        return DummyResult()

    monkeypatch.setattr(main.subprocess, "run", fake_run)
    monkeypatch.setattr(main, "find_first_content_json", lambda _out: str(content_path))

    result = main._extract_with_mineru_pdf2data_cli("/tmp/in", "/tmp/out")

    assert isinstance(result, list)
    assert "--pipeline" in captured_cmd
    assert "MinerU" in captured_cmd
    assert "--extract_tables" in captured_cmd
    assert "--extract_figures" in captured_cmd
    assert "--device" in captured_cmd


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

    formatted = main._format_as_content_json(payload)
    assert isinstance(formatted.get("blocks"), list)
    assert "caption" not in formatted["blocks"][0]
    assert formatted["blocks"][1]["caption"] == "Table 1"


def test_text_finder_cli_uses_pdf2data_module(monkeypatch, tmp_path):
    # Verifies the backend delegates Text Finder work to the upstream pdf2data CLI.
    output_tmp = tmp_path / "out"
    output_tmp.mkdir()
    (output_tmp / "found_texts.txt").write_text("Wallet\n", encoding="utf-8")

    captured: dict = {}

    # Captures the CLI command used by the text finder helper.
    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return type("R", (), {"returncode": 0})()

    monkeypatch.setattr(main.subprocess, "run", fake_run)

    result = main._extract_with_text_finder_cli(
        input_tmp=str(tmp_path / "in"),
        output_tmp=str(output_tmp),
        keywords_file=str(tmp_path / "keywords.json"),
        word_count_threshold=6,
        find_paragraphs=True,
        find_section_headers=False,
        count_duplicates=False,
    )

    assert result == ["Wallet"]
    assert captured["cmd"][2] == "pdf2data.cli.text_finder"
