"""
Unit tests for duplicate feature reconciliation, attribute merging, and local origin centering.
"""

import geopandas as gpd
import pytest
from shapely.geometry import Point, Polygon

from app.preprocessing.feature_reconciler import FeatureReconciler
from app.schemas.reconciliation import VillageAnchorOrigin


def test_reconcile_twin_records_attribute_merging():
    """Verify twin records are merged, rescuing non-null fields and choosing specific subcategory."""
    reconciler = FeatureReconciler()

    poly = Polygon([(79.083, 23.118), (79.084, 23.118), (79.084, 23.119), (79.083, 23.119), (79.083, 23.118)])

    # Record 0: missing pavement and name
    r0 = {
        "source_id": "guid-999",
        "feature_id": "feat_0",
        "category": "ROADS",
        "subcategory": "village_road",
        "pavement": None,
        "name": None,
        "road_type": 9,
        "geometry": poly,
    }
    # Record 1: populated pavement and name
    r1 = {
        "source_id": "guid-999",
        "feature_id": "feat_1",
        "category": "ROADS",
        "subcategory": "paved_road",
        "pavement": "PAVED",
        "name": "Main Street",
        "road_type": 9,
        "geometry": poly,
    }

    gdf = gpd.GeoDataFrame([r0, r1], crs="EPSG:4326")

    reconciled_gdf, report = reconciler.reconcile_geodataframe(
        gdf=gdf,
        id_column="source_id",
        dataset_name="test_roads",
    )

    assert report.original_feature_count == 2
    assert report.unique_feature_count == 1
    assert report.duplicates_merged_count == 1
    assert report.reconciled_attributes_count >= 2

    # Check merged row values
    merged_row = reconciled_gdf.iloc[0]
    assert merged_row["pavement"] == "PAVED"
    assert merged_row["name"] == "Main Street"
    assert merged_row["subcategory"] == "paved_road"
    assert bool(merged_row["_was_reconciled"]) is True
    assert merged_row["_duplicate_count_merged"] == 2
    assert "feat_0" in merged_row["_merged_feature_ids"]
    assert "feat_1" in merged_row["_merged_feature_ids"]


def test_reconcile_singleton_record():
    """Verify single records without duplicates remain preserved and tagged."""
    reconciler = FeatureReconciler()
    poly = Polygon([(79.083, 23.118), (79.084, 23.118), (79.084, 23.119), (79.083, 23.119), (79.083, 23.118)])

    gdf = gpd.GeoDataFrame(
        [{"source_id": "unique-1", "feature_id": "f1", "name": "Solo House", "geometry": poly}],
        crs="EPSG:4326",
    )

    reconciled_gdf, report = reconciler.reconcile_geodataframe(gdf)

    assert len(reconciled_gdf) == 1
    assert report.duplicates_merged_count == 0
    assert bool(reconciled_gdf.iloc[0]["_was_reconciled"]) is False


def test_village_anchor_origin_and_local_centering():
    """Verify calculating village anchor and shifting geometries to local metric origin."""
    reconciler = FeatureReconciler(projected_crs="EPSG:32644")

    # Box around central India: 79.080, 23.110 to 79.090, 23.120
    p1 = Polygon([(79.080, 23.110), (79.085, 23.110), (79.085, 23.115), (79.080, 23.115), (79.080, 23.110)])
    p2 = Polygon([(79.085, 23.115), (79.090, 23.115), (79.090, 23.120), (79.085, 23.120), (79.085, 23.115)])

    gdf = gpd.GeoDataFrame([{"name": "SouthWest", "geometry": p1}, {"name": "NorthEast", "geometry": p2}], crs="EPSG:4326")

    anchor = reconciler.compute_village_anchor_origin(gdf, village_name="TestVillage")

    assert anchor.village_name == "TestVillage"
    assert anchor.origin_x_utm > 0.0
    assert anchor.origin_y_utm > 0.0
    assert 79.08 < anchor.origin_lon_wgs84 < 79.09
    assert 23.11 < anchor.origin_lat_wgs84 < 23.12

    # Centering
    centered_gdf = reconciler.apply_local_origin_centering(gdf, anchor)

    assert "_local_centroid_x_m" in centered_gdf.columns
    assert "_local_centroid_y_m" in centered_gdf.columns
    assert "_threejs_mesh_coords" in centered_gdf.columns

    # p1 is southwest of center, so its local X and Y should be negative
    assert centered_gdf.iloc[0]["_local_centroid_x_m"] < 0
    assert centered_gdf.iloc[0]["_local_centroid_y_m"] < 0

    # p2 is northeast of center, so its local X and Y should be positive
    assert centered_gdf.iloc[1]["_local_centroid_x_m"] > 0
    assert centered_gdf.iloc[1]["_local_centroid_y_m"] > 0
