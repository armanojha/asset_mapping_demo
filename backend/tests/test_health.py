import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.config import settings


@pytest.mark.asyncio
async def test_application_initialization():
    """Verify application object initializes correctly with configured metadata."""
    assert app.title == settings.PROJECT_NAME
    assert app.version == settings.VERSION


@pytest.mark.asyncio
async def test_health_endpoint():
    """
    Test GET /api/v1/health:
    1. Returns HTTP 200 OK.
    2. Contains expected fields: status, application, version.
    3. Values match expected configuration.
    """
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/health")

    assert response.status_code == 200
    data = response.json()

    # Field presence verification
    assert "status" in data
    assert "application" in data
    assert "version" in data

    # Field values verification
    assert data["status"] == "healthy"
    assert data["application"] == "Village Asset Mapping System"
    assert data["version"] == "0.1.0"


@pytest.mark.asyncio
async def test_not_found_error_format():
    """Verify consistent error structure for undefined routes."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/v1/nonexistent-route")

    assert response.status_code == 404
    data = response.json()
    assert "error" in data
    assert data["error"]["code"] == 404
