"""
Unit tests for Spatial Validation, metric calculations, and boundary clipping.
"""

import geopandas as gpd
import pytest
from shapely.geometry import LineString, Point, Polygon

from app.preprocessing.spatial_validator import SpatialValidator
from app.schemas.spatial_validation import (
    BoundaryDefinition,
    BoundaryType,
    ClippingStatus,
    SpatialRelationStatus,
)


def test_derive_boundary_from_features():
    """Verify deriving boundary from feature collection tags as derived and calculates metrics."""
    # Create two parcels in central India (approx lat 23.11, lon 79.08)
    p1 = Polygon([(79.080, 23.110), (79.085, 23.110), (79.085, 23.115), (79.080, 23.115), (79.080, 23.110)])
    p2 = Polygon([(79.084, 23.114), (79.089, 23.114), (79.089, 23.119), (79.084, 23.119), (79.084, 23.114)])

    gdf = gpd.GeoDataFrame({"geometry": [p1, p2]}, crs="EPSG:4326")

    boundary_geom, boundary_def = SpatialValidator.derive_boundary_from_features(
        gdf=gdf,
        village_name="TestVillage",
        buffer_meters=10.0,
        projected_crs="EPSG:32644",
    )

    assert boundary_geom is not None
    assert boundary_geom.is_valid is True
    assert boundary_def.boundary_type == BoundaryType.DERIVED_CADASTRAL_HULL
    assert boundary_def.is_verified is False
    assert boundary_def.area_sqm > 0.0
    assert "DERIVED BOUNDARY" in (boundary_def.notes or "")


def test_spatial_relationships_validation():
    """
    Verify spatial validation categorizes inside, crossing, outside, and suspicious outlier features.
    """
    validator = SpatialValidator(
        projected_crs="EPSG:32644",
        outlier_distance_threshold_m=100.0,  # 100 meters threshold for test
    )

    # Village boundary: 100m x 100m box around (79.080, 23.110)
    # Using small coordinates in projected space for clarity:
    boundary_geom = Polygon([
        (79.080, 23.110),
        (79.090, 23.110),
        (79.090, 23.120),
        (79.080, 23.120),
        (79.080, 23.110),
    ])
    boundary_def = BoundaryDefinition(
        boundary_name="Test Boundary",
        boundary_type=BoundaryType.VERIFIED_ADMINISTRATIVE,
        is_verified=True,
    )

    # 1. Feature fully inside
    inside_poly = Polygon([
        (79.082, 23.112),
        (79.084, 23.112),
        (79.084, 23.114),
        (79.082, 23.114),
        (79.082, 23.112),
    ])

    # 2. Feature crossing boundary (straddles east edge at 79.090)
    crossing_poly = Polygon([
        (79.088, 23.112),
        (79.092, 23.112),
        (79.092, 23.114),
        (79.088, 23.114),
        (79.088, 23.112),
    ])

    # 3. Feature slightly outside (e.g. 50 meters outside)
    outside_poly = Polygon([
        (79.0905, 23.112),
        (79.0910, 23.112),
        (79.0910, 23.114),
        (79.0905, 23.114),
        (79.0905, 23.112),
    ])

    # 4. Feature far away (far outlier > 100m outside)
    outlier_poly = Polygon([
        (79.105, 23.112),
        (79.106, 23.112),
        (79.106, 23.114),
        (79.105, 23.114),
        (79.105, 23.112),
    ])

    gdf = gpd.GeoDataFrame(
        {
            "feature_id": ["f_inside", "f_crossing", "f_outside", "f_outlier"],
            "category": ["BUILDINGS", "ROADS", "LAND_PARCELS", "BUILDINGS"],
            "geometry": [inside_poly, crossing_poly, outside_poly, outlier_poly],
        },
        crs="EPSG:4326",
    )

    audited_gdf, report = validator.validate_dataset(
        gdf=gdf,
        boundary_geom=boundary_geom,
        boundary_definition=boundary_def,
        village_identifier="TestVillage",
    )

    assert len(audited_gdf) == 4
    assert report.total_features_evaluated == 4
    assert report.fully_inside_count == 1
    assert report.partially_intersecting_count == 1
    assert report.outside_count == 2
    assert report.suspicious_outlier_count == 1  # Outlier > 100m

    # Check row-level columns
    statuses = list(audited_gdf["_spatial_relation"])
    assert statuses[0] == SpatialRelationStatus.FULLY_INSIDE.value
    assert statuses[1] == SpatialRelationStatus.INTERSECTING_CROSSING.value
    assert statuses[2] == SpatialRelationStatus.OUTSIDE.value
    assert statuses[3] == SpatialRelationStatus.OUTSIDE.value

    # Distances
    dists = list(audited_gdf["_spatial_distance_m"])
    assert dists[0] == 0.0
    assert dists[1] == 0.0
    assert dists[2] > 0.0
    assert dists[3] > 100.0
    assert bool(audited_gdf.iloc[3]["_spatial_is_suspicious"]) is True


def test_non_destructive_clipping():
    """
    Verify clipping operation clips crossing features while preserving original geometry and outside features.
    """
    validator = SpatialValidator()

    boundary_geom = Polygon([(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)])
    boundary_def = BoundaryDefinition(
        boundary_name="TestBox",
        boundary_type=BoundaryType.VERIFIED_ADMINISTRATIVE,
        is_verified=True,
    )

    # 1. Inside poly (area = 4)
    p_in = Polygon([(2, 2), (4, 2), (4, 4), (2, 4), (2, 2)])
    # 2. Crossing line (line from 5,5 to 15,5)
    l_cross = LineString([(5, 5), (15, 5)])
    # 3. Outside point
    p_out = Point(20, 20)

    gdf = gpd.GeoDataFrame(
        {
            "feature_id": [1, 2, 3],
            "category": ["BUILDINGS", "ROADS", "OTHER"],
            "geometry": [p_in, l_cross, p_out],
        },
        crs="EPSG:4326",
    )

    clipped_gdf, audits = validator.clip_dataset(
        gdf=gdf,
        boundary_geom=boundary_geom,
        boundary_definition=boundary_def,
    )

    # Rule: Zero features discarded
    assert len(clipped_gdf) == 3
    assert len(audits) == 3

    # Inside geometry untouched
    assert clipped_gdf.iloc[0].geometry.equals(p_in)
    assert clipped_gdf.iloc[0]["_clipping_status"] == ClippingStatus.NOT_CLIPPED.value

    # Crossing line clipped from length 10 to length 5
    clipped_line = clipped_gdf.iloc[1].geometry
    assert clipped_line.geom_type == "LineString"
    assert list(clipped_line.coords) == [(5.0, 5.0), (10.0, 5.0)]
    assert clipped_gdf.iloc[1]["_clipping_status"] == ClippingStatus.CLIPPED_CROSSING.value
    # Original geometry preserved
    assert "_original_geom_wkt" in clipped_gdf.columns
    assert "15" in clipped_gdf.iloc[1]["_original_geom_wkt"]

    # Outside point retained non-destructively
    assert clipped_gdf.iloc[2].geometry.equals(p_out)
    assert clipped_gdf.iloc[2]["_clipping_status"] == ClippingStatus.OUTSIDE_UNCLIPPED.value
