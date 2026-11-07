import logging
from typing import Any, Dict, List, Optional, Set, Tuple, Union

import geopandas as gpd
import shapely
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
)
from shapely.geometry.base import BaseGeometry
from shapely.geometry.polygon import orient
from shapely.validation import explain_validity

from app.schemas.preprocessing import (
    FeatureGeometryAudit,
    GeometryRepairReport,
    GeometryValidationStatus,
)

logger = logging.getLogger("preprocessing.cleaner")


class GeometryCleaner:
    """
    Controlled geometry validation, repair, and normalization module
    adhering strictly to non-destructive spatial processing principles.
    """

    ALLOWED_TYPES: Dict[str, Set[str]] = {
        "building": {"Polygon", "MultiPolygon"},
        "parcel": {"Polygon", "MultiPolygon"},
        "boundary": {"Polygon", "MultiPolygon"},
        "road": {"LineString", "MultiLineString", "Polygon", "MultiPolygon"},
        "water": {"Polygon", "MultiPolygon", "LineString", "MultiLineString"},
        "amenity": {"Point", "Polygon", "MultiPolygon", "LineString"},
        "generic": {"Polygon", "MultiPolygon", "LineString", "MultiLineString", "Point", "MultiPoint"},
    }

    def __init__(
        self,
        buffer_tolerance: float = 0.01,
        duplicate_rounding_precision: int = 6,
    ):
        """
        Args:
            buffer_tolerance: Maximum allowable fractional area difference (|new_area - orig_area| / orig_area)
                             when applying buffer(0) as a justified fallback.
            duplicate_rounding_precision: Coordinate rounding precision in decimal degrees (~6 places = ~10cm in WGS84)
                                         used for spatial duplicate hashing to handle floating-point jitter
                                         in enterprise GIS exports.
        """
        self.buffer_tolerance = buffer_tolerance
        self.duplicate_rounding_precision = duplicate_rounding_precision

    @staticmethod
    def _normalize_polygon(poly: Polygon) -> Polygon:
        """
        Normalizes a polygon by ensuring counter-clockwise (CCW) exterior ring
        and clockwise (CW) interior rings (holes).
        """
        return orient(poly, sign=1.0)

    def _normalize_multipolygon(self, mpoly: MultiPolygon) -> MultiPolygon:
        """Normalizes each polygon component in a MultiPolygon."""
        cleaned_polys = [self._normalize_polygon(p) for p in mpoly.geoms if not p.is_empty]
        return MultiPolygon(cleaned_polys)

    @staticmethod
    def _normalize_linestring(line: LineString) -> Optional[LineString]:
        """
        Normalizes a LineString by removing consecutive duplicate points
        and zero-length segments.
        """
        unique_coords = []
        for pt in line.coords:
            if not unique_coords or pt != unique_coords[-1]:
                unique_coords.append(pt)

        if len(unique_coords) < 2:
            return None
        return LineString(unique_coords)

    def _normalize_multilinestring(self, mline: MultiLineString) -> Optional[MultiLineString]:
        """Normalizes each line component in a MultiLineString."""
        cleaned_lines = []
        for l in mline.geoms:
            cl = self._normalize_linestring(l)
            if cl is not None:
                cleaned_lines.append(cl)

        if not cleaned_lines:
            return None
        return MultiLineString(cleaned_lines)

    @staticmethod
    def _extract_areal_geometries(geom: BaseGeometry) -> Optional[Union[Polygon, MultiPolygon]]:
        """
        Extracts Polygon and MultiPolygon elements from a GeometryCollection,
        discarding 0-area points/lines without inventing features.
        """
        polys: List[Polygon] = []
        if isinstance(geom, Polygon):
            polys.append(geom)
        elif isinstance(geom, MultiPolygon):
            polys.extend(list(geom.geoms))
        elif isinstance(geom, GeometryCollection):
            for sub_g in geom.geoms:
                if isinstance(sub_g, Polygon):
                    polys.append(sub_g)
                elif isinstance(sub_g, MultiPolygon):
                    polys.extend(list(sub_g.geoms))

        if not polys:
            return None
        if len(polys) == 1:
            return polys[0]
        return MultiPolygon(polys)

    @staticmethod
    def _extract_linear_geometries(geom: BaseGeometry) -> Optional[Union[LineString, MultiLineString]]:
        """
        Extracts LineString and MultiLineString elements from a GeometryCollection.
        """
        lines: List[LineString] = []
        if isinstance(geom, LineString):
            lines.append(geom)
        elif isinstance(geom, MultiLineString):
            lines.extend(list(geom.geoms))
        elif isinstance(geom, GeometryCollection):
            for sub_g in geom.geoms:
                if isinstance(sub_g, LineString):
                    lines.append(sub_g)
                elif isinstance(sub_g, MultiLineString):
                    lines.extend(list(sub_g.geoms))

        if not lines:
            return None
        if len(lines) == 1:
            return lines[0]
        return MultiLineString(lines)

    def clean_single_geometry(
        self,
        geom: Optional[BaseGeometry],
        asset_category: str = "generic",
        source_feature_id: Optional[Union[str, int]] = None,
        feature_index: int = 0,
    ) -> Tuple[Optional[BaseGeometry], FeatureGeometryAudit]:
        """
        Performs controlled validation and repair on an individual geometry.
        """
        cat_lower = asset_category.lower()
        allowed = self.ALLOWED_TYPES.get(cat_lower, self.ALLOWED_TYPES["generic"])

        # 1. Null Geometry Check
        if geom is None:
            return None, FeatureGeometryAudit(
                feature_index=feature_index,
                source_feature_id=source_feature_id,
                original_geom_type=None,
                cleaned_geom_type=None,
                initial_validity=False,
                validity_reason="Null geometry",
                status=GeometryValidationStatus.NULL,
                is_empty_or_null=True,
            )

        # 2. Empty Geometry Check
        if geom.is_empty:
            return geom, FeatureGeometryAudit(
                feature_index=feature_index,
                source_feature_id=source_feature_id,
                original_geom_type=geom.geom_type,
                cleaned_geom_type=geom.geom_type,
                initial_validity=False,
                validity_reason="Empty geometry",
                status=GeometryValidationStatus.EMPTY,
                is_empty_or_null=True,
            )

        orig_type = geom.geom_type
        repair_ops: List[str] = []
        unexpected_warning: Optional[str] = None

        # 3. Category Type Compliance Check
        if orig_type not in allowed:
            unexpected_warning = (
                f"Unexpected geometry type '{orig_type}' for asset category '{asset_category}'. "
                f"Expected one of: {sorted(list(allowed))}"
            )
            logger.warning(
                "Feature %s [id=%s]: %s", feature_index, source_feature_id, unexpected_warning
            )

        initial_valid = bool(geom.is_valid)
        validity_reason = explain_validity(geom) if not initial_valid else "Valid Geometry"

        current_geom: BaseGeometry = geom
        was_repaired = False

        # 4. Controlled Geometry Repair
        if not initial_valid:
            try:
                # Step 4a: make_valid
                candidate = shapely.make_valid(current_geom)
                repair_ops.append("make_valid")

                # Step 4b: Extract relevant geometry type from collections
                if candidate.geom_type == "GeometryCollection":
                    if cat_lower in ["building", "parcel", "boundary"]:
                        areal = self._extract_areal_geometries(candidate)
                        if areal is not None:
                            candidate = areal
                            repair_ops.append("extract_areal_from_collection")
                    elif cat_lower == "road" and orig_type in ["LineString", "MultiLineString"]:
                        linear = self._extract_linear_geometries(candidate)
                        if linear is not None:
                            candidate = linear
                            repair_ops.append("extract_linear_from_collection")

                # Step 4c: Justified buffer(0) fallback
                # Only tested for Polygons/MultiPolygons if make_valid still failed
                # or if make_valid generated unexpected topology
                if not candidate.is_valid and isinstance(current_geom, (Polygon, MultiPolygon)):
                    buf_candidate = current_geom.buffer(0)
                    if buf_candidate.is_valid and not buf_candidate.is_empty:
                        orig_area = current_geom.area
                        new_area = buf_candidate.area
                        area_diff = (
                            abs(new_area - orig_area) / orig_area if orig_area > 0 else 0.0
                        )
                        if area_diff <= self.buffer_tolerance:
                            candidate = buf_candidate
                            repair_ops.append(f"buffer(0) [area_diff={area_diff:.4%}]")
                            logger.info(
                                "Justified buffer(0) applied on feature %s (area change: %.4f%%)",
                                source_feature_id,
                                area_diff * 100,
                            )

                if candidate.is_valid and not candidate.is_empty:
                    current_geom = candidate
                    was_repaired = True
                else:
                    logger.warning(
                        "Geometry repair unsuccessful for feature %s: %s",
                        source_feature_id,
                        explain_validity(candidate),
                    )

            except Exception as exc:
                logger.error("Exception during geometry repair on feature %s: %s", source_feature_id, exc)

        # 5. Normalization (Orientation and Degenerate point pruning)
        if current_geom.is_valid and not current_geom.is_empty:
            if isinstance(current_geom, Polygon):
                current_geom = self._normalize_polygon(current_geom)
                repair_ops.append("orient_ccw_exterior")
            elif isinstance(current_geom, MultiPolygon):
                current_geom = self._normalize_multipolygon(current_geom)
                repair_ops.append("orient_ccw_multipolygon")
            elif isinstance(current_geom, LineString):
                norm_line = self._normalize_linestring(current_geom)
                if norm_line is not None:
                    current_geom = norm_line
                    repair_ops.append("prune_duplicate_vertices")
            elif isinstance(current_geom, MultiLineString):
                norm_mline = self._normalize_multilinestring(current_geom)
                if norm_mline is not None:
                    current_geom = norm_mline
                    repair_ops.append("prune_duplicate_multiline_vertices")

        # 6. Status Determination
        final_valid = bool(current_geom.is_valid)
        if unexpected_warning:
            status = GeometryValidationStatus.UNEXPECTED_TYPE
        elif was_repaired and final_valid:
            status = GeometryValidationStatus.REPAIRED
        elif initial_valid and final_valid:
            status = GeometryValidationStatus.VALID
        else:
            status = GeometryValidationStatus.INVALID_UNREPAIRABLE

        audit = FeatureGeometryAudit(
            feature_index=feature_index,
            source_feature_id=source_feature_id,
            original_geom_type=orig_type,
            cleaned_geom_type=current_geom.geom_type,
            initial_validity=initial_valid,
            validity_reason=validity_reason,
            status=status,
            repair_operations=repair_ops,
            was_repaired=was_repaired,
            is_empty_or_null=False,
            unexpected_type_warning=unexpected_warning,
        )

        return current_geom, audit

    def clean_geodataframe(
        self,
        gdf: gpd.GeoDataFrame,
        asset_category: str = "generic",
        id_column: Optional[str] = "objectid",
        dataset_name: str = "dataset",
    ) -> Tuple[gpd.GeoDataFrame, GeometryRepairReport]:
        """
        Validates and cleans all geometries in a GeoDataFrame,
        injecting provenance tracking fields and returning a comprehensive repair report.
        Never modifies raw files and never silently deletes features.
        """
        if gdf.empty:
            report = GeometryRepairReport(
                dataset_name=dataset_name,
                asset_category=asset_category,
                original_feature_count=0,
            )
            return gdf.copy(), report

        # Create output copy
        cleaned_gdf = gdf.copy()
        original_count = len(cleaned_gdf)

        # Detect duplicate geometries upfront (using coordinate rounding to account for enterprise GIS floating point noise)
        geom_wkt_series = cleaned_gdf.geometry.apply(
            lambda g: shapely.to_wkt(g, rounding_precision=self.duplicate_rounding_precision)
            if (g is not None and not g.is_empty)
            else None
        )
        is_dup_mask = geom_wkt_series.duplicated(keep="first") & geom_wkt_series.notna()
        duplicate_count = int(is_dup_mask.sum())

        cleaned_geoms: List[Optional[BaseGeometry]] = []
        audits: List[FeatureGeometryAudit] = []

        valid_count = 0
        invalid_count = 0
        repaired_count = 0
        unrepairable_count = 0
        empty_count = 0
        null_count = 0
        type_changes: Dict[str, int] = {}
        unexpected_types: Dict[str, int] = {}

        # Resolve ID series
        id_series = (
            cleaned_gdf[id_column]
            if (id_column and id_column in cleaned_gdf.columns)
            else cleaned_gdf.index
        )

        for idx, (original_geom, feat_id) in enumerate(zip(cleaned_gdf.geometry, id_series)):
            cleaned_g, audit = self.clean_single_geometry(
                geom=original_geom,
                asset_category=asset_category,
                source_feature_id=feat_id,
                feature_index=idx,
            )
            cleaned_geoms.append(cleaned_g)
            audits.append(audit)

            # Metrics
            if audit.status == GeometryValidationStatus.NULL:
                null_count += 1
            elif audit.status == GeometryValidationStatus.EMPTY:
                empty_count += 1
            elif audit.initial_validity:
                valid_count += 1
            else:
                invalid_count += 1

            if audit.status == GeometryValidationStatus.REPAIRED:
                repaired_count += 1
            elif audit.status == GeometryValidationStatus.INVALID_UNREPAIRABLE:
                unrepairable_count += 1

            if audit.unexpected_type_warning:
                gtype = audit.original_geom_type or "Unknown"
                unexpected_types[gtype] = unexpected_types.get(gtype, 0) + 1

            # Type changes
            if audit.original_geom_type and audit.cleaned_geom_type:
                if audit.original_geom_type != audit.cleaned_geom_type:
                    transition = f"{audit.original_geom_type} -> {audit.cleaned_geom_type}"
                    type_changes[transition] = type_changes.get(transition, 0) + 1

        # Replace geometry with cleaned geometries
        cleaned_gdf["geometry"] = cleaned_geoms

        # Inject non-destructive provenance columns
        cleaned_gdf["_geom_initial_valid"] = [a.initial_validity for a in audits]
        cleaned_gdf["_geom_was_repaired"] = [a.was_repaired for a in audits]
        cleaned_gdf["_geom_status"] = [a.status.value for a in audits]
        cleaned_gdf["_geom_repair_notes"] = ["; ".join(a.repair_operations) for a in audits]
        cleaned_gdf["_geom_original_type"] = [a.original_geom_type for a in audits]
        cleaned_gdf["_geom_is_duplicate"] = is_dup_mask.values

        report = GeometryRepairReport(
            dataset_name=dataset_name,
            asset_category=asset_category,
            original_feature_count=original_count,
            valid_geometries_count=valid_count,
            invalid_geometries_count=invalid_count,
            repaired_geometries_count=repaired_count,
            unrepairable_geometries_count=unrepairable_count,
            empty_geometries_count=empty_count,
            null_geometries_count=null_count,
            duplicate_geometries_count=duplicate_count,
            removed_geometries_count=0,  # Zero features deleted
            geometry_type_changes=type_changes,
            unexpected_geometry_types=unexpected_types,
            feature_audits=audits,
        )

        logger.info(
            "Cleaned dataset '%s' (%s): %d total, %d valid, %d repaired, %d invalid, %d duplicates",
            dataset_name,
            asset_category,
            original_count,
            valid_count,
            repaired_count,
            unrepairable_count,
            duplicate_count,
        )

        return cleaned_gdf, report
