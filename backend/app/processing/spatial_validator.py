"""
Spatial validation and boundary alignment module for the unified processing pipeline.
Performs containment, intersection, metric distance evaluation, non-destructive clipping,
and explicit road-building overlap detection.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

import geopandas as gpd
from shapely.geometry.base import BaseGeometry

from app.preprocessing.spatial_validator import SpatialValidator as BaseSpatialValidator
from app.schemas.spatial_validation import (
    BoundaryDefinition,
    BoundaryType,
    SpatialValidationReport,
)

logger = logging.getLogger("processing.spatial_validator")


class SpatialValidator(BaseSpatialValidator):
    """
    Enhanced spatial validator for the unified pipeline.
    Validates features against village boundaries, checks spatial overlaps,
    and detects rural building-road encroachments.
    """

    def detect_building_road_overlaps(
        self,
        building_gdf: gpd.GeoDataFrame,
        road_gdf: gpd.GeoDataFrame,
    ) -> Tuple[gpd.GeoDataFrame, Dict[str, Any]]:
        """
        Detects building eaves / verandah encroachments over road surface polygons (Threat 1).
        Flags overlapping buildings with '_has_road_overlap' and '_road_overlap_area_sqm'.
        Never alters building or road geometry; purely tags for 3D plinth elevation staging.
        """
        if building_gdf.empty or road_gdf.empty:
            audited = building_gdf.copy()
            audited["_has_road_overlap"] = False
            audited["_road_overlap_area_sqm"] = 0.0
            return audited, {"overlap_count": 0, "total_overlap_area_sqm": 0.0}

        # Project to metric CRS for accurate metric overlap calculation
        b_proj = building_gdf.to_crs(self.projected_crs) if building_gdf.crs != self.projected_crs else building_gdf
        r_proj = road_gdf.to_crs(self.projected_crs) if road_gdf.crs != self.projected_crs else road_gdf

        # Create spatial index on roads
        road_sindex = r_proj.sindex

        has_overlap: List[bool] = []
        overlap_areas: List[float] = []
        total_overlap_sqm = 0.0
        overlap_count = 0

        for b_geom in b_proj.geometry:
            if b_geom is None or b_geom.is_empty or not b_geom.is_valid:
                has_overlap.append(False)
                overlap_areas.append(0.0)
                continue

            matches = list(road_sindex.query(b_geom, predicate="intersects"))
            overlap_area = 0.0
            for r_idx in matches:
                r_geom = r_proj.geometry.iloc[r_idx]
                if r_geom is not None and r_geom.is_valid and not b_geom.touches(r_geom):
                    inter = b_geom.intersection(r_geom)
                    if not inter.is_empty and inter.area > 1e-6:
                        overlap_area += inter.area

            if overlap_area > 1e-6:
                has_overlap.append(True)
                overlap_areas.append(round(overlap_area, 6))
                total_overlap_sqm += overlap_area
                overlap_count += 1
            else:
                has_overlap.append(False)
                overlap_areas.append(0.0)

        audited_gdf = building_gdf.copy()
        audited_gdf["_has_road_overlap"] = has_overlap
        audited_gdf["_road_overlap_area_sqm"] = overlap_areas

        overlap_summary = {
            "total_buildings_evaluated": len(building_gdf),
            "buildings_overlapping_roads": overlap_count,
            "overlap_percentage": round((overlap_count / len(building_gdf)) * 100, 2) if len(building_gdf) > 0 else 0.0,
            "total_overlap_area_sqm": round(total_overlap_sqm, 2),
            "threat_mitigation_applied": "Vertical plinth staging (+0.15m elevation) prevents GPU Z-fighting.",
        }

        logger.info(
            "Road-building overlap detection: %d/%d buildings overlap roads (%.1f%%, %.2f m² total)",
            overlap_count,
            len(building_gdf),
            overlap_summary["overlap_percentage"],
            total_overlap_sqm,
        )

        return audited_gdf, overlap_summary
