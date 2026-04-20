import pytest


pytestmark = pytest.mark.integration


def test_text_finder_filters_only_matching_blocks(client):
    # Verifies text finder highlights only matching blocks while preserving all blocks.
    payload = {
        "data": {
            "metadata": {},
            "references": [],
            "blocks": [
                {"type": "paragraph", "content": "This wallet uses FIDO2 and WebAuthn.", "page": 1, "box": [0, 0, 10, 10]},
                {"type": "paragraph", "content": "Unrelated text.", "page": 1, "box": [10, 0, 20, 10]},
                {"type": "section_header", "content": "Architecture and Reference Framework", "page": 1, "box": [0, 10, 20, 20]},
            ],
        },
        "keywords": {
            "wallet": 2.5,
            "fido2": 2.5,
            "architecture": 1.5,
        },
        "word_count_threshold": 3.0,
        "find_paragraphs": True,
        "find_section_headers": True,
        "count_duplicates": False,
    }

    response = client.post("/api/actions/text-finder", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["blocks_before"] == 3
    assert body["summary"]["blocks_after"] == 1
    assert len(body["data"]["blocks"]) == 3
    highlighted = [block for block in body["data"]["blocks"] if block.get("text_finder_highlighted")]
    assert len(highlighted) == 1
    assert "FIDO2" in highlighted[0]["content"]
    assert highlighted[0]["text_finder_match_score"] > 0


def test_text_finder_returns_empty_block_list_when_no_match(client):
    # Verifies text finder returns non-highlighted blocks when no keyword matches exist.
    payload = {
        "data": {
            "metadata": {},
            "references": [],
            "blocks": [
                {"type": "paragraph", "content": "Completely unrelated content.", "page": 1, "box": [0, 0, 10, 10]},
            ],
        },
        "keywords": {
            "wallet": 3.0,
        },
        "word_count_threshold": 3.0,
        "find_paragraphs": True,
        "find_section_headers": False,
        "count_duplicates": False,
    }

    response = client.post("/api/actions/text-finder", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["blocks_before"] == 1
    assert body["summary"]["blocks_after"] == 0
    assert len(body["data"]["blocks"]) == 1
    assert body["data"]["blocks"][0]["text_finder_highlighted"] is False
    assert body["data"]["blocks"][0]["text_finder_match_score"] == 0
