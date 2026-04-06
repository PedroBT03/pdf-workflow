import json
from pathlib import Path

import main
import pytest


pytestmark = pytest.mark.integration


def test_save_edited_json_creates_document_structure_with_canonical_schema(client, tmp_path):
    # Verifies that /api/save-edited-json stores content.json in canonical shape: metadata, blocks, references.
    payload = {
        "output_folder": str(tmp_path),
        "document_name": "paper-01",
        "data": {
            "metadata": {
                "title": ["Example title"],
                "doi": ["10.0000/example"],
            },
            "blocks": [
                {
                    "content": "First paragraph",
                    "type": "paragraph",
                    "box": [10, 20, 200, 60],
                },
                {
                    "content": "Figure caption",
                    "type": "Figure",
                    "box": [30, 80, 300, 140],
                    "filepath": "paper-01_images/Figure_1.png",
                },
            ],
            "references": [{"citation-number": ["1"]}],
        },
    }

    response = client.post("/api/save-edited-json", json=payload)

    assert response.status_code == 200
    body = response.json()

    saved_path = Path(body["saved_path"])
    saved_folder = Path(body["saved_folder"])
    images_folder = Path(body["images_folder"])

    assert saved_path.exists()
    assert saved_folder.exists()
    assert images_folder.exists()
    assert saved_path.name == "paper-01_content.json"

    saved_json = json.loads(saved_path.read_text(encoding="utf-8"))
    assert set(saved_json.keys()) == {"metadata", "blocks", "references"}
    assert saved_json["metadata"]["title"] == ["Example title"]
    assert saved_json["references"] == [{"citation-number": ["1"]}]
    assert len(saved_json["blocks"]) == 2
    assert saved_json["blocks"][0] == {
        "type": "paragraph",
        "content": "First paragraph",
        "page": 1,
        "box": [10.0, 20.0, 200.0, 60.0],
    }
    assert saved_json["blocks"][1]["filepath"] == "paper-01_images/Figure_1.png"


def test_assets_manifest_lists_only_image_files(client, tmp_path, monkeypatch):
    # Verifies that /api/assets-manifest returns only image assets and ignores non-image files from cache.
    monkeypatch.setattr(main, "ASSET_CACHE_ROOT", tmp_path)

    doc_id = "doc-123"
    root = tmp_path / doc_id
    (root / "native_images").mkdir(parents=True, exist_ok=True)
    (root / "native_images" / "page-1.png").write_bytes(b"png")
    (root / "native_images" / "page-2.jpg").write_bytes(b"jpg")
    (root / "native_images" / "debug.txt").write_text("ignore me", encoding="utf-8")

    response = client.get(f"/api/assets-manifest/{doc_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["doc_id"] == doc_id
    assert payload["assets"] == [
        "native_images/page-1.png",
        "native_images/page-2.jpg",
    ]


def test_assets_endpoint_prevents_path_traversal(client, tmp_path, monkeypatch):
    # Verifies that /api/assets blocks traversal paths and does not allow escaping the per-document cache folder.
    monkeypatch.setattr(main, "ASSET_CACHE_ROOT", tmp_path)

    doc_id = "safe-doc"
    root = tmp_path / doc_id
    root.mkdir(parents=True, exist_ok=True)
    (root / "inside.png").write_bytes(b"ok")

    outside = tmp_path / "outside.png"
    outside.write_bytes(b"outside")

    ok_response = client.get(f"/api/assets/{doc_id}/inside.png")
    assert ok_response.status_code == 200

    bad_response = client.get(f"/api/assets/{doc_id}/%2E%2E/outside.png")
    assert bad_response.status_code == 400
    assert "Invalid asset path" in str(bad_response.json().get("detail", ""))
