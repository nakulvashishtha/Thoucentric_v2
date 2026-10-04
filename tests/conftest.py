import os
import tempfile

os.environ.setdefault("FIXTURE_DELAY", "0")
os.environ["MODE"] = "fixtures"
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="rw-test-")
for k in ("ANTHROPIC_API_KEY", "TAVILY_API_KEY", "ADMIN_PASSCODE"):
    os.environ.pop(k, None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from backend.app.main import app
    with TestClient(app) as c:
        yield c
