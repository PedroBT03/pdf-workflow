import main
import pytest


pytestmark = pytest.mark.integration


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
