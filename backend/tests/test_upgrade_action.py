import pytest


pytestmark = pytest.mark.integration


def test_upgrade_json_text_mode_corrects_unicode(client):
    payload = {
        "mode": "text",
        "data": {
            "metadata": {},
            "references": [],
            "blocks": [
                {
                    "type": "paragraph",
                    "content": "of\ufb01ce",
                    "page": 1,
                    "box": [0, 0, 20, 10],
                }
            ],
        },
    }

    response = client.post("/api/actions/upgrade-json", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "text"
    assert body["data"]["blocks"][0]["content"] == "office"
    assert "caption" not in body["data"]["blocks"][0]


def test_upgrade_json_figures_mode_merges_adjacent_figures(client):
    payload = {
        "mode": "figures",
        "data": {
            "metadata": {},
            "references": [],
            "blocks": [
                {
                    "type": "Figure",
                    "content": "Figure",
                    "caption": "Figure A",
                    "filepath": "img_a.png",
                    "number": 1,
                    "footnotes": None,
                    "page": 1,
                    "box": [10, 10, 40, 40],
                },
                {
                    "type": "Figure",
                    "content": "Figure",
                    "caption": "",
                    "filepath": "img_b.png",
                    "number": 1,
                    "footnotes": None,
                    "page": 1,
                    "box": [42, 10, 80, 40],
                },
            ],
        },
    }

    response = client.post("/api/actions/upgrade-json", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["mode"] == "figures"
    assert body["summary"]["blocks_before"] == 2
    assert body["summary"]["blocks_after"] == 1

    merged = body["data"]["blocks"][0]
    assert merged["type"] == "Figure"
    assert merged["caption"] == "Figure A"
    assert isinstance(merged["filepath"], list)
    assert merged["filepath"] == ["img_a.png", "img_b.png"]
