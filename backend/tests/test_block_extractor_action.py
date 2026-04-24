import json

import pytest
import main
from actions import block_extractor as block_extractor_module

pytestmark = pytest.mark.integration


# Minimal bytes are enough for endpoint flow tests where extraction is stubbed.
def _fake_pdf_bytes() -> bytes:
    return b"%PDF-1.1\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


# Verifies that PDF upload path is preferred when fast-path is not enabled.
def test_block_extractor_prefers_pdf_pipeline(client, monkeypatch):
    captured: dict = {}

    def _stub_from_pdf(**kwargs):
        captured.update(kwargs)
        return {
            "id": "pdf-run",
            "processor": kwargs["processor_alias"],
            "processor_options": {
                "pdf2data_layout_model": kwargs["pdf2data_layout_model"],
                "pdf2data_table_model": kwargs["pdf2data_table_model"],
            },
            "metadata": {"title": "Example"},
            "references": [],
            "blocks": [
                {
                    "type": "Table",
                    "content": "Table",
                    "caption": "Wallet adoption by region",
                    "page": 1,
                    "box": [10, 10, 100, 80],
                    "block": [["Region", "Value"], ["EU", "42"]],
                }
            ],
            "pdf_size": {"width": 100, "height": 200},
            "page_sizes": [{"page": 1, "width": 100, "height": 200}],
            "assets_count": 0,
        }

    monkeypatch.setattr(block_extractor_module, "run_block_extractor_from_pdf", _stub_from_pdf)

    response = client.post(
        "/api/actions/block-extractor",
        files={"file": ("sample.pdf", _fake_pdf_bytes(), "application/pdf")},
        data={
            "processor": "pdf2data",
            "pdf2data_layout_model": "auto",
            "pdf2data_table_model": "none",
            "use_existing_json": "false",
        },
    )

    assert response.status_code == 200
    body = response.json()

    assert captured["processor_alias"] == "pdf2data"
    assert captured["pdf2data_layout_model"] == "auto"
    assert captured["pdf2data_table_model"] == "none"
    assert body["blocks"][0]["type"] == "Table"
    assert body["blocks"][0]["caption"] == "Wallet adoption by region"


# Verifies that fast-path consumes existing JSON when explicitly enabled.
def test_block_extractor_uses_existing_json_fast_path(client, monkeypatch):
    captured: dict = {}

    def _stub_from_json(data):
        captured["data"] = data
        return {
            "metadata": data.get("metadata", {}),
            "references": data.get("references", []),
            "blocks": [
                {
                    "type": "Table",
                    "content": "Table",
                    "caption": "Wallet adoption by region",
                    "page": 1,
                    "box": [10, 10, 100, 80],
                    "block": [["Region", "Value"], ["EU", "42"]],
                }
            ],
        }

    monkeypatch.setattr(block_extractor_module, "run_block_extractor_from_json", _stub_from_json)

    response = client.post(
        "/api/actions/block-extractor",
        data={
            "processor": "pdf2data",
            "pdf2data_layout_model": "auto",
            "pdf2data_table_model": "none",
            "use_existing_json": "true",
            "existing_json": json.dumps(
                {
                    "metadata": {"title": "Example"},
                    "references": [],
                    "blocks": [
                        {
                            "type": "paragraph",
                            "content": "Intro text",
                            "page": 1,
                            "box": [0, 0, 10, 10],
                        },
                        {
                            "type": "Table",
                            "content": "Table",
                            "caption": "Wallet adoption by region",
                            "page": 1,
                            "box": [10, 10, 100, 80],
                            "block": [["Region", "Value"], ["EU", "42"]],
                        },
                    ],
                }
            ),
        },
    )

    assert response.status_code == 200
    body = response.json()

    assert captured["data"]["metadata"]["title"] == "Example"
    assert len(body["blocks"]) == 1
    assert body["blocks"][0]["caption"] == "Wallet adoption by region"


# Verifies validation error when neither PDF input nor fast-path JSON are provided.
def test_block_extractor_requires_pdf_or_existing_json(client):
    response = client.post(
        "/api/actions/block-extractor",
        data={
            "processor": "pdf2data",
            "pdf2data_layout_model": "auto",
            "pdf2data_table_model": "none",
            "use_existing_json": "false",
        },
    )

    assert response.status_code == 400
    assert "Upload a PDF or provide an existing JSON artifact" in response.json()["detail"]
