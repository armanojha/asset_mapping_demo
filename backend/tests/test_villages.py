import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app
from app.schemas.geographic import DatasetAcquisitionResult
from app.services.village_acquisition import VillageAcquisitionService


@pytest.mark.asyncio
async def test_acquire_village_validation_missing_fields():
    """Verify endpoint returns 422 if required village fields are missing."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Missing 'village'
        response = await client.post("/api/v1/villages/acquire", json={"state": "Madhya Pradesh"})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_acquire_village_valid_request_mocked(tmp_path):
    """Verify endpoint processes valid village acquisition with mocked GIS sources."""
    old_raw = settings.RAW_DATA_DIR
    settings.RAW_DATA_DIR = str(tmp_path / "raw")

    try:
        mock_gm_result = DatasetAcquisitionResult(
            success=True,
            source="grammanchitra",
            layer_id=1,
            feature_count=15,
            file_path=str(tmp_path / "raw/gm_layer_1.geojson"),
            metadata_path=str(tmp_path / "raw/gm_layer_1.meta.json"),
        )
        mock_sv_result = DatasetAcquisitionResult(
            success=True,
            source="svamitva",
            layer_id=0,
            feature_count=4,
            file_path=str(tmp_path / "raw/sv_layer_0.geojson"),
            metadata_path=str(tmp_path / "raw/sv_layer_0.meta.json"),
        )

        with patch("app.ingestion.grammanchitra.GramManchitraConnector.acquire_dataset", new_callable=AsyncMock) as mock_gm, \
             patch("app.ingestion.svamitva.SvamitvaConnector.acquire_dataset", new_callable=AsyncMock) as mock_sv:

            mock_gm.return_value = mock_gm_result
            mock_sv.return_value = mock_sv_result

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                payload = {
                    "state": "Madhya Pradesh",
                    "district": "Sehore",
                    "block": "Ichhawar",
                    "gram_panchayat": "Gudwara",
                    "village": "Gudwara",
                    "village_code": "491275",
                    "bounding_box": [79.0, 23.0, 79.1, 23.1],
                    "sources": ["grammanchitra", "svamitva"],
                }
                response = await client.post("/api/v1/villages/acquire", json=payload)

            assert response.status_code == 200
            data = response.json()
            assert "acquisition_id" in data
            assert data["village"]["village"] == "Gudwara"
            assert data["village"]["village_code"] == "491275"
            assert "grammanchitra" in data["sources_queried"]
            assert "svamitva" in data["sources_queried"]
            assert len(data["layers_retrieved"]) > 0

    finally:
        settings.RAW_DATA_DIR = old_raw


@pytest.mark.asyncio
async def test_acquire_village_partial_source_failure(tmp_path):
    """
    Verify partial success:
    If Gram Manchitra succeeds but SVAMITVA encounters a network failure,
    Gram Manchitra data is preserved and reported, while SVAMITVA error is recorded.
    """
    old_raw = settings.RAW_DATA_DIR
    settings.RAW_DATA_DIR = str(tmp_path / "raw")

    try:
        mock_gm_result = DatasetAcquisitionResult(
            success=True,
            source="grammanchitra",
            layer_id=1,
            feature_count=20,
            file_path=str(tmp_path / "raw/gm_layer_1.geojson"),
        )
        mock_sv_result = DatasetAcquisitionResult(
            success=False,
            source="svamitva",
            layer_id=0,
            error_message="Connection to SVAMITVA server timed out",
        )

        with patch("app.ingestion.grammanchitra.GramManchitraConnector.acquire_dataset", new_callable=AsyncMock) as mock_gm, \
             patch("app.ingestion.svamitva.SvamitvaConnector.acquire_dataset", new_callable=AsyncMock) as mock_sv:

            mock_gm.return_value = mock_gm_result
            mock_sv.return_value = mock_sv_result

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                payload = {
                    "state": "Madhya Pradesh",
                    "village": "Test Village",
                    "district": "Test District",
                    "sources": ["grammanchitra", "svamitva"],
                }
                response = await client.post("/api/v1/villages/acquire", json=payload)

            assert response.status_code == 200
            data = response.json()
            assert data["partial_success"] is True
            assert any(err in str(data["errors"]) for err in ["SVAMITVA", "timed out"])
            # Gram Manchitra layer is successfully recorded
            gm_layers = [l for l in data["layers_retrieved"] if l["source"] == "grammanchitra"]
            assert any(l["status"] == "success" for l in gm_layers)

    finally:
        settings.RAW_DATA_DIR = old_raw


@pytest.mark.asyncio
async def test_acquire_village_unknown_source():
    """Verify requesting an unknown GIS source logs an error without crashing valid sources."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        payload = {
            "state": "Madhya Pradesh",
            "village": "Sample Village",
            "sources": ["unknown_cadastral_provider"],
        }
        response = await client.post("/api/v1/villages/acquire", json=payload)

    assert response.status_code == 200
    data = response.json()
    assert any("Unknown GIS source" in err for err in data["errors"])


@pytest.mark.asyncio
async def test_acquire_village_empty_dataset(tmp_path):
    """Verify querying an empty layer generates a warning without fatal failure."""
    old_raw = settings.RAW_DATA_DIR
    settings.RAW_DATA_DIR = str(tmp_path / "raw")

    try:
        mock_gm_result = DatasetAcquisitionResult(
            success=True,
            source="grammanchitra",
            layer_id=1,
            feature_count=0,
            file_path=str(tmp_path / "raw/empty.geojson"),
        )

        with patch("app.ingestion.grammanchitra.GramManchitraConnector.acquire_dataset", new_callable=AsyncMock) as mock_gm:
            mock_gm.return_value = mock_gm_result

            transport = ASGITransport(app=app)
            async with AsyncClient(transport=transport, base_url="http://test") as client:
                payload = {
                    "state": "Madhya Pradesh",
                    "village": "NonExistentVillage",
                    "sources": ["grammanchitra"],
                }
                response = await client.post("/api/v1/villages/acquire", json=payload)

            assert response.status_code == 200
            data = response.json()
            assert any("0 features" in w for w in data["warnings"])
            assert any(l["status"] == "empty" for l in data["layers_retrieved"])

    finally:
        settings.RAW_DATA_DIR = old_raw
