import pytest
import main
import json
from pathlib import Path


pytestmark = pytest.mark.integration


@pytest.fixture()
def block_finder_stub(monkeypatch):
    # Stub block finder results by mocking extract_with_block_finder_cli in main module.
    def _stub(input_tmp, output_tmp, keywords_file, find_tables, find_figures, run_cmd=None):
        if find_tables and not find_figures:
            return [
                {
                    "type": "Table",
                    "content": "Table",
                    "caption": "Wallet adoption by region",
                    "page": 1,
                    "box": [10, 10, 100, 80],
                    "block": [["Region", "Value"], ["EU", "42"]],
                }
            ]
        return []

    monkeypatch.setattr(main, "extract_with_block_finder_cli", _stub)


def test_block_finder_highlights_table_matches(client, block_finder_stub):
    payload = {
        "data": {
            "metadata": {},
            "references": [],
            "blocks": [
                {
                    "type": "Table",
                    "content": "Table",
                    "caption": "Wallet adoption by region",
                    "page": 1,
                    "box": [10, 10, 100, 80],
                    "block": [["Region", "Value"], ["EU", "42"]],
                },
                {
                    "type": "Figure",
                    "content": "Figure",
                    "legend": "Architecture overview",
                    "page": 1,
                    "box": [120, 10, 220, 90],
                },
            ],
        },
        "keywords": "wallet\nregion\n",
        "find_tables": True,
        "find_figures": False,
    }

    response = client.post("/api/actions/block-finder", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["blocks_before"] == 2
    assert body["summary"]["blocks_after"] == 1
    assert body["summary"]["highlighted_count"] == 1
    assert body["summary"]["keywords_count"] == 2
    assert body["summary"]["find_tables"] is True
    assert body["summary"]["find_figures"] is False

    blocks = body["data"]["blocks"]
    assert len(blocks) == 2
    assert blocks[0]["block_finder_highlighted"] is True
    assert blocks[0]["block_finder_match_score"] >= 1
    assert blocks[1]["block_finder_highlighted"] is False
    assert blocks[1]["block_finder_match_score"] == 0

    artifact = body["found_blocks_artifact"]
    assert artifact["total_matches"] == 1
    assert artifact["unique_matches"] == 1
    assert isinstance(artifact["blocks"], list)
    assert len(artifact["blocks"]) == 1


def test_block_finder_returns_no_highlights_when_no_matches(client, block_finder_stub):
    payload = {
        "data": {
            "metadata": {},
            "references": [],
            "blocks": [
                {
                    "type": "Table",
                    "content": "Table",
                    "caption": "Completely unrelated caption",
                    "page": 1,
                    "box": [10, 10, 100, 80],
                    "block": [["A", "B"]],
                }
            ],
        },
        "keywords": "wallet\n",
        "find_tables": False,
        "find_figures": True,
    }

    response = client.post("/api/actions/block-finder", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["blocks_before"] == 1
    assert body["summary"]["blocks_after"] == 0
    assert body["summary"]["highlighted_count"] == 0

    blocks = body["data"]["blocks"]
    assert len(blocks) == 1
    assert blocks[0]["block_finder_highlighted"] is False
    assert blocks[0]["block_finder_match_score"] == 0

    artifact = body["found_blocks_artifact"]
    assert artifact["total_matches"] == 0
    assert artifact["unique_matches"] == 0
    assert artifact["blocks"] == []


def test_block_finder_requires_txt_keywords_content(client):
    payload = {
        "data": {"metadata": {}, "references": [], "blocks": []},
        "keywords": "   \n  \n",
        "find_tables": True,
        "find_figures": False,
    }

    response = client.post("/api/actions/block-finder", json=payload)

    assert response.status_code == 400
    assert "Keywords file is empty or invalid" in response.json()["detail"]


def test_block_finder_requires_target_types(client):
    payload = {
        "data": {"metadata": {}, "references": [], "blocks": []},
        "keywords": "wallet\n",
        "find_tables": False,
        "find_figures": False,
    }

    response = client.post("/api/actions/block-finder", json=payload)

    assert response.status_code == 400
    assert "Enable at least one target type" in response.json()["detail"]


def test_block_finder_normalizes_missing_doi_before_cli(client, monkeypatch):
    captured: dict = {}

    # Capture the temporary content file fed to upstream CLI by mocking extract_with_block_finder_cli in main module.
    def _capture_stub(input_tmp, output_tmp, keywords_file, find_tables, find_figures, run_cmd=None):
        content_path = Path(input_tmp) / "document" / "document_content.json"
        with open(content_path, "r", encoding="utf-8") as f:
            captured["payload"] = json.load(f)
        return []

    monkeypatch.setattr(main, "extract_with_block_finder_cli", _capture_stub)

    response = client.post(
        "/api/actions/block-finder",
        json={
            "data": {
                "metadata": {},
                "references": [],
                "blocks": [
                    {
                        "type": "Figure",
                        "content": "Figure",
                        "legend": "wallet architecture",
                        "page": 1,
                        "box": [1, 1, 2, 2],
                    }
                ],
            },
            "keywords": "wallet\n",
            "find_tables": False,
            "find_figures": True,
        },
    )

    assert response.status_code == 200
    assert captured["payload"]["metadata"]["doi"] == "unknown-doi"
    assert "caption" in captured["payload"]["blocks"][0]
    assert str(captured["payload"]["blocks"][0]["caption"]).strip() != ""
