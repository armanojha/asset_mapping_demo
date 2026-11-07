"""
CRS validation, detection, and coordinate normalization module.
Ensures no unknown CRS is silently assumed and normalizes datasets to target and projected metric systems.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

import geopandas as gpd
import pyproj
from pyproj.exceptions import CRSError
from shapely.affinity import translate
from shapely.geometry.base import BaseGeometry

from app.schemas.reconciliation import VillageAnchorOrigin

logger = logging.getLogger("processing.crs_normalizer")


class CRSValidationError(ValueError):
    """Raised when a dataset lacks valid, verifiable CRS information."""
    pass


class CRSNormalizer:
    """
    Validates, detects, and normalizes coordinate reference systems.
    Supports geodetic WGS84 (EPSG:4326) and projected metric systems (e.g. UTM Zone 44N EPSG:32644).
    """

    def __init__(
        self,
        target_crs: str = "EPSG:4326",
        projected_crs: str = "EPSG:32644",
    ):
        self.target_crs = target_crs
        self.projected_crs = projected_crs

    def detect_and_validate_crs(
        self,
        gdf: gpd.GeoDataFrame,
        dataset_name: str = "dataset",
    ) -> str:
        """
        Validates that the GeoDataFrame has a valid, verifiable CRS.
        Raises CRSValidationError if CRS is missing or invalid.
        Never silently assumes an unknown CRS.
        """
        if gdf.crs is None:
            err_msg = (
                f"Dataset '{dataset_name}' lacks CRS metadata. "
                "Silent CRS assumption is strictly prohibited by pipeline rules."
            )
            logger.error(err_msg)
            raise CRSValidationError(err_msg)

        try:
            crs_obj = pyproj.CRS.from_user_input(gdf.crs)
            auth_name = crs_obj.to_authority()
            crs_str = f"{auth_name[0]}:{auth_name[1]}" if auth_name else crs_obj.to_string()
            logger.info("Dataset '%s' verified CRS: %s", dataset_name, crs_str)
            return crs_str
        except CRSError as e:
            err_msg = f"Invalid or unparsable CRS for dataset '{dataset_name}': {e}"
            logger.error(err_msg)
            raise CRSValidationError(err_msg) from e

    def normalize_coordinates(
        self,
        gdf: gpd.GeoDataFrame,
        dataset_name: str = "dataset",
    ) -> Tuple[gpd.GeoDataFrame, Dict[str, Any]]:
        """
        Normalizes dataset to target geodetic CRS (EPSG:4326), recording transformation provenance.
        """
        initial_crs_str = self.detect_and_validate_crs(gdf, dataset_name)
        was_reprojected = False

        normalized_gdf = gdf.copy()
        if gdf.crs != self.target_crs:
            logger.info(
                "Reprojecting dataset '%s' from %s to %s",
                dataset_name,
                initial_crs_str,
                self.target_crs,
            )
            normalized_gdf = normalized_gdf.to_crs(self.target_crs)
            was_reprojected = True

        audit = {
            "dataset_name": dataset_name,
            "original_crs": initial_crs_str,
            "target_crs": self.target_crs,
            "was_reprojected": was_reprojected,
            "feature_count": len(normalized_gdf),
        }

        # Inject non-destructive provenance columns
        normalized_gdf["_original_crs"] = initial_crs_str
        normalized_gdf["_normalized_crs"] = self.target_crs

        return normalized_gdf, audit

    def compute_village_anchor_origin(
        self,
        gdf: gpd.GeoDataFrame,
        village_name: str = "Village",
    ) -> VillageAnchorOrigin:
        """
        Calculates the canonical metric anchor origin $(X_0, Y_0)$ in projected CRS
        from the centroid of the village feature collection.
        Prevents WebGL 32-bit floating point vertex jitter.
        """
        gdf_proj = gdf.to_crs(self.projected_crs) if gdf.crs != self.projected_crs else gdf
        total_bounds = gdf_proj.total_bounds  # [minx, miny, maxx, maxy] in meters

        origin_x = float((total_bounds[0] + total_bounds[2]) / 2.0)
        origin_y = float((total_bounds[1] + total_bounds[3]) / 2.0)

        # Reverse anchor to WGS84
        transformer = pyproj.Transformer.from_crs(self.projected_crs, "EPSG:4326", always_xy=True)
        origin_lon, origin_lat = transformer.transform(origin_x, origin_y)

        local_bounds = [
            round(total_bounds[0] - origin_x, 3),
            round(total_bounds[1] - origin_y, 3),
            round(total_bounds[2] - origin_x, 3),
            round(total_bounds[3] - origin_y, 3),
        ]

        return VillageAnchorOrigin(
            village_name=village_name,
            projected_crs=self.projected_crs,
            origin_x_utm=round(origin_x, 3),
            origin_y_utm=round(origin_y, 3),
            origin_lon_wgs84=round(origin_lon, 7),
            origin_lat_wgs84=round(origin_lat, 7),
            bounds_local_m=local_bounds,
        )

    def attach_local_metric_coordinates(
        self,
        gdf: gpd.GeoDataFrame,
        anchor: VillageAnchorOrigin,
    ) -> gpd.GeoDataFrame:
        """
        Translates projected coordinates relative to the canonical village origin.
        Appends local metric coordinates and Three.js camera mesh offsets.
        """
        gdf_proj = gdf.to_crs(anchor.projected_crs) if gdf.crs != anchor.projected_crs else gdf
        output_gdf = gdf.copy()

        x0 = anchor.origin_x_utm
        y0 = anchor.origin_y_utm

        local_c_x: List[float] = []
        local_c_y: List[float] = []

        for geom in gdf_proj.geometry:
            if geom is not None and not geom.is_empty:
                local_geom = translate(geom, xoff=-x0, yoff=-y0)
                c = local_geom.centroid
                local_c_x.append(round(c.x, 3))
                local_c_y.append(round(c.y, 3))
            else:
                local_c_x.append(0.0)
                local_c_y.append(0.0)

        output_gdf["_local_x_m"] = local_c_x
        output_gdf["_local_y_m"] = local_c_y
        output_gdf["_anchor_crs"] = anchor.projected_crs
        output_gdf["_anchor_x_utm"] = x0
        output_gdf["_anchor_y_utm"] = y0

        return output_gdf
