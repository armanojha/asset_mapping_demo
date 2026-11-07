import json
import os
import shutil
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.config import settings
from app.ingestion.base import (
    BaseGISConnector,
    ConnectionTimeoutError,
    GISError,
    InvalidResponseError,
)
from app.ingestion.grammanchitra import GramManchitraConnector
from app.ingestion.osm import OpenStreetMapConnector
from app.ingestion.svamitva import SvamitvaConnector
from app.schemas.geographic import (
    DataSourceMetadata,
    DatasetAcquisitionResult,
    GeographicExtent,
    LayerField,
    LayerMetadata,
)
from app.services.data_acquisition import DataAcquisitionService


class DummyConnector(BaseGISConnector):
    """Test concrete connector for base class verification."""

    async def test_connection(self) -> bool:
        return True

    async def get_layer_metadata(self, layer_id):
        return LayerMetadata(
            layer_id=layer_id,
            layer_name="Dummy",
            geometry_type="Point",
        )

    async def acquire_dataset(self, layer_id, where=None, bbox=None, limit=None):
        return DatasetAcquisitionResult(
            success=True,
            source="dummy",
            layer_id=layer_id,
            feature_count=1,
        )


def test_configuration_loading():
    """Verify GIS ingestion configuration values are loaded correctly."""
    assert settings.GRAM_MANCHITRA_SOI_MP_URL is not None
    assert "MapServer" in settings.GRAM_MANCHITRA_SOI_MP_URL
    assert settings.SVAMITVA_POC_URL is not None
    assert settings.OSM_OVERPASS_URL is not None
    assert settings.HTTP_TIMEOUT_SECONDS > 0
    assert settings.HTTP_MAX_RETRIES >= 1
    assert settings.RAW_DATA_DIR.endswith("data\\raw") or settings.RAW_DATA_DIR.endswith("data/raw")


def test_connector_initialization():
    """Verify connectors initialize with appropriate settings."""
    gm = GramManchitraConnector()
    assert "SOI_MP" in gm.base_url
    assert gm.ssl_verify == settings.GRAM_MANCHITRA_SSL_VERIFY

    sv = SvamitvaConnector()
    assert "svamitva_POC_Vehicle" in sv.base_url

    osm = OpenStreetMapConnector()
    assert "interpreter" in osm.base_url
    assert osm.ssl_verify is True


def test_metadata_validation():
    """Verify geographic Pydantic schema validation."""
    extent = GeographicExtent(xmin=79.0, ymin=23.0, xmax=79.5, ymax=23.5, spatial_reference="EPSG:4326")
    assert extent.xmin == 79.0

    field = LayerField(name="plot_no", field_type="esriFieldTypeString", alias="Plot Number")
    layer = LayerMetadata(
        layer_id=0,
        layer_name="Roads",
        geometry_type="esriGeometryPolyline",
        fields=[field],
        extent=extent,
    )
    assert layer.layer_name == "Roads"
    assert len(layer.fields) == 1

    meta = DataSourceMetadata(
        source_name="Gram Manchitra",
        endpoint_url="https://example.com/query",
        layer_id=0,
        crs="EPSG:4326",
        format="GeoJSON",
        record_count=10,
        extent=extent,
    )
    assert meta.record_count == 10
    json_str = meta.model_dump_json()
    assert "Gram Manchitra" in json_str


def test_raw_file_storage(tmp_path):
    """Verify raw file and companion .meta.json sidecar are stored without mutation."""
    connector = DummyConnector(
        source_name="test",
        base_url="http://test.local",
    )

    # Temporary override of raw directory
    old_raw_dir = settings.RAW_DATA_DIR
    settings.RAW_DATA_DIR = str(tmp_path / "raw")

    try:
        sample_geojson = '{"type":"FeatureCollection","features":[{"type":"Feature","id":1}]}'
        extent = GeographicExtent(xmin=10.0, ymin=20.0, xmax=11.0, ymax=21.0)
        metadata = DataSourceMetadata(
            source_name="Test Source",
            endpoint_url="http://test.local/layer/0",
            layer_id=0,
            record_count=1,
            extent=extent,
        )

        data_path, meta_path = connector._save_raw_dataset(
            raw_content=sample_geojson,
            subfolder="test_folder",
            filename_stem="test_dataset",
            metadata=metadata,
        )

        assert os.path.exists(data_path)
        assert os.path.exists(meta_path)

        with open(data_path, "r", encoding="utf-8") as f:
            saved_content = f.read()
        assert saved_content == sample_geojson

        with open(meta_path, "r", encoding="utf-8") as f:
            saved_meta = json.load(f)
        assert saved_meta["source_name"] == "Test Source"
        assert saved_meta["record_count"] == 1

    finally:
        settings.RAW_DATA_DIR = old_raw_dir


@pytest.mark.asyncio
async def test_base_connector_timeout_handling():
    """Verify connector handles timeouts with retries and raises ConnectionTimeoutError."""
    connector = DummyConnector(
        source_name="test",
        base_url="http://test.local",
        max_retries=2,
        backoff_factor=1.0,
    )

    with patch("httpx.AsyncClient.get", side_effect=httpx.TimeoutException("Network timed out")):
        with pytest.raises(ConnectionTimeoutError):
            await connector._execute_request_with_retry("http://test.local/endpoint")


@pytest.mark.asyncio
async def test_invalid_response_handling():
    """Verify connector handles 500 server errors and raises InvalidResponseError."""
    connector = DummyConnector(
        source_name="test",
        base_url="http://test.local",
        max_retries=2,
        backoff_factor=1.0,
    )

    mock_response = httpx.Response(
        status_code=500,
        content=b"Internal Server Error",
        request=httpx.Request("GET", "http://test.local"),
    )

    with patch("httpx.AsyncClient.get", return_value=mock_response):
        with pytest.raises(InvalidResponseError):
            await connector._execute_request_with_retry("http://test.local/endpoint")


@pytest.mark.asyncio
async def test_grammanchitra_acquire_mocked(tmp_path):
    """Verify Gram Manchitra connector acquires and persists GeoJSON features."""
    old_raw = settings.RAW_DATA_DIR
    settings.RAW_DATA_DIR = str(tmp_path / "raw")

    try:
        connector = GramManchitraConnector()

        mock_payload = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": 101,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[[79.0, 23.0], [79.1, 23.0], [79.1, 23.1], [79.0, 23.1], [79.0, 23.0]]],
                    },
                    "properties": {
                        "village_code": "123456",
                        "plot_no": "A-12",
                        "area_sqm": 450.5,
                    },
                }
            ],
        }

        mock_response = httpx.Response(
            status_code=200,
            json=mock_payload,
            request=httpx.Request("GET", "https://example.com"),
        )

        with patch("httpx.AsyncClient.get", return_value=mock_response):
            result = await connector.acquire_dataset(
                layer_id=1,
                where="village_code='123456'",
                limit=10,
            )

            assert result.success is True
            assert result.source == "grammanchitra"
            assert result.feature_count == 1
            assert result.file_path is not None
            assert os.path.exists(result.file_path)

            with open(result.file_path, "r", encoding="utf-8") as f:
                saved = json.load(f)
            assert saved["features"][0]["properties"]["village_code"] == "123456"

    finally:
        settings.RAW_DATA_DIR = old_raw


@pytest.mark.asyncio
async def test_osm_acquire_mocked(tmp_path):
    """Verify OpenStreetMap connector acquires and persists Overpass JSON features."""
    old_raw = settings.RAW_DATA_DIR
    settings.RAW_DATA_DIR = str(tmp_path / "raw")

    try:
        connector = OpenStreetMapConnector()

        mock_payload = {
            "version": 0.6,
            "elements": [
                {
                    "type": "node",
                    "id": 999999,
                    "lat": 23.1,
                    "lon": 79.1,
                    "tags": {"amenity": "school", "name": "Village Primary School"},
                }
            ],
        }

        mock_response = httpx.Response(
            status_code=200,
            json=mock_payload,
            request=httpx.Request("POST", "https://example.com"),
        )

        with patch("httpx.AsyncClient.post", return_value=mock_response):
            result = await connector.acquire_dataset(
                layer_id="amenities",
                bbox=(79.0, 23.0, 79.2, 23.2),
            )

            assert result.success is True
            assert result.source == "osm"
            assert result.feature_count == 1
            assert os.path.exists(result.file_path)

    finally:
        settings.RAW_DATA_DIR = old_raw
