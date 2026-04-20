import pytest
from fastapi.testclient import TestClient

from main import app


def pytest_addoption(parser):
    # Keep this hook here so future suite options can be added without touching test modules.
    parser.addoption("--run-ml", action="store_true", default=False, help="Run ML-dependent integration tests")


def pytest_configure(config):
    # Register custom pytest markers used by this test suite.
    config.addinivalue_line("markers", "unit: fast unit tests with no external runtime dependencies")
    config.addinivalue_line("markers", "integration: API/integration tests covering endpoint behavior")
    config.addinivalue_line("markers", "ml: marks tests that require ML runtime dependencies")


def pytest_collection_modifyitems(config, items):
    # Skip ML-marked tests unless the --run-ml flag is explicitly enabled.
    if config.getoption("--run-ml"):
        return

    skip_ml = pytest.mark.skip(reason="ML tests are skipped by default. Re-run with --run-ml.")
    for item in items:
        if "ml" in item.keywords:
            item.add_marker(skip_ml)


@pytest.fixture()
def client() -> TestClient:
    # Provide a shared FastAPI test client fixture for endpoint tests.
    return TestClient(app)
