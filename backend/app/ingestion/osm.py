import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from app.config import settings
from app.ingestion.base import (
    BaseGISConnector,
    GISError,
    InvalidResponseError,
)
from app.schemas.geographic import (
    DataSourceMetadata,
    DatasetAcquisitionResult,
    GeographicExtent,
    LayerField,
    LayerMetadata,
)

logger = logging.getLogger("ingestion.osm")


class OpenStreetMapConnector(BaseGISConnector):
    """
    Overpass API connector for OpenStreetMap rural assets (roads, schools, health facilities, water points).
    """

    def __init__(
        self,
        overpass_url: Optional[str] = None,
    ):
        url = overpass_url or settings.OSM_OVERPASS_URL
        super().__init__(
            source_name="OpenStreetMap Overpass API",
            base_url=url,
            ssl_verify=True,
        )

    async def test_connection(self) -> bool:
        """Test whether the Overpass interpreter responds."""
        query = "[out:json][timeout:10]; out;"
        try:
            response = await self._execute_request_with_retry(
                self.base_url,
                method="POST",
                data={"data": query},
            )
            return response.status_code == 200
        except Exception:
            return False

    async def get_layer_metadata(self, layer_id: Union[int, str]) -> LayerMetadata:
        """
        Returns virtual layer schema definition for OSM asset categories.
        Supported layers: 'all', 'amenities', 'roads', 'water'.
        """
        layer_str = str(layer_id).lower()

        fields = [
            LayerField(name="id", field_type="Integer", alias="OSM ID"),
            LayerField(name="type", field_type="String", alias="Element Type (node/way/relation)"),
            LayerField(name="name", field_type="String", alias="Feature Name"),
            LayerField(name="amenity", field_type="String", alias="Amenity Tag"),
            LayerField(name="highway", field_type="String", alias="Highway Tag"),
            LayerField(name="man_made", field_type="String", alias="Infrastructure Tag"),
            LayerField(name="tags", field_type="Dictionary", alias="All OSM Tags"),
        ]

        geometry_type = "GeometryCollection"
        if layer_str == "roads":
            geometry_type = "LineString"
        elif layer_str in ["amenities", "water"]:
            geometry_type = "Point/Polygon"

        return LayerMetadata(
            layer_id=layer_id,
            layer_name=f"OSM_{layer_str.capitalize()}",
            geometry_type=geometry_type,
            fields=fields,
            description=f"OpenStreetMap extracted assets for category: {layer_str}",
        )

    def _build_overpass_query(
        self,
        bbox: Tuple[float, float, float, float],
        layer_type: str = "all",
    ) -> str:
        """
        Constructs Overpass QL query for a given bounding box (min_lon, min_lat, max_lon, max_lat).
        Note: Overpass expects bbox as (south, west, north, east) = (min_lat, min_lon, max_lat, max_lon).
        """
        min_lon, min_lat, max_lon, max_lat = bbox
        s, w, n, e = min_lat, min_lon, max_lat, max_lon

        if layer_type == "roads":
            body = f"""
            way["highway"]({s},{w},{n},{e});
            """
        elif layer_type == "amenities":
            body = f"""
            node["amenity"]({s},{w},{n},{e});
            way["amenity"]({s},{w},{n},{e});
            """
        elif layer_type == "water":
            body = f"""
            node["amenity"="drinking_water"]({s},{w},{n},{e});
            node["man_made"="water_tower"]({s},{w},{n},{e});
            way["waterway"]({s},{w},{n},{e});
            """
        else:  # all village assets
            body = f"""
            node["amenity"]({s},{w},{n},{e});
            way["amenity"]({s},{w},{n},{e});
            way["highway"]({s},{w},{n},{e});
            node["man_made"="water_tower"]({s},{w},{n},{e});
            node["amenity"="drinking_water"]({s},{w},{n},{e});
            way["waterway"]({s},{w},{n},{e});
            """

        return f"""
        [out:json][timeout:25];
        (
          {body}
        );
        out body;
        >;
        out skel qt;
        """

    @staticmethod
    def _convert_overpass_to_geojson(overpass_data: Dict[str, Any]) -> Dict[str, Any]:
        """Converts Overpass elements into GeoJSON FeatureCollection."""
        nodes = {}
        features = []
        elements = overpass_data.get("elements", [])

        for el in elements:
            if el.get("type") == "node" and "lat" in el and "lon" in el:
                nodes[el["id"]] = (el["lon"], el["lat"])
                if el.get("tags"):
                    features.append({
                        "type": "Feature",
                        "id": el["id"],
                        "geometry": {"type": "Point", "coordinates": [el["lon"], el["lat"]]},
                        "properties": el["tags"],
                    })

        for el in elements:
            if el.get("type") == "way" and el.get("nodes"):
                coords = [nodes[nid] for nid in el["nodes"] if nid in nodes]
                if len(coords) >= 2:
                    is_closed = coords[0] == coords[-1]
                    geom_type = "Polygon" if (is_closed and len(coords) >= 4 and "building" in el.get("tags", {})) else "LineString"
                    geom_coords = [coords] if geom_type == "Polygon" else coords
                    features.append({
                        "type": "Feature",
                        "id": el["id"],
                        "geometry": {"type": geom_type, "coordinates": geom_coords},
                        "properties": el.get("tags", {}),
                    })

        return {
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": features,
        }

    async def acquire_dataset(
        self,
        layer_id: Union[int, str] = "all",
        where: Optional[str] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        limit: Optional[int] = None,
        acquisition_id: Optional[str] = None,
    ) -> DatasetAcquisitionResult:
        """
        Acquires OSM features for the specified bounding box (min_lon, min_lat, max_lon, max_lat).
        Saves raw JSON response and normalized GeoJSON under data/raw/osm/<acquisition_id>/.
        """
        start_time = time.perf_counter()

        if not bbox:
            return DatasetAcquisitionResult(
                success=False,
                source="osm",
                layer_id=layer_id,
                error_message="Bounding box (min_lon, min_lat, max_lon, max_lat) is required for OSM queries.",
            )

        query = self._build_overpass_query(bbox=bbox, layer_type=str(layer_id).lower())

        try:
            response = await self._execute_request_with_retry(
                self.base_url,
                method="POST",
                data={"data": query},
            )

            if response.status_code != 200:
                raise InvalidResponseError(
                    f"Overpass query returned HTTP {response.status_code}: {response.text[:200]}"
                )

            data = response.json()
            elements = data.get("elements", [])
            feature_count = len(elements)

            # Convert to GeoJSON FeatureCollection
            normalized_geojson = self._convert_overpass_to_geojson(data)

            extent_obj = GeographicExtent(
                xmin=bbox[0], ymin=bbox[1], xmax=bbox[2], ymax=bbox[3], spatial_reference="EPSG:4326"
            )

            metadata = DataSourceMetadata(
                source_name=self.source_name,
                endpoint_url=self.base_url,
                layer_id=layer_id,
                download_timestamp=datetime.now(timezone.utc),
                crs="EPSG:4326",
                format="OverpassJSON",
                record_count=feature_count,
                extent=extent_obj,
                query_params={"bbox": bbox, "layer_id": str(layer_id), "acquisition_id": acquisition_id},
            )

            timestamp_str = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            filename_stem = f"osm_{layer_id}_{timestamp_str}"
            subfolder = f"osm/{acquisition_id}" if acquisition_id else "osm"

            raw_path, meta_path, normalized_path = self._save_raw_and_normalized_dataset(
                raw_content=response.text,
                normalized_geojson=normalized_geojson,
                subfolder=subfolder,
                filename_stem=filename_stem,
                metadata=metadata,
            )

            elapsed = time.perf_counter() - start_time
            return DatasetAcquisitionResult(
                success=True,
                source="osm",
                layer_id=layer_id,
                file_path=normalized_path or raw_path,
                metadata_path=meta_path,
                feature_count=len(normalized_geojson["features"]),
                execution_time_seconds=round(elapsed, 3),
                metadata=metadata,
            )

        except Exception as exc:
            elapsed = time.perf_counter() - start_time
            logger.error("Failed to acquire OSM layer %s: %s", layer_id, exc)
            return DatasetAcquisitionResult(
                success=False,
                source="osm",
                layer_id=layer_id,
                error_message=str(exc),
                execution_time_seconds=round(elapsed, 3),
            )
