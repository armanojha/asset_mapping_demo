import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from app.config import settings
from app.ingestion.arcgis_utils import (
    ArcGISLayerMetadataDetail,
    ArcGISServiceMetadata,
    execute_paginated_arcgis_query,
)
from app.ingestion.base import (
    BaseGISConnector,
    GISError,
    InvalidResponseError,
    LayerNotFoundError,
)
from app.schemas.geographic import (
    DataSourceMetadata,
    DatasetAcquisitionResult,
    GeographicExtent,
    LayerMetadata,
)

logger = logging.getLogger("ingestion.grammanchitra")


class GramManchitraConnector(BaseGISConnector):
    """
    ArcGIS REST Service connector for Gram Manchitra geospatial layers
    (e.g. Survey of India SVAMITVA layers: Road, Built_Up_Area, Parcel_Area).
    """

    KNOWN_LAYERS = {
        0: {"name": "Road", "type": "esriGeometryPolygon", "desc": "Road polygons and boundaries"},
        1: {"name": "Built_Up_Area", "type": "esriGeometryPolygon", "desc": "Building footprints and residential structures"},
        2: {"name": "Parcel_Area", "type": "esriGeometryPolygon", "desc": "Cadastral land parcels and survey plots"},
    }

    def __init__(
        self,
        service_url: Optional[str] = None,
        ssl_verify: Optional[bool] = None,
    ):
        url = service_url or settings.GRAM_MANCHITRA_SOI_MP_URL
        verify = (
            ssl_verify
            if ssl_verify is not None
            else settings.GRAM_MANCHITRA_SSL_VERIFY
        )
        super().__init__(
            source_name="Gram Manchitra (SOI SVAMITVA)",
            base_url=url,
            ssl_verify=verify,
        )

    async def test_connection(self) -> bool:
        """Test whether the MapServer endpoint is reachable and returns valid JSON."""
        url = f"{self.base_url}?f=json"
        try:
            response = await self._execute_request_with_retry(url)
            if response.status_code != 200:
                return False
            data = response.json()
            return "error" not in data and ("layers" in data or "mapName" in data)
        except Exception as e:
            logger.warning("Gram Manchitra connection test failed: %s", e)
            return False

    async def discover_service(self) -> ArcGISServiceMetadata:
        """Retrieve and inspect the full ArcGIS REST service metadata."""
        url = f"{self.base_url}?f=json"
        response = await self._execute_request_with_retry(url)
        data = response.json()
        if "error" in data:
            raise InvalidResponseError(f"ArcGIS service error: {data['error']}")
        return ArcGISServiceMetadata(data)

    async def get_layer_metadata(self, layer_id: Union[int, str]) -> LayerMetadata:
        """Fetch schema, field definitions, and capabilities for an individual layer."""
        url = f"{self.base_url}/{layer_id}?f=json"
        response = await self._execute_request_with_retry(url)
        data = response.json()

        if "error" in data:
            raise LayerNotFoundError(
                f"Error retrieving metadata for layer {layer_id}: {data['error']}"
            )

        detail = ArcGISLayerMetadataDetail(data)
        return detail.to_layer_metadata_model()

    def build_attribute_filter(
        self,
        village_name: Optional[str] = None,
        village_code: Optional[str] = None,
        district_name: Optional[str] = None,
    ) -> str:
        """
        Constructs an SQL WHERE clause supported by Gram Manchitra layers.
        Layers contain 'village_code', 'lgd_code', 'village_name', 'district_code'.
        """
        clauses = []
        if village_code:
            clauses.append(
                f"(lgd_code = '{village_code}' OR village_code = '{village_code}')"
            )
        elif village_name:
            clean_name = village_name.strip().upper().replace("'", "''")
            clauses.append(f"UPPER(village_name) = '{clean_name}'")

        return " AND ".join(clauses) if clauses else "1=1"

    async def acquire_dataset(
        self,
        layer_id: Union[int, str],
        where: Optional[str] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        limit: Optional[int] = None,
        village_name: Optional[str] = None,
        village_code: Optional[str] = None,
        acquisition_id: Optional[str] = None,
    ) -> DatasetAcquisitionResult:
        """
        Queries features from the layer with pagination, preserving original responses
        and saving normalized GeoJSON under data/raw/grammanchitra/<acquisition_id>/.
        """
        start_time = time.perf_counter()

        where_clause = where
        if not where_clause:
            where_clause = self.build_attribute_filter(
                village_name=village_name,
                village_code=village_code,
            )

        try:
            normalized_geojson, feature_count, raw_response_str = (
                await execute_paginated_arcgis_query(
                    connector=self,
                    layer_id=layer_id,
                    where_clause=where_clause,
                    bbox=bbox,
                    out_fields="*",
                    max_features_desired=limit,
                    preferred_format="geojson",
                )
            )

            extent_obj = None
            if bbox:
                extent_obj = GeographicExtent(
                    xmin=bbox[0], ymin=bbox[1], xmax=bbox[2], ymax=bbox[3], spatial_reference="EPSG:4326"
                )

            query_params = {
                "where": where_clause,
                "bbox": bbox,
                "limit": limit,
                "layer_id": str(layer_id),
                "acquisition_id": acquisition_id,
            }

            metadata = DataSourceMetadata(
                source_name=self.source_name,
                endpoint_url=f"{self.base_url}/{layer_id}/query",
                layer_id=layer_id,
                download_timestamp=datetime.now(timezone.utc),
                crs="EPSG:4326",
                format="GeoJSON",
                record_count=feature_count,
                extent=extent_obj,
                query_params=query_params,
            )

            timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            filename_stem = f"grammanchitra_layer_{layer_id}_{timestamp_str}"
            subfolder = (
                f"grammanchitra/{acquisition_id}"
                if acquisition_id
                else "grammanchitra"
            )

            raw_path, meta_path, normalized_path = self._save_raw_and_normalized_dataset(
                raw_content=raw_response_str,
                normalized_geojson=normalized_geojson,
                subfolder=subfolder,
                filename_stem=filename_stem,
                metadata=metadata,
            )

            elapsed = time.perf_counter() - start_time
            return DatasetAcquisitionResult(
                success=True,
                source="grammanchitra",
                layer_id=layer_id,
                file_path=normalized_path or raw_path,
                metadata_path=meta_path,
                feature_count=feature_count,
                execution_time_seconds=round(elapsed, 3),
                metadata=metadata,
            )

        except LayerNotFoundError as exc:
            elapsed = time.perf_counter() - start_time
            logger.error("Layer not found: %s", exc)
            return DatasetAcquisitionResult(
                success=False,
                source="grammanchitra",
                layer_id=layer_id,
                error_message=f"Layer not found: {exc}",
                execution_time_seconds=round(elapsed, 3),
            )
        except Exception as exc:
            elapsed = time.perf_counter() - start_time
            logger.error("Failed to acquire Gram Manchitra layer %s: %s", layer_id, exc)
            return DatasetAcquisitionResult(
                success=False,
                source="grammanchitra",
                layer_id=layer_id,
                error_message=str(exc),
                execution_time_seconds=round(elapsed, 3),
            )
