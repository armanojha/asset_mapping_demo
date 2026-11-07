import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

from app.ingestion.grammanchitra import GramManchitraConnector
from app.ingestion.osm import OpenStreetMapConnector
from app.ingestion.svamitva import SvamitvaConnector
from app.schemas.village import (
    AcquiredLayerSummary,
    VillageAcquisitionRequest,
    VillageAcquisitionResponse,
    VillageIdentifier,
)

logger = logging.getLogger("services.village_acquisition")


class VillageAcquisitionService:
    """
    Service coordinating multi-source GIS acquisition for a specific village,
    handling attribute resolution, spatial fallback bounding boxes, raw persistence,
    and partial failure recovery.
    """

    def __init__(
        self,
        grammanchitra_connector: Optional[GramManchitraConnector] = None,
        svamitva_connector: Optional[SvamitvaConnector] = None,
        osm_connector: Optional[OpenStreetMapConnector] = None,
    ):
        self.grammanchitra = grammanchitra_connector or GramManchitraConnector()
        self.svamitva = svamitva_connector or SvamitvaConnector()
        self.osm = osm_connector or OpenStreetMapConnector()

    @staticmethod
    def _extract_bbox_from_geojson(geojson_data: Dict[str, Any]) -> Optional[Tuple[float, float, float, float]]:
        """
        Calculates the bounding envelope (min_lon, min_lat, max_lon, max_lat)
        across features in a GeoJSON FeatureCollection.
        """
        features = geojson_data.get("features", [])
        if not features:
            return None

        min_x, min_y = float("inf"), float("inf")
        max_x, max_y = float("-inf"), float("-inf")

        def check_coords(coords: Any):
            nonlocal min_x, min_y, max_x, max_y
            if isinstance(coords, (list, tuple)) and len(coords) >= 2 and isinstance(coords[0], (int, float)):
                x, y = coords[0], coords[1]
                min_x = min(min_x, x)
                min_y = min(min_y, y)
                max_x = max(max_x, x)
                max_y = max(max_y, y)
            elif isinstance(coords, list):
                for item in coords:
                    check_coords(item)

        for feat in features:
            geom = feat.get("geometry")
            if geom and "coordinates" in geom:
                check_coords(geom["coordinates"])

        if min_x == float("inf"):
            return None
        return (min_x, min_y, max_x, max_y)

    async def acquire_village(
        self,
        request: VillageAcquisitionRequest,
    ) -> VillageAcquisitionResponse:
        """
        Executes the acquisition workflow across requested GIS sources.
        """
        acquisition_id = f"acq_{uuid.uuid4().hex[:12]}"
        logger.info(
            "Starting acquisition %s for village '%s', state '%s'",
            acquisition_id,
            request.village,
            request.state,
        )

        sources_queried: List[str] = []
        layers_retrieved: List[AcquiredLayerSummary] = []
        feature_counts: Dict[str, int] = {}
        downloaded_files: List[str] = []
        warnings: List[str] = []
        errors: List[str] = []

        active_bbox = request.bounding_box

        # Supported sources map
        valid_sources = {"grammanchitra", "svamitva", "osm"}
        requested_sources = [s.strip().lower() for s in request.sources]

        for s in requested_sources:
            if s not in valid_sources:
                errors.append(f"Unknown GIS source requested: '{s}'. Supported sources are: {sorted(list(valid_sources))}")

        # -------------------------------------------------------------
        # 1. GRAM MANCHITRA ACQUISITION
        # -------------------------------------------------------------
        if "grammanchitra" in requested_sources:
            sources_queried.append("grammanchitra")
            # Query Road (0), Built_Up_Area (1), Parcel_Area (2)
            gm_layers = [
                (0, "Road", "Polygon"),
                (1, "Built_Up_Area", "Polygon"),
                (2, "Parcel_Area", "Polygon"),
            ]

            gm_success_count = 0
            for layer_id, layer_name, geom_type in gm_layers:
                try:
                    result = await self.grammanchitra.acquire_dataset(
                        layer_id=layer_id,
                        village_name=request.village,
                        village_code=request.village_code,
                        bbox=active_bbox,
                        limit=request.max_features_per_layer,
                        acquisition_id=acquisition_id,
                    )

                    if result.success:
                        gm_success_count += 1
                        status = "success" if result.feature_count > 0 else "empty"
                        if result.feature_count == 0:
                            warnings.append(
                                f"Gram Manchitra layer {layer_id} ({layer_name}) returned 0 features for village '{request.village}'."
                            )

                        layers_retrieved.append(
                            AcquiredLayerSummary(
                                source="grammanchitra",
                                layer_id=layer_id,
                                layer_name=layer_name,
                                geometry_type=geom_type,
                                feature_count=result.feature_count,
                                status=status,
                                file_path=result.file_path,
                                raw_file_path=result.metadata_path,
                            )
                        )
                        feature_counts[f"grammanchitra_{layer_name.lower()}"] = result.feature_count
                        if result.file_path:
                            downloaded_files.append(result.file_path)
                        if result.metadata_path:
                            downloaded_files.append(result.metadata_path)

                        # If user didn't provide a bounding box, derive from built-up features!
                        if not active_bbox and result.file_path and result.feature_count > 0:
                            try:
                                with open(result.file_path, "r", encoding="utf-8") as f:
                                    geo_data = json.load(f)
                                derived_box = self._extract_bbox_from_geojson(geo_data)
                                if derived_box:
                                    active_bbox = derived_box
                                    logger.info("Derived village bounding box from Gram Manchitra features: %s", active_bbox)
                            except Exception as e:
                                logger.warning("Could not extract bbox from GeoJSON: %s", e)

                    else:
                        layers_retrieved.append(
                            AcquiredLayerSummary(
                                source="grammanchitra",
                                layer_id=layer_id,
                                layer_name=layer_name,
                                geometry_type=geom_type,
                                feature_count=0,
                                status="failed",
                                error_message=result.error_message,
                            )
                        )
                        errors.append(f"Gram Manchitra layer {layer_id} ({layer_name}) failed: {result.error_message}")

                except Exception as exc:
                    logger.error("Exception querying Gram Manchitra layer %s: %s", layer_id, exc)
                    layers_retrieved.append(
                        AcquiredLayerSummary(
                            source="grammanchitra",
                            layer_id=layer_id,
                            layer_name=layer_name,
                            geometry_type=geom_type,
                            feature_count=0,
                            status="failed",
                            error_message=str(exc),
                        )
                    )
                    errors.append(f"Gram Manchitra layer {layer_id} ({layer_name}) exception: {exc}")

        # -------------------------------------------------------------
        # 2. SVAMITVA ACQUISITION
        # -------------------------------------------------------------
        if "svamitva" in requested_sources:
            sources_queried.append("svamitva")
            # SVAMITVA has Road_Centerline (0), Road_Poly (1)
            # Note: SVAMITVA does not support village_name directly; it requires bbox or district!
            if not active_bbox and not request.district:
                warnings.append(
                    "SVAMITVA vehicle MapServer does not contain village_name or village_code fields. "
                    "Querying SVAMITVA requires a bounding box or district. Layer skipped."
                )
                layers_retrieved.append(
                    AcquiredLayerSummary(
                        source="svamitva",
                        layer_id=0,
                        layer_name="Road_Centerline",
                        geometry_type="LineString",
                        feature_count=0,
                        status="empty",
                        error_message="Missing bounding box or district filter for SVAMITVA query.",
                    )
                )
            else:
                sv_layers = [
                    (0, "Road_Centerline", "LineString"),
                    (1, "Road_Poly", "Polygon"),
                ]
                for layer_id, layer_name, geom_type in sv_layers:
                    try:
                        result = await self.svamitva.acquire_dataset(
                            layer_id=layer_id,
                            bbox=active_bbox,
                            district=request.district,
                            limit=request.max_features_per_layer,
                            acquisition_id=acquisition_id,
                        )

                        if result.success:
                            status = "success" if result.feature_count > 0 else "empty"
                            if result.feature_count == 0:
                                warnings.append(
                                    f"SVAMITVA layer {layer_id} ({layer_name}) returned 0 features."
                                )
                            layers_retrieved.append(
                                AcquiredLayerSummary(
                                    source="svamitva",
                                    layer_id=layer_id,
                                    layer_name=layer_name,
                                    geometry_type=geom_type,
                                    feature_count=result.feature_count,
                                    status=status,
                                    file_path=result.file_path,
                                    raw_file_path=result.metadata_path,
                                )
                            )
                            feature_counts[f"svamitva_{layer_name.lower()}"] = result.feature_count
                            if result.file_path:
                                downloaded_files.append(result.file_path)
                            if result.metadata_path:
                                downloaded_files.append(result.metadata_path)
                        else:
                            layers_retrieved.append(
                                AcquiredLayerSummary(
                                    source="svamitva",
                                    layer_id=layer_id,
                                    layer_name=layer_name,
                                    geometry_type=geom_type,
                                    feature_count=0,
                                    status="failed",
                                    error_message=result.error_message,
                                )
                            )
                            errors.append(f"SVAMITVA layer {layer_id} ({layer_name}) failed: {result.error_message}")
                    except Exception as exc:
                        layers_retrieved.append(
                            AcquiredLayerSummary(
                                source="svamitva",
                                layer_id=layer_id,
                                layer_name=layer_name,
                                geometry_type=geom_type,
                                feature_count=0,
                                status="failed",
                                error_message=str(exc),
                            )
                        )
                        errors.append(f"SVAMITVA layer {layer_id} ({layer_name}) exception: {exc}")

        # -------------------------------------------------------------
        # 3. OPENSTREETMAP ACQUISITION (SUPPLEMENTARY)
        # -------------------------------------------------------------
        if "osm" in requested_sources:
            sources_queried.append("osm")
            if not active_bbox:
                warnings.append("OpenStreetMap Overpass queries require a bounding box. Skipped.")
                layers_retrieved.append(
                    AcquiredLayerSummary(
                        source="osm",
                        layer_id="all",
                        layer_name="OSM_Village_Assets",
                        geometry_type="GeometryCollection",
                        feature_count=0,
                        status="empty",
                        error_message="Bounding box not provided and could not be derived.",
                    )
                )
            else:
                try:
                    result = await self.osm.acquire_dataset(
                        layer_id="all",
                        bbox=active_bbox,
                        limit=request.max_features_per_layer,
                        acquisition_id=acquisition_id,
                    )
                    if result.success:
                        status = "success" if result.feature_count > 0 else "empty"
                        layers_retrieved.append(
                            AcquiredLayerSummary(
                                source="osm",
                                layer_id="all",
                                layer_name="OSM_Village_Assets",
                                geometry_type="GeometryCollection",
                                feature_count=result.feature_count,
                                status=status,
                                file_path=result.file_path,
                                raw_file_path=result.metadata_path,
                            )
                        )
                        feature_counts["osm_village_assets"] = result.feature_count
                        if result.file_path:
                            downloaded_files.append(result.file_path)
                        if result.metadata_path:
                            downloaded_files.append(result.metadata_path)
                    else:
                        layers_retrieved.append(
                            AcquiredLayerSummary(
                                source="osm",
                                layer_id="all",
                                layer_name="OSM_Village_Assets",
                                geometry_type="GeometryCollection",
                                feature_count=0,
                                status="failed",
                                error_message=result.error_message,
                            )
                        )
                        errors.append(f"OSM acquisition failed: {result.error_message}")
                except Exception as exc:
                    layers_retrieved.append(
                        AcquiredLayerSummary(
                            source="osm",
                            layer_id="all",
                            layer_name="OSM_Village_Assets",
                            geometry_type="GeometryCollection",
                            feature_count=0,
                            status="failed",
                            error_message=str(exc),
                        )
                    )
                    errors.append(f"OSM acquisition exception: {exc}")

        # Compute partial success flag
        successful_layers = sum(1 for l in layers_retrieved if l.status == "success")
        failed_or_empty_layers = sum(1 for l in layers_retrieved if l.status in ("failed", "empty"))
        partial_success = (successful_layers > 0 and failed_or_empty_layers > 0)

        village_info = VillageIdentifier(
            state=request.state,
            district=request.district,
            block=request.block,
            gram_panchayat=request.gram_panchayat,
            village=request.village,
            village_code=request.village_code,
            bounding_box=active_bbox,
        )

        return VillageAcquisitionResponse(
            acquisition_id=acquisition_id,
            village=village_info,
            sources_queried=sources_queried,
            layers_retrieved=layers_retrieved,
            feature_counts=feature_counts,
            downloaded_files=downloaded_files,
            crs="EPSG:4326",
            partial_success=partial_success,
            warnings=warnings,
            errors=errors,
        )
