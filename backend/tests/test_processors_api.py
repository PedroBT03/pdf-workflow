import pytest


pytestmark = pytest.mark.integration


def test_processors_catalog_endpoint_shape(client):
    # Verifies that the processors catalog endpoint is reachable and returns the expected top-level payload shape.
    response = client.get("/api/processors")

    assert response.status_code == 200
    payload = response.json()

    assert isinstance(payload.get("default_processor"), str)
    assert isinstance(payload.get("processors"), list)
    assert payload["processors"]


def test_processors_catalog_expected_aliases_and_states(client):
    # Verifies that all known processor aliases are exposed and that enabled/disabled states match current build policy.
    response = client.get("/api/processors")
    payload = response.json()

    by_alias = {item["alias"]: item for item in payload["processors"]}

    expected_aliases = {
        "pdf2data",
        "mineru",
        "docling",
        "paddleppstructure",
        "paddlevl",
        "mineruvl",
    }
    assert set(by_alias.keys()) == expected_aliases

    assert by_alias["pdf2data"]["enabled"] is True
    assert by_alias["mineru"]["enabled"] is True
    assert by_alias["docling"]["enabled"] is True

    assert by_alias["paddleppstructure"]["enabled"] is False
    assert by_alias["paddlevl"]["enabled"] is False
    assert by_alias["mineruvl"]["enabled"] is False

    assert isinstance(by_alias["paddleppstructure"].get("reason"), str)
    assert isinstance(by_alias["paddlevl"].get("reason"), str)
    assert isinstance(by_alias["mineruvl"].get("reason"), str)
