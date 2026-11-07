"""
Feature classification module for the unified processing pipeline.
Standardizes heterogeneous features into 9 canonical categories,
enforces zero-assumption classification, and synthesizes vertical tiers and procedural heights.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple, Union

import geopandas as gpd

from app.preprocessing.feature_classifier import FeatureClassifier as BaseFeatureClassifier
from app.schemas.classification import (
    ClassificationReport,
    PrimaryCategory,
    StandardizedFeatureCollection,
)

logger = logging.getLogger("processing.feature_classifier")


class FeatureClassifier(BaseFeatureClassifier):
    """
    Enhanced feature classification engine for the unified pipeline.
    Maps source features to canonical schemas and synthesizes vertical tiers
    to eliminate WebGL Z-fighting and missing height data.
    """

    @staticmethod
    def synthesize_vertical_tier(category: PrimaryCategory) -> Tuple[int, float, str]:
        """
        Synthesizes vertical layer staging to prevent GPU Z-fighting in 3D rendering.
        Returns: (vertical_tier, plinth_elevation_meters, batch_layer)
        """
        if category == PrimaryCategory.BUILDINGS or category == PrimaryCategory.COMMUNITY_ASSETS:
            return 1, 0.15, "building_extrusion_batch"
        elif category == PrimaryCategory.ROADS:
            return 0, 0.00, "road_surface_batch"
        elif category == PrimaryCategory.LAND_PARCELS or category == PrimaryCategory.AGRICULTURAL_LAND:
            return 0, -0.01, "cadastral_parcel_batch"
        elif category == PrimaryCategory.WATER_BODIES:
            return -1, -0.20, "water_body_batch"
        elif category == PrimaryCategory.VEGETATION:
            return 0, 0.00, "foliage_batch"
        else:
            return -1, -0.05, "terrain_ground_batch"

    @staticmethod
    def synthesize_procedural_building_height(
        category: PrimaryCategory,
        footprint_area_sqm: Optional[float],
        existing_floors: Optional[int] = None,
    ) -> Tuple[float, str, int]:
        """
        Solves Threat 2 (Missing Building Heights) deterministically.
        Uses footprint area to infer realistic vernacular building height and roof typology.
        Returns: (height_meters, roof_type, stories)
        """
        if category not in [PrimaryCategory.BUILDINGS, PrimaryCategory.COMMUNITY_ASSETS]:
            return 0.0, "flat", 0

        if existing_floors and existing_floors > 0:
            return round(existing_floors * 3.2, 1), "flat_terrace", existing_floors

        area = footprint_area_sqm or 60.0  # sensible default if unpopulated

        if area < 40.0:
            # Small cottage / shed
            return 3.0, "pitched_thatch", 1
        elif area <= 150.0:
            # Standard rural homestead
            return 4.5, "pitched_tile", 1
        else:
            # Substantial multi-room homestead / institutional hall
            return 7.0, "flat_terrace", 2

    def classify_geodataframe_with_vertical_staging(
        self,
        gdf: gpd.GeoDataFrame,
        source_name: str,
        source_layer: Optional[str] = None,
        id_column: Optional[str] = "uniq_id",
        dataset_name: str = "dataset",
    ) -> Tuple[StandardizedFeatureCollection, gpd.GeoDataFrame, ClassificationReport]:
        """
        Classifies GeoDataFrame into standardized features and appends vertical layer staging
        and procedural height attributes for procedural 3D generation.
        """
        collection, report = self.classify_geodataframe(
            gdf=gdf,
            source_name=source_name,
            source_layer=source_layer,
            id_column=id_column,
            dataset_name=dataset_name,
        )

        geojson_features = [f.to_geojson_feature() for f in collection.features]
        classified_gdf = gpd.GeoDataFrame.from_features(geojson_features, crs=gdf.crs)

        vertical_tiers: List[int] = []
        plinths_m: List[float] = []
        batch_layers: List[str] = []
        heights_m: List[float] = []
        roof_types: List[str] = []
        stories_list: List[int] = []

        for _, row in classified_gdf.iterrows():
            cat_str = row.get("category", "OTHER")
            try:
                cat = PrimaryCategory(cat_str)
            except ValueError:
                cat = PrimaryCategory.OTHER

            # Extract area
            area = row.get("st_area(shape)")
            if area is None or (isinstance(area, float) and area != area):
                area = row.geometry.area if row.geometry else None

            # Vertical staging
            v_tier, plinth_m, b_layer = self.synthesize_vertical_tier(cat)
            height_m, roof_t, stories = self.synthesize_procedural_building_height(cat, area)

            vertical_tiers.append(v_tier)
            plinths_m.append(plinth_m)
            batch_layers.append(b_layer)
            heights_m.append(height_m)
            roof_types.append(roof_t)
            stories_list.append(stories)

        classified_gdf["_vertical_tier"] = vertical_tiers
        classified_gdf["_plinth_elevation_m"] = plinths_m
        classified_gdf["_batch_layer"] = batch_layers
        classified_gdf["_procedural_height_m"] = heights_m
        classified_gdf["_procedural_roof_type"] = roof_types
        classified_gdf["_procedural_stories"] = stories_list

        logger.info(
            "Synthesized vertical staging for '%s': tiers=%s, heights=%s",
            dataset_name,
            set(vertical_tiers),
            set(heights_m),
        )

        return collection, classified_gdf, report
