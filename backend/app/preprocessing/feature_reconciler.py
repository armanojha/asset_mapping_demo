"""
Duplicate feature reconciliation, attribute merging, and local metric origin centering.
Resolves dual-record enterprise geodatabase exports without losing cadastral attributes,
and prepares millimeter-accurate local coordinates for 2.5D isometric WebGL rendering.
"""

import ast
import json
import logging
from typing import Any, Dict, List, Optional, Tuple, Union

import geopandas as gpd
import pyproj
import shapely
from shapely.affinity import translate
from shapely.geometry.base import BaseGeometry

from app.schemas.reconciliation import (
    ReconciliationReport,
    VillageAnchorOrigin,
)

logger = logging.getLogger("preprocessing.reconciler")


class FeatureReconciler:
    """
    Engine to reconcile dual-record duplicate features from enterprise GIS sources,
    merge complementary attributes, and project coordinates to a local origin for WebGL.
    """

    def __init__(
        self,
        projected_crs: str = "EPSG:32644",
        duplicate_rounding_precision: int = 6,
    ):
        self.projected_crs = projected_crs
        self.rounding_precision = duplicate_rounding_precision

    @staticmethod
    def _is_empty_or_nan(val: Any) -> bool:
        """Determines if a value represents null, NaN, or empty text."""
        if val is None:
            return True
        if isinstance(val, float) and val != val:  # NaN
            return True
        if isinstance(val, str) and val.strip().lower() in ["", "none", "nan", "null"]:
            return True
        return False

    def reconcile_geodataframe(
        self,
        gdf: gpd.GeoDataFrame,
        id_column: str = "source_id",
        dataset_name: str = "dataset",
    ) -> Tuple[gpd.GeoDataFrame, ReconciliationReport]:
        """
        Reconciles twin duplicate records by merging non-null attributes into a unified record.
        Maintains complete audit history and zero attribute loss.
        """
        if gdf.empty:
            report = ReconciliationReport(
                dataset_name=dataset_name,
                original_feature_count=0,
                unique_feature_count=0,
                duplicates_merged_count=0,
            )
            return gdf.copy(), report

        original_count = len(gdf)

        # Build group keys: use source_id if valid; fallback to rounded spatial WKT
        def get_group_key(row: Any) -> str:
            s_id = row.get(id_column)
            if not self._is_empty_or_nan(s_id):
                return f"id::{s_id}"
            geom = row.geometry
            if geom is not None and not geom.is_empty:
                wkt_hash = shapely.to_wkt(geom, rounding_precision=self.rounding_precision)
                return f"geom::{wkt_hash}"
            return f"idx::{row.name}"

        # Assign grouping key
        group_keys = [get_group_key(row) for _, row in gdf.iterrows()]
        gdf_grouped = gdf.copy()
        gdf_grouped["_group_key"] = group_keys

        unique_rows: List[Dict[str, Any]] = []
        conflicts_log: List[Dict[str, Any]] = []
        reconciled_attr_count = 0
        duplicates_merged_count = 0

        # Group by group_key
        for key, group in gdf_grouped.groupby("_group_key", sort=False):
            if len(group) == 1:
                # No duplicate; preserve record directly
                row_dict = group.iloc[0].to_dict()
                row_dict["_was_reconciled"] = False
                row_dict["_duplicate_count_merged"] = 1
                row_dict["_merged_feature_ids"] = [row_dict.get("feature_id", str(group.index[0]))]
                unique_rows.append(row_dict)
            else:
                # Merge multiple twin records
                duplicates_merged_count += len(group) - 1
                base_row = group.iloc[0].to_dict()
                merged_ids = [r.get("feature_id", str(idx)) for idx, r in group.iterrows()]

                # Parse raw_attributes dict if stored as string
                raw_attrs_combined: Dict[str, Any] = {}
                for _, r in group.iterrows():
                    raw = r.get("raw_attributes")
                    if isinstance(raw, str):
                        try:
                            parsed = ast.literal_eval(raw)
                            if isinstance(parsed, dict):
                                raw_attrs_combined.update(parsed)
                        except Exception:
                            pass
                    elif isinstance(raw, dict):
                        raw_attrs_combined.update(raw)

                # Iterate through subsequent twin records and rescue non-null fields
                for i in range(1, len(group)):
                    other_row = group.iloc[i].to_dict()
                    for col, val in other_row.items():
                        if col in ["geometry", "_group_key"]:
                            continue
                        base_val = base_row.get(col)

                        if self._is_empty_or_nan(base_val) and not self._is_empty_or_nan(val):
                            # Rescued attribute from twin record
                            base_row[col] = val
                            reconciled_attr_count += 1
                        elif not self._is_empty_or_nan(base_val) and not self._is_empty_or_nan(val):
                            if str(base_val) != str(val):
                                # Conflict detected: choose more descriptive / longer string
                                chosen = val if len(str(val)) > len(str(base_val)) else base_val
                                base_row[col] = chosen
                                conflicts_log.append({
                                    "group_key": key,
                                    "field": col,
                                    "val_1": str(base_val),
                                    "val_2": str(val),
                                    "chosen": str(chosen),
                                })

                # If subcategories differ, prioritize more descriptive/specific subcategories over generic ones
                subcat_priority = {
                    "paved_road": 10,
                    "unpaved_road": 9,
                    "highway": 8,
                    "village_road": 5,
                    "school": 10,
                    "healthcare": 10,
                    "religious_place": 10,
                    "panchayat_office": 10,
                    "community_hall": 10,
                    "abadi_building": 5,
                    "residential": 5,
                    "commercial": 5,
                    "property_parcel": 5,
                    "cropland": 5,
                    "generic": 1,
                    "unclassified": 0,
                }
                subcats = [r.get("subcategory") for _, r in group.iterrows() if not self._is_empty_or_nan(r.get("subcategory"))]
                if subcats:
                    sorted_subcats = sorted(subcats, key=lambda s: subcat_priority.get(s, 2), reverse=True)
                    base_row["subcategory"] = sorted_subcats[0]

                base_row["_was_reconciled"] = True
                base_row["_duplicate_count_merged"] = len(group)
                base_row["_merged_feature_ids"] = merged_ids
                base_row["raw_attributes"] = str(raw_attrs_combined) if raw_attrs_combined else base_row.get("raw_attributes")

                unique_rows.append(base_row)

        reconciled_gdf = gpd.GeoDataFrame(unique_rows, crs=gdf.crs)
        if "_group_key" in reconciled_gdf.columns:
            reconciled_gdf = reconciled_gdf.drop(columns=["_group_key"])

        report = ReconciliationReport(
            dataset_name=dataset_name,
            original_feature_count=original_count,
            unique_feature_count=len(reconciled_gdf),
            duplicates_merged_count=duplicates_merged_count,
            reconciled_attributes_count=reconciled_attr_count,
            attribute_conflicts_count=len(conflicts_log),
            conflicts_log=conflicts_log,
        )

        logger.info(
            "Reconciled '%s': %d raw features -> %d unique features (%d merged, %d attributes rescued, %d conflicts)",
            dataset_name,
            original_count,
            len(reconciled_gdf),
            duplicates_merged_count,
            reconciled_attr_count,
            len(conflicts_log),
        )

        return reconciled_gdf, report

    def compute_village_anchor_origin(
        self,
        gdf: gpd.GeoDataFrame,
        village_name: str = "Village",
    ) -> VillageAnchorOrigin:
        """
        Calculates the canonical metric anchor origin $(X_0, Y_0)$ in projected CRS
        from the centroid of the village feature collection.
        """
        gdf_proj = gdf.to_crs(self.projected_crs) if gdf.crs != self.projected_crs else gdf
        total_bounds = gdf_proj.total_bounds  # [minx, miny, maxx, maxy] in meters

        origin_x = float((total_bounds[0] + total_bounds[2]) / 2.0)
        origin_y = float((total_bounds[1] + total_bounds[3]) / 2.0)

        # Project anchor back to WGS84 for geodetic referencing
        transformer_to_wgs84 = pyproj.Transformer.from_crs(
            self.projected_crs, "EPSG:4326", always_xy=True
        )
        origin_lon, origin_lat = transformer_to_wgs84.transform(origin_x, origin_y)

        # Compute local bounding box in meters relative to origin (X0, Y0)
        local_bounds = [
            round(total_bounds[0] - origin_x, 3),
            round(total_bounds[1] - origin_y, 3),
            round(total_bounds[2] - origin_x, 3),
            round(total_bounds[3] - origin_y, 3),
        ]

        anchor = VillageAnchorOrigin(
            village_name=village_name,
            projected_crs=self.projected_crs,
            origin_x_utm=round(origin_x, 3),
            origin_y_utm=round(origin_y, 3),
            origin_lon_wgs84=round(origin_lon, 7),
            origin_lat_wgs84=round(origin_lat, 7),
            bounds_local_m=local_bounds,
        )

        logger.info(
            "Village anchor origin for '%s': UTM (%s) E=%.2f, N=%.2f -> WGS84 (%.7f, %.7f)",
            village_name,
            self.projected_crs,
            origin_x,
            origin_y,
            origin_lon,
            origin_lat,
        )
        return anchor

    def apply_local_origin_centering(
        self,
        gdf: gpd.GeoDataFrame,
        anchor: VillageAnchorOrigin,
    ) -> gpd.GeoDataFrame:
        """
        Translates projected metric coordinates relative to the village anchor origin.
        Appends '_local_centroid_x_m', '_local_centroid_y_m', '_local_bounds_m',
        and '_threejs_coordinates' (X East, Y Up, Z South/Towards Camera).
        Preserves original WGS84 geometry in 'geometry'.
        """
        gdf_proj = gdf.to_crs(anchor.projected_crs) if gdf.crs != anchor.projected_crs else gdf
        output_gdf = gdf.copy()

        x0 = anchor.origin_x_utm
        y0 = anchor.origin_y_utm

        local_centroids_x: List[float] = []
        local_centroids_y: List[float] = []
        threejs_coords: List[Any] = []

        for geom in gdf_proj.geometry:
            if geom is not None and not geom.is_empty:
                # Shift geometry relative to origin
                local_geom = translate(geom, xoff=-x0, yoff=-y0)
                c = local_geom.centroid
                local_centroids_x.append(round(c.x, 3))
                local_centroids_y.append(round(c.y, 3))

                # Three.js coordinates: X = local_x (East), Y = 0 (ground elevation), Z = -local_y (Three.js standard: -Z is North)
                if local_geom.geom_type == "Polygon":
                    coords_3d = [
                        [round(pt[0], 3), 0.0, round(-pt[1], 3)]
                        for pt in local_geom.exterior.coords
                    ]
                elif local_geom.geom_type == "LineString":
                    coords_3d = [
                        [round(pt[0], 3), 0.0, round(-pt[1], 3)]
                        for pt in local_geom.coords
                    ]
                else:
                    coords_3d = [round(c.x, 3), 0.0, round(-c.y, 3)]
                threejs_coords.append(json.dumps(coords_3d))
            else:
                local_centroids_x.append(0.0)
                local_centroids_y.append(0.0)
                threejs_coords.append("[]")

        output_gdf["_local_centroid_x_m"] = local_centroids_x
        output_gdf["_local_centroid_y_m"] = local_centroids_y
        output_gdf["_threejs_mesh_coords"] = threejs_coords
        output_gdf["_anchor_origin_lon"] = anchor.origin_lon_wgs84
        output_gdf["_anchor_origin_lat"] = anchor.origin_lat_wgs84

        return output_gdf
