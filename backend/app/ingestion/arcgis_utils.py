import json
import logging
from typing import Any, Dict, List, Optional, Tuple, Union

from app.ingestion.base import (
    BaseGISConnector,
    GISError,
    InvalidResponseError,
    LayerNotFoundError,
)
from app.schemas.geographic import GeographicExtent, LayerField, LayerMetadata

logger = logging.getLogger("ingestion.arcgis")


class ArcGISServiceMetadata:
    """Parsed metadata for an entire ArcGIS REST MapServer service."""

    def __init__(self, raw: Dict[str, Any]):
        self.raw = raw
        self.map_name: str = raw.get("mapName", "")
        self.description: str = raw.get("serviceDescription", "")
        self.spatial_reference: Dict[str, Any] = raw.get("spatialReference", {})
        self.capabilities: List[str] = [
            c.strip() for c in raw.get("capabilities", "").split(",") if c.strip()
        ]
        self.supported_query_formats: List[str] = [
            f.strip()
            for f in raw.get("supportedQueryFormats", "JSON").split(",")
            if f.strip()
        ]
        self.max_record_count: int = int(raw.get("maxRecordCount", 1000))
        self.layers: List[Dict[str, Any]] = raw.get("layers", [])
        self.tables: List[Dict[str, Any]] = raw.get("tables", [])

    def supports_geojson(self) -> bool:
        return any("geojson" in fmt.lower() for fmt in self.supported_query_formats)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "map_name": self.map_name,
            "description": self.description,
            "spatial_reference": self.spatial_reference,
            "capabilities": self.capabilities,
            "supported_query_formats": self.supported_query_formats,
            "max_record_count": self.max_record_count,
            "layers_count": len(self.layers),
            "layers": [
                {"id": lyr.get("id"), "name": lyr.get("name"), "subLayers": lyr.get("subLayerIds")}
                for lyr in self.layers
            ],
        }


class ArcGISLayerMetadataDetail:
    """Detailed metadata for a single ArcGIS REST MapServer layer."""

    def __init__(self, raw: Dict[str, Any]):
        self.raw = raw
        self.layer_id: int = int(raw.get("id", 0))
        self.name: str = raw.get("name", "")
        self.layer_type: str = raw.get("type", "")
        self.geometry_type: str = raw.get("geometryType", "")
        self.description: str = raw.get("description", "")
        self.display_field: str = raw.get("displayField", "")
        self.max_record_count: int = int(raw.get("maxRecordCount", 1000))

        # Advanced query capabilities
        advanced = raw.get("advancedQueryCapabilities", {})
        self.supports_pagination: bool = bool(
            raw.get("supportsPagination", advanced.get("supportsPagination", False))
        )
        self.supports_statistics: bool = bool(
            raw.get("supportsStatistics", advanced.get("supportsStatistics", False))
        )

        # Fields & Object ID
        self.fields: List[Dict[str, Any]] = raw.get("fields", [])
        self.object_id_field: str = "objectid"
        for f in self.fields:
            if f.get("type") == "esriFieldTypeOID":
                self.object_id_field = f.get("name", "objectid")
                break

        # Extent
        self.extent: Optional[Dict[str, Any]] = raw.get("extent")

    def to_layer_metadata_model(self) -> LayerMetadata:
        fields_list = [
            LayerField(
                name=f.get("name", ""),
                field_type=f.get("type", ""),
                alias=f.get("alias"),
                nullable=f.get("nullable", True),
            )
            for f in self.fields
        ]

        extent_model = None
        if self.extent:
            extent_model = GeographicExtent(
                xmin=float(self.extent.get("xmin", 0.0)),
                ymin=float(self.extent.get("ymin", 0.0)),
                xmax=float(self.extent.get("xmax", 0.0)),
                ymax=float(self.extent.get("ymax", 0.0)),
                spatial_reference=self.extent.get("spatialReference"),
            )

        return LayerMetadata(
            layer_id=self.layer_id,
            layer_name=self.name,
            geometry_type=self.geometry_type,
            fields=fields_list,
            description=self.description,
            max_record_count=self.max_record_count,
            extent=extent_model,
        )


async def execute_paginated_arcgis_query(
    connector: BaseGISConnector,
    layer_id: Union[int, str],
    where_clause: str = "1=1",
    bbox: Optional[Tuple[float, float, float, float]] = None,
    out_fields: str = "*",
    max_features_desired: Optional[int] = None,
    preferred_format: str = "geojson",
) -> Tuple[Dict[str, Any], int, str]:
    """
    Executes a paginated query against an ArcGIS REST layer.
    Ensures datasets are NEVER silently truncated by iterating pages
    using resultOffset and resultRecordCount until all records are collected
    or max_features_desired is fulfilled.

    Returns: (merged_geojson_dict, total_features_count, raw_responses_combined_str)
    """
    query_url = f"{connector.base_url}/{layer_id}/query"

    # 1. Fetch layer details to know maxRecordCount and pagination support
    layer_info_url = f"{connector.base_url}/{layer_id}?f=json"
    layer_info_res = await connector._execute_request_with_retry(layer_info_url)
    layer_data = layer_info_res.json()

    if "error" in layer_data:
        raise LayerNotFoundError(
            f"Layer {layer_id} not accessible or invalid: {layer_data['error']}"
        )

    layer_meta = ArcGISLayerMetadataDetail(layer_data)
    batch_size = min(layer_meta.max_record_count, 1000)

    # 2. Build base query params
    params: Dict[str, Any] = {
        "where": where_clause,
        "outFields": out_fields,
        "f": preferred_format,
        "returnGeometry": "true",
    }

    if bbox:
        # Bbox: (min_lon, min_lat, max_lon, max_lat)
        params["geometry"] = f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]}"
        params["geometryType"] = "esriGeometryEnvelope"
        params["spatialRel"] = "esriSpatialRelIntersects"
        params["inSR"] = "4326"

    # 3. Pagination loop
    all_features: List[Dict[str, Any]] = []
    current_offset = 0
    raw_responses: List[str] = []

    while True:
        current_batch_limit = batch_size
        if max_features_desired is not None:
            remaining = max_features_desired - len(all_features)
            if remaining <= 0:
                break
            current_batch_limit = min(batch_size, remaining)

        page_params = dict(params)
        page_params["resultOffset"] = str(current_offset)
        page_params["resultRecordCount"] = str(current_batch_limit)

        logger.debug(
            "Querying layer %s page at offset %d (limit %d)",
            layer_id,
            current_offset,
            current_batch_limit,
        )

        response = await connector._execute_request_with_retry(query_url, params=page_params)
        raw_text = response.text
        raw_responses.append(raw_text)

        if response.status_code != 200:
            raise InvalidResponseError(
                f"Query to layer {layer_id} failed with HTTP {response.status_code}: {raw_text[:200]}"
            )

        data = response.json()
        if "error" in data:
            raise InvalidResponseError(f"ArcGIS REST error on layer {layer_id}: {data['error']}")

        # Extract features depending on format
        features = data.get("features", [])
        if not features:
            # No more features
            break

        all_features.extend(features)
        current_offset += len(features)

        # Check termination conditions
        exceeded_limit = data.get("exceededTransferLimit", False)
        if not exceeded_limit and len(features) < current_batch_limit:
            break

        if max_features_desired is not None and len(all_features) >= max_features_desired:
            break

        # Safety break to prevent infinite loops on static mock data
        if len(features) == 0:
            break

    # 4. Construct normalized GeoJSON FeatureCollection
    normalized_geojson = {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"},
        },
        "features": all_features,
    }

    combined_raw_str = (
        raw_responses[0] if len(raw_responses) == 1 else json.dumps(raw_responses)
    )

    return normalized_geojson, len(all_features), combined_raw_str
