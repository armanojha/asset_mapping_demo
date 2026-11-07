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

logger = logging.getLogger("ingestion.svamitva")


class SvamitvaConnector(BaseGISConnector):
    """
    ArcGIS REST Service connector for SVAMITVA specific panchayat services
    (e.g. drone survey parcel geometries and vehicle centerline roads).
    """

    KNOWN_LAYERS = {
        0: {"name": "Road_Centerline", "type": "esriGeometryPolyline", "desc": "Road centerlines with width attributes"},
        1: {"name": "Road_Poly", "type": "esriGeometryPolygon", "desc": "Polygon boundary representation of roads"},
    }

    def __init__(
        self,
        service_url: Optional[str] = None,
        ssl_verify: Optional[bool] = None,
    ):
        url = service_url or settings.SVAMITVA_POC_URL
        verify = (
            ssl_verify
            if ssl_verify is not None
            else settings.SVAMITVA_SSL_VERIFY
        )
        super().__init__(
            source_name="SVAMITVA GIS Service",
            base_url=url,
            ssl_verify=verify,
        )

    async def test_connection(self) -> bool:
        """Test whether the SVAMITVA service endpoint is reachable."""
        url = f"{self.base_url}?f=json"
        try:
            response = await self._execute_request_with_retry(url)
            if response.status_code != 200:
                return False
            data = response.json()
            return "error" not in data and ("layers" in data or "mapName" in data)
        except Exception as e:
            logger.warning("SVAMITVA connection test failed: %s", e)
            return False

    async def discover_service(self) -> ArcGISServiceMetadata:
        """Fetch general SVAMITVA service metadata."""
        url = f"{self.base_url}?f=json"
        response = await self._execute_request_with_retry(url)
        data = response.json()
        if "error" in data:
            raise InvalidResponseError(f"ArcGIS service error: {data['error']}")
        return ArcGISServiceMetadata(data)

    async def get_layer_metadata(self, layer_id: Union[int, str]) -> LayerMetadata:
        """Fetch layer schema metadata."""
        url = f"{self.base_url}/{layer_id}?f=json"
        response = await self._execute_request_with_retry(url)
        data = response.json()

        if "error" in data:
            raise LayerNotFoundError(
                f"Error retrieving SVAMITVA metadata for layer {layer_id}: {data['error']}"
            )

        detail = ArcGISLayerMetadataDetail(data)
        return detail.to_layer_metadata_model()

    async def acquire_dataset(
        self,
        layer_id: Union[int, str],
        where: Optional[str] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        limit: Optional[int] = None,
        district: Optional[str] = None,
        acquisition_id: Optional[str] = None,
    ) -> DatasetAcquisitionResult:
        """
        Queries SVAMITVA features and saves under data/raw/svamitva/<acquisition_id>/.
        """
        start_time = time.perf_counter()

        where_clause = where or "1=1"
        if district and where_clause == "1=1":
            clean_dist = district.strip().replace("'", "''")
            where_clause = f"District = '{clean_dist}'"

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
            filename_stem = f"svamitva_layer_{layer_id}_{timestamp_str}"
            subfolder = (
                f"svamitva/{acquisition_id}"
                if acquisition_id
                else "svamitva"
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
                source="svamitva",
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
                source="svamitva",
                layer_id=layer_id,
                error_message=f"Layer not found: {exc}",
                execution_time_seconds=round(elapsed, 3),
            )
        except Exception as exc:
            elapsed = time.perf_counter() - start_time
            logger.error("Failed to acquire SVAMITVA layer %s: %s", layer_id, exc)
            return DatasetAcquisitionResult(
                success=False,
                source="svamitva",
                layer_id=layer_id,
                error_message=str(exc),
                execution_time_seconds=round(elapsed, 3),
            )
