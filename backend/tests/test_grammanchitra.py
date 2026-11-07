import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.config import settings
from app.ingestion.arcgis_utils import execute_paginated_arcgis_query
from app.ingestion.base import LayerNotFoundError
from app.ingestion.grammanchitra import GramManchitraConnector


@pytest.mark.asyncio
async def test_grammanchitra_service_discovery():
    """Verify service discovery correctly parses ArcGIS REST metadata."""
    connector = GramManchitraConnector()

    mock_service_metadata = {
        "currentVersion": 10.91,
        "serviceDescription": "SOI SVAMITVA Cadastral Service",
        "mapName": "SOI_MP",
        "capabilities": "Map,Query,Data",
        "supportedQueryFormats": "JSON, geoJSON, PBF",
        "maxRecordCount": 2000,
        "spatialReference": {"wkid": 102100, "latestWkid": 3857},
        "layers": [
            {"id": 0, "name": "Road", "parentLayerId": -1},
            {"id": 1, "name": "Built_Up_Area", "parentLayerId": -1},
            {"id": 2, "name": "Parcel_Area", "parentLayerId": -1},
        ],
    }

    mock_res = httpx.Response(
        status_code=200,
        json=mock_service_metadata,
        request=httpx.Request("GET", "https://example.com"),
    )

    with patch.object(connector, "_execute_request_with_retry", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = mock_res
        service_meta = await connector.discover_service()

        assert service_meta.map_name == "SOI_MP"
        assert service_meta.max_record_count == 2000
        assert service_meta.supports_geojson() is True
        assert len(service_meta.layers) == 3


@pytest.mark.asyncio
async def test_grammanchitra_layer_metadata():
    """Verify layer metadata parsing extracts fields, geometry type, and capabilities."""
    connector = GramManchitraConnector()

    mock_layer_data = {
        "id": 1,
        "name": "Built_Up_Area",
        "type": "Feature Layer",
        "geometryType": "esriGeometryPolygon",
        "description": "Footprints of built up structures",
        "maxRecordCount": 2000,
        "advancedQueryCapabilities": {"supportsPagination": True, "supportsStatistics": True},
        "fields": [
            {"name": "objectid", "type": "esriFieldTypeOID", "alias": "OBJECTID"},
            {"name": "village_code", "type": "esriFieldTypeString", "alias": "Village Code"},
            {"name": "lgd_code", "type": "esriFieldTypeString", "alias": "LGD Code"},
            {"name": "village_name", "type": "esriFieldTypeString", "alias": "Village Name"},
        ],
        "extent": {"xmin": 8250000.0, "ymin": 2420000.0, "xmax": 9210000.0, "ymax": 3090000.0},
    }

    mock_res = httpx.Response(
        status_code=200,
        json=mock_layer_data,
        request=httpx.Request("GET", "https://example.com"),
    )

    with patch.object(connector, "_execute_request_with_retry", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = mock_res
        layer_meta = await connector.get_layer_metadata(1)

        assert layer_meta.layer_id == 1
        assert layer_meta.layer_name == "Built_Up_Area"
        assert layer_meta.geometry_type == "esriGeometryPolygon"
        assert len(layer_meta.fields) == 4
        assert layer_meta.extent is not None
        assert layer_meta.extent.xmin == 8250000.0


def test_grammanchitra_filter_construction():
    """Verify attribute SQL filter construction for village code and village name."""
    connector = GramManchitraConnector()

    # Code provided
    f1 = connector.build_attribute_filter(village_code="491275")
    assert "lgd_code = '491275'" in f1
    assert "village_code = '491275'" in f1

    # Name provided
    f2 = connector.build_attribute_filter(village_name="Gudwara")
    assert "UPPER(village_name) = 'GUDWARA'" in f2

    # Escaping single quotes in village names
    f3 = connector.build_attribute_filter(village_name="Kotra's Kalan")
    assert "KOTRA''S KALAN" in f3

    # Default fallback
    f4 = connector.build_attribute_filter()
    assert f4 == "1=1"


@pytest.mark.asyncio
async def test_grammanchitra_pagination_no_silent_truncation():
    """
    Verify multi-page query pagination:
    When page 1 returns exceededTransferLimit: True, connector automatically queries
    page 2 and concatenates results without dropping features.
    """
    connector = GramManchitraConnector()

    layer_metadata_res = httpx.Response(
        status_code=200,
        json={
            "id": 1,
            "name": "Built_Up_Area",
            "maxRecordCount": 2,
            "advancedQueryCapabilities": {"supportsPagination": True},
        },
        request=httpx.Request("GET", "https://example.com"),
    )

    page1_geojson = {
        "type": "FeatureCollection",
        "exceededTransferLimit": True,
        "features": [
            {"type": "Feature", "id": 1, "properties": {"uniq_id": "U-1"}},
            {"type": "Feature", "id": 2, "properties": {"uniq_id": "U-2"}},
        ],
    }
    page1_res = httpx.Response(
        status_code=200,
        json=page1_geojson,
        request=httpx.Request("GET", "https://example.com"),
    )

    page2_geojson = {
        "type": "FeatureCollection",
        "exceededTransferLimit": False,
        "features": [
            {"type": "Feature", "id": 3, "properties": {"uniq_id": "U-3"}},
        ],
    }
    page2_res = httpx.Response(
        status_code=200,
        json=page2_geojson,
        request=httpx.Request("GET", "https://example.com"),
    )

    with patch.object(connector, "_execute_request_with_retry", new_callable=AsyncMock) as mock_exec:
        # Calls: 1. layer info, 2. page 1, 3. page 2
        mock_exec.side_effect = [layer_metadata_res, page1_res, page2_res]

        normalized, count, raw_str = await execute_paginated_arcgis_query(
            connector=connector,
            layer_id=1,
            where_clause="village_code='010'",
            preferred_format="geojson",
        )

        assert count == 3
        assert len(normalized["features"]) == 3
        assert [f["id"] for f in normalized["features"]] == [1, 2, 3]


@pytest.mark.asyncio
async def test_grammanchitra_layer_not_found():
    """Verify requesting an invalid layer raises LayerNotFoundError or reports failure."""
    connector = GramManchitraConnector()

    error_response = httpx.Response(
        status_code=200,
        json={"error": {"code": 400, "message": "Layer does not exist"}},
        request=httpx.Request("GET", "https://example.com"),
    )

    with patch.object(connector, "_execute_request_with_retry", new_callable=AsyncMock) as mock_exec:
        mock_exec.return_value = error_response
        result = await connector.acquire_dataset(layer_id=999)

        assert result.success is False
        assert "Layer not found" in result.error_message
