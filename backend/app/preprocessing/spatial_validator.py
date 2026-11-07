"""
Spatial validation and boundary alignment module.
Performs topological relationship evaluation (containment, intersection, distance),
non-destructive boundary clipping, and spatial quality reporting in projected metric CRS.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple, Union

import geopandas as gpd
import pyproj
import shapely
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform, unary_union

from app.schemas.spatial_validation import (
    BoundaryDefinition,
    BoundaryType,
    ClippingStatus,
    FeatureSpatialAudit,
    SpatialRelationStatus,
    SpatialValidationReport,
)

logger = logging.getLogger("preprocessing.spatial_validator")


class SpatialValidator:
    """
    Spatial validation engine for the Village Asset Mapping System.
    Validates geographical features relative to village boundary using metric projected CRS.
    """

    def __init__(
        self,
        projected_crs: str = "EPSG:32644",
        outlier_distance_threshold_m: float = 500.0,
    ):
        """
        Args:
            projected_crs: Metric projected CRS (default EPSG:32644, UTM Zone 44N for central India / MP).
            outlier_distance_threshold_m: Distance in meters beyond which outside features are flagged as suspicious outliers.
        """
        self.projected_crs = projected_crs
        self.outlier_threshold_m = outlier_distance_threshold_m

    @staticmethod
    def derive_boundary_from_features(
        gdf: gpd.GeoDataFrame,
        village_name: str = "Village",
        buffer_meters: float = 10.0,
        projected_crs: str = "EPSG:32644",
    ) -> Tuple[BaseGeometry, BoundaryDefinition]:
        """
        Derives an estimated village boundary when no official boundary polygon exists.
        Computes the unified hull of village cadastral parcels / built-up areas.
        Explicitly tags boundary_type as DERIVED_CADASTRAL_HULL (is_verified=False).
        """
        if gdf.empty:
            empty_poly = Polygon()
            definition = BoundaryDefinition(
                boundary_name=f"{village_name} (Empty)",
                boundary_type=BoundaryType.DERIVED_CADASTRAL_HULL,
                is_verified=False,
                notes="Cannot derive boundary: input feature collection is empty.",
            )
            return empty_poly, definition

        # Project to metric CRS for accurate metric buffer and hull
        gdf_proj = gdf.to_crs(projected_crs) if gdf.crs != projected_crs else gdf
        valid_geoms = [g for g in gdf_proj.geometry if g is not None and not g.is_empty and g.is_valid]

        if not valid_geoms:
            empty_poly = Polygon()
            definition = BoundaryDefinition(
                boundary_name=f"{village_name} (Invalid)",
                boundary_type=BoundaryType.DERIVED_CADASTRAL_HULL,
                is_verified=False,
                notes="No valid geometries available to derive boundary.",
            )
            return empty_poly, definition

        unified = unary_union(valid_geoms)
        # Apply convex hull or concave hull with a modest buffer to bridge settlement gaps
        hull_proj = unified.convex_hull.buffer(buffer_meters)

        # Reproject back to WGS84 EPSG:4326 for storage
        transformer = pyproj.Transformer.from_crs(projected_crs, "EPSG:4326", always_xy=True)
        hull_wgs84 = transform(transformer.transform, hull_proj)

        area_sqm = float(hull_proj.area)
        bounds_wgs84 = list(hull_wgs84.bounds)

        definition = BoundaryDefinition(
            boundary_name=f"{village_name} (Derived Cadastral Hull)",
            boundary_type=BoundaryType.DERIVED_CADASTRAL_HULL,
            is_verified=False,
            source_layer="derived_from_features",
            crs="EPSG:4326",
            area_sqm=area_sqm,
            bounding_box=bounds_wgs84,
            notes=(
                "DERIVED BOUNDARY: No standalone revenue village boundary was supplied. "
                "Derived from cadastral parcel / built-up extent via convex hull with 10m buffer. "
                "Must NOT be confused with administrative Gram Panchayat boundary."
            ),
        )
        return hull_wgs84, definition

    def validate_dataset(
        self,
        gdf: gpd.GeoDataFrame,
        boundary_geom: BaseGeometry,
        boundary_definition: BoundaryDefinition,
        village_identifier: str = "village",
        id_column: Optional[str] = "feature_id",
        category_column: Optional[str] = "category",
    ) -> Tuple[gpd.GeoDataFrame, SpatialValidationReport]:
        """
        Evaluates spatial relationships for all features in gdf against boundary_geom.
        Calculates within, intersects, and metric distances in projected_crs.
        Returns audited GeoDataFrame and comprehensive SpatialValidationReport.
        """
        if gdf.empty:
            report = SpatialValidationReport(
                village_identifier=village_identifier,
                boundary_used=boundary_definition,
                projected_crs=self.projected_crs,
                total_features_evaluated=0,
            )
            return gdf.copy(), report

        # Ensure metric projection for distance and containment
        gdf_wgs84 = gdf.to_crs("EPSG:4326") if gdf.crs != "EPSG:4326" else gdf
        gdf_proj = gdf.to_crs(self.projected_crs)

        # Project boundary to metric CRS
        transformer_to_proj = pyproj.Transformer.from_crs("EPSG:4326", self.projected_crs, always_xy=True)
        boundary_proj = transform(transformer_to_proj.transform, boundary_geom)

        audits: List[FeatureSpatialAudit] = []
        relation_statuses: List[str] = []
        distances_m: List[float] = []
        suspicious_flags: List[bool] = []

        inside_count = 0
        crossing_count = 0
        outside_count = 0
        suspicious_count = 0

        cat_breakdown: Dict[str, Dict[str, int]] = {}

        id_series = (
            gdf_wgs84[id_column]
            if (id_column and id_column in gdf_wgs84.columns)
            else gdf_wgs84.index
        )
        cat_series = (
            gdf_wgs84[category_column]
            if (category_column and category_column in gdf_wgs84.columns)
            else ["OTHER"] * len(gdf_wgs84)
        )

        for idx, (geom_proj, feat_id, cat_val) in enumerate(
            zip(gdf_proj.geometry, id_series, cat_series)
        ):
            cat_str = str(cat_val)
            if cat_str not in cat_breakdown:
                cat_breakdown[cat_str] = {
                    "fully_inside": 0,
                    "intersecting_crossing": 0,
                    "outside": 0,
                    "suspicious_outlier": 0,
                }

            if geom_proj is None or geom_proj.is_empty:
                status = SpatialRelationStatus.OUTSIDE
                dist_m = 0.0
                suspicious = True
                reason = "Geometry is null or empty"
            else:
                # 1. Topological containment
                is_within = bool(boundary_proj.contains(geom_proj))
                is_intersects = bool(boundary_proj.intersects(geom_proj))

                if is_within:
                    status = SpatialRelationStatus.FULLY_INSIDE
                    dist_m = 0.0
                    suspicious = False
                    reason = None
                    inside_count += 1
                    cat_breakdown[cat_str]["fully_inside"] += 1
                elif is_intersects:
                    status = SpatialRelationStatus.INTERSECTING_CROSSING
                    dist_m = 0.0
                    suspicious = False
                    reason = None
                    crossing_count += 1
                    cat_breakdown[cat_str]["intersecting_crossing"] += 1
                else:
                    status = SpatialRelationStatus.OUTSIDE
                    # Metric distance calculation
                    dist_m = float(boundary_proj.distance(geom_proj))
                    suspicious = dist_m > self.outlier_threshold_m
                    reason = (
                        f"Feature is {dist_m:.1f}m outside village boundary"
                        if not suspicious
                        else f"Outlier feature: {dist_m:.1f}m outside boundary (threshold={self.outlier_threshold_m}m)"
                    )
                    outside_count += 1
                    cat_breakdown[cat_str]["outside"] += 1
                    if suspicious:
                        suspicious_count += 1
                        cat_breakdown[cat_str]["suspicious_outlier"] += 1

            audit = FeatureSpatialAudit(
                feature_id=str(feat_id),
                source_id=gdf_wgs84.iloc[idx].get("source_id", feat_id),
                category=cat_str,
                spatial_relation=status,
                distance_to_boundary_meters=round(dist_m, 2),
                clipping_status=ClippingStatus.NOT_CLIPPED,
                area_original_sqm=round(geom_proj.area, 2) if geom_proj else None,
                is_suspicious=suspicious,
                suspicious_reason=reason,
            )
            audits.append(audit)
            relation_statuses.append(status.value)
            distances_m.append(round(dist_m, 2))
            suspicious_flags.append(suspicious)

        # Assemble audited GeoDataFrame
        audited_gdf = gdf_wgs84.copy()
        audited_gdf["_spatial_relation"] = relation_statuses
        audited_gdf["_spatial_distance_m"] = distances_m
        audited_gdf["_spatial_is_suspicious"] = suspicious_flags

        # Diagnostics for potential source alignment issues
        alignment_issues: List[str] = []
        if outside_count > 0:
            outside_pct = (outside_count / len(gdf_wgs84)) * 100
            if outside_pct > 20.0:
                alignment_issues.append(
                    f"High outside percentage ({outside_pct:.1f}%): Possible coordinate offset, CRS mismatch, or boundary undersizing."
                )
        if suspicious_count > 0:
            alignment_issues.append(
                f"{suspicious_count} features exceed outlier distance threshold ({self.outlier_threshold_m}m). Check for stray village coordinates."
            )

        report = SpatialValidationReport(
            village_identifier=village_identifier,
            boundary_used=boundary_definition,
            projected_crs=self.projected_crs,
            total_features_evaluated=len(gdf_wgs84),
            fully_inside_count=inside_count,
            partially_intersecting_count=crossing_count,
            outside_count=outside_count,
            suspicious_outlier_count=suspicious_count,
            category_spatial_breakdown=cat_breakdown,
            potential_alignment_issues=alignment_issues,
            audits=audits,
        )

        logger.info(
            "Spatial validation for '%s': total=%d, inside=%d, crossing=%d, outside=%d, suspicious=%d",
            village_identifier,
            len(gdf_wgs84),
            inside_count,
            crossing_count,
            outside_count,
            suspicious_count,
        )

        return audited_gdf, report

    def clip_dataset(
        self,
        gdf: gpd.GeoDataFrame,
        boundary_geom: BaseGeometry,
        boundary_definition: BoundaryDefinition,
        id_column: Optional[str] = "feature_id",
    ) -> Tuple[gpd.GeoDataFrame, List[FeatureSpatialAudit]]:
        """
        Performs non-destructive clipping of features against the village boundary.
        Features crossing the boundary are intersected while preserving original geometry in '_original_geom_wkt'.
        Features outside are retained with clipping_status='outside_unclipped' (NEVER discarded).
        """
        gdf_wgs84 = gdf.to_crs("EPSG:4326") if gdf.crs != "EPSG:4326" else gdf.copy()
        output_gdf = gdf_wgs84.copy()

        clipped_geoms: List[BaseGeometry] = []
        clipping_statuses: List[str] = []
        original_wkts: List[str] = []
        clipped_audits: List[FeatureSpatialAudit] = []

        id_series = (
            gdf_wgs84[id_column]
            if (id_column and id_column in gdf_wgs84.columns)
            else gdf_wgs84.index
        )

        for idx, (geom, feat_id) in enumerate(zip(gdf_wgs84.geometry, id_series)):
            orig_wkt = geom.wkt if geom is not None else ""
            original_wkts.append(orig_wkt)

            if geom is None or geom.is_empty:
                clipped_geoms.append(geom)
                clipping_statuses.append(ClippingStatus.NOT_CLIPPED.value)
                continue

            if boundary_geom.contains(geom):
                # Fully inside: no clipping needed
                clipped_geoms.append(geom)
                clipping_statuses.append(ClippingStatus.NOT_CLIPPED.value)
                status = ClippingStatus.NOT_CLIPPED
                clipped_area = None
            elif boundary_geom.intersects(geom):
                # Crossing feature: perform intersection while preserving original
                try:
                    inter_geom = geom.intersection(boundary_geom)
                    if not inter_geom.is_empty:
                        clipped_geoms.append(inter_geom)
                        status = ClippingStatus.CLIPPED_CROSSING
                    else:
                        clipped_geoms.append(geom)
                        status = ClippingStatus.NOT_CLIPPED
                except Exception as e:
                    logger.warning("Intersection failed on feature %s: %s; retaining original", feat_id, e)
                    clipped_geoms.append(geom)
                    status = ClippingStatus.NOT_CLIPPED

                clipping_statuses.append(status.value)
            else:
                # Outside: Retain original geometry non-destructively
                clipped_geoms.append(geom)
                status = ClippingStatus.OUTSIDE_UNCLIPPED
                clipping_statuses.append(status.value)

            audit = FeatureSpatialAudit(
                feature_id=str(feat_id),
                source_id=gdf_wgs84.iloc[idx].get("source_id", feat_id),
                category=str(gdf_wgs84.iloc[idx].get("category", "OTHER")),
                spatial_relation=(
                    SpatialRelationStatus.FULLY_INSIDE if status == ClippingStatus.NOT_CLIPPED and boundary_geom.contains(geom)
                    else SpatialRelationStatus.INTERSECTING_CROSSING if status == ClippingStatus.CLIPPED_CROSSING
                    else SpatialRelationStatus.OUTSIDE
                ),
                clipping_status=status,
            )
            clipped_audits.append(audit)

        output_gdf["geometry"] = clipped_geoms
        output_gdf["_original_geom_wkt"] = original_wkts
        output_gdf["_clipping_status"] = clipping_statuses

        logger.info(
            "Clipped dataset non-destructively: %d total rows preserved (clipped crossing=%d, outside kept=%d)",
            len(output_gdf),
            clipping_statuses.count(ClippingStatus.CLIPPED_CROSSING.value),
            clipping_statuses.count(ClippingStatus.OUTSIDE_UNCLIPPED.value),
        )

        return output_gdf, clipped_audits
