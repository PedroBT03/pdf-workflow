import sys
import types

import pytest


pytestmark = pytest.mark.integration


def _fake_pdf_bytes() -> bytes:
    # Minimal bytes are enough for validation-path tests where extraction does not run.
    return b"%PDF-1.1\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def test_upload_rejects_invalid_processor(client, monkeypatch):
    # Verifies that /api/upload rejects unknown processor aliases with a 400 validation error.
    monkeypatch.setitem(sys.modules, "pdf2data", types.ModuleType("pdf2data"))

    response = client.post(
        "/api/upload",
        files={"file": ("sample.pdf", _fake_pdf_bytes(), "application/pdf")},
        data={"processor": "unknown-processor"},
    )

    assert response.status_code == 400
    payload = response.json()
    detail = str(payload.get("detail", ""))
    assert "Invalid processor" in detail
    assert "pdf2data" in detail
    assert "mineru" in detail
    assert "docling" in detail


def test_upload_returns_clear_error_for_disabled_processor(client, monkeypatch):
    # Verifies that selecting a known-but-disabled processor returns a clear runtime error message.
    monkeypatch.setitem(sys.modules, "pdf2data", types.ModuleType("pdf2data"))

    response = client.post(
        "/api/upload",
        files={"file": ("sample.pdf", _fake_pdf_bytes(), "application/pdf")},
        data={"processor": "paddlevl"},
    )

    assert response.status_code == 500
    payload = response.json()
    detail = str(payload.get("detail", ""))
    assert "temporarily disabled" in detail.lower()
