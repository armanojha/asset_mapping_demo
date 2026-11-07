import geopandas as gpd
import pytest
from shapely.geometry import (
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPolygon,
    Point,
    Polygon,
)

from app.preprocessing.geometry_cleaner import GeometryCleaner
from app.schemas.preprocessing import GeometryValidationStatus


def test_clean_valid_polygon():
    """Verify initially valid polygon is validated and oriented without mutation."""
    cleaner = GeometryCleaner()
    poly = Polygon([(0, 0), (4, 0), (4, 4), (0, 4), (0, 0)])

    cleaned, audit = cleaner.clean_single_geometry(
        poly, asset_category="building", source_feature_id=101
    )

    assert cleaned is not None
    assert cleaned.is_valid is True
    assert audit.initial_validity is True
    assert audit.was_repaired is False
    assert audit.status == GeometryValidationStatus.VALID
    assert audit.original_geom_type == "Polygon"
    assert audit.cleaned_geom_type == "Polygon"
    assert cleaned.exterior.is_ccw is True


def test_clean_self_intersecting_bowtie_polygon():
    """Verify self-intersecting bowtie polygon is repaired via make_valid into MultiPolygon."""
    cleaner = GeometryCleaner()
    # Classic self-intersecting figure-8 bowtie
    bowtie = Polygon([(0, 0), (2, 2), (2, 0), (0, 2), (0, 0)])
    assert bowtie.is_valid is False

    cleaned, audit = cleaner.clean_single_geometry(
        bowtie, asset_category="building", source_feature_id=102
    )

    assert cleaned is not None
    assert cleaned.is_valid is True
    assert audit.initial_validity is False
    assert audit.was_repaired is True
    assert audit.status == GeometryValidationStatus.REPAIRED
    assert "make_valid" in audit.repair_operations
    assert cleaned.geom_type in ["Polygon", "MultiPolygon"]


def test_clean_empty_polygon():
    """Verify empty polygon is detected, preserved, and marked with EMPTY status."""
    cleaner = GeometryCleaner()
    empty_poly = Polygon()

    cleaned, audit = cleaner.clean_single_geometry(
        empty_poly, asset_category="parcel", source_feature_id=103
    )

    assert cleaned is not None
    assert cleaned.is_empty is True
    assert audit.is_empty_or_null is True
    assert audit.status == GeometryValidationStatus.EMPTY


def test_clean_null_geometry():
    """Verify None geometry is detected, preserved, and marked with NULL status."""
    cleaner = GeometryCleaner()

    cleaned, audit = cleaner.clean_single_geometry(
        None, asset_category="parcel", source_feature_id=104
    )

    assert cleaned is None
    assert audit.is_empty_or_null is True
    assert audit.status == GeometryValidationStatus.NULL


def test_clean_geometry_collection_extraction():
    """
    Verify that an invalid polygon with an antenna that make_valid turns into a GeometryCollection
    has its 2D Polygon component cleanly extracted for building assets.
    """
    cleaner = GeometryCleaner()
    # Polygon with a linear dangling antenna spike
    antenna_poly = Polygon([(0, 0), (0, 2), (2, 2), (2, 0), (3, 0), (2, 0), (0, 0)])
    assert antenna_poly.is_valid is False

    cleaned, audit = cleaner.clean_single_geometry(
        antenna_poly, asset_category="building", source_feature_id=105
    )

    assert cleaned is not None
    assert cleaned.is_valid is True
    assert cleaned.geom_type in ["Polygon", "MultiPolygon"]
    assert audit.was_repaired is True
    assert any("extract_areal" in op for op in audit.repair_operations)


def test_clean_valid_and_normalized_linestring():
    """Verify road LineString is normalized by pruning duplicate consecutive vertices."""
    cleaner = GeometryCleaner()
    # Line with duplicate consecutive vertices: (1,1) duplicated
    line = LineString([(0, 0), (1, 1), (1, 1), (2, 2)])

    cleaned, audit = cleaner.clean_single_geometry(
        line, asset_category="road", source_feature_id=106
    )

    assert cleaned is not None
    assert cleaned.is_valid is True
    assert audit.initial_validity is True
    assert len(cleaned.coords) == 3
    assert list(cleaned.coords) == [(0.0, 0.0), (1.0, 1.0), (2.0, 2.0)]


def test_unexpected_geometry_type_no_silent_deletion():
    """Verify that an unexpected geometry type (e.g. Point in a building layer) is not silently deleted."""
    cleaner = GeometryCleaner()
    point = Point(10, 20)

    cleaned, audit = cleaner.clean_single_geometry(
        point, asset_category="building", source_feature_id=107
    )

    assert cleaned is not None
    assert cleaned.geom_type == "Point"
    assert audit.status == GeometryValidationStatus.UNEXPECTED_TYPE
    assert audit.unexpected_type_warning is not None
    assert "Unexpected geometry type" in audit.unexpected_type_warning


def test_clean_geodataframe_full_workflow():
    """
    Verify complete GeoDataFrame cleaning:
    - Maintains original rows (no silent deletion)
    - Detects duplicate geometries
    - Injects audit columns
    - Emits comprehensive GeometryRepairReport
    """
    cleaner = GeometryCleaner()

    # Create test GeoDataFrame with:
    # 1. Valid poly
    # 2. Duplicate of poly 1
    # 3. Bowtie poly (invalid)
    # 4. LineString (unexpected for building)
    # 5. Empty poly
    poly_valid = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])
    poly_dup = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])
    poly_bowtie = Polygon([(10, 10), (12, 12), (12, 10), (10, 12), (10, 10)])
    line_unexp = LineString([(5, 5), (6, 6)])
    poly_empty = Polygon()

    gdf = gpd.GeoDataFrame(
        {
            "objectid": [1, 2, 3, 4, 5],
            "asset_name": ["House A", "House B", "House C", "Fence", "Ghost"],
            "geometry": [poly_valid, poly_dup, poly_bowtie, line_unexp, poly_empty],
        },
        crs="EPSG:4326",
    )

    cleaned_gdf, report = cleaner.clean_geodataframe(
        gdf=gdf,
        asset_category="building",
        id_column="objectid",
        dataset_name="test_buildings",
    )

    # 1. Zero features deleted
    assert len(cleaned_gdf) == len(gdf)
    assert report.original_feature_count == 5
    assert report.removed_geometries_count == 0

    # 2. Duplicate detection
    assert report.duplicate_geometries_count == 1

    # 3. Validation counts
    assert report.repaired_geometries_count == 1  # Bowtie repaired
    assert report.empty_geometries_count == 1     # Ghost empty
    assert report.unexpected_geometry_types.get("LineString") == 1

    # 4. Data preservation & Injected columns
    assert "_geom_initial_valid" in cleaned_gdf.columns
    assert "_geom_was_repaired" in cleaned_gdf.columns
    assert "_geom_status" in cleaned_gdf.columns
    assert "_geom_repair_notes" in cleaned_gdf.columns
    assert "_geom_original_type" in cleaned_gdf.columns

    # Verify original attributes preserved
    assert list(cleaned_gdf["objectid"]) == [1, 2, 3, 4, 5]
    assert list(cleaned_gdf["asset_name"]) == ["House A", "House B", "House C", "Fence", "Ghost"]

    # Verify repaired bowtie became valid MultiPolygon/Polygon
    repaired_feat = cleaned_gdf.iloc[2]
    assert bool(repaired_feat["_geom_was_repaired"]) is True
    assert bool(repaired_feat.geometry.is_valid) is True
    assert "_geom_is_duplicate" in cleaned_gdf.columns


def test_pipeline_clean_dataset_file_and_bundle(tmp_path):
    """Verify end-to-end pipeline file cleaning and bundle summarization."""
    from app.preprocessing.pipeline import clean_acquisition_bundle, clean_dataset_file

    # Create dummy raw layer file
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    poly = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])
    gdf = gpd.GeoDataFrame(
        {"objectid": [1], "name": ["School"], "geometry": [poly]},
        crs="EPSG:4326",
    )
    raw_file = raw_dir / "grammanchitra_layer_1_test.geojson"
    gdf.to_file(raw_file, driver="GeoJSON")

    out_dir = tmp_path / "processed"

    # Test single file cleaning
    cleaned_gdf, report = clean_dataset_file(
        input_geojson_path=raw_file,
        output_dir=out_dir,
    )
    assert len(cleaned_gdf) == 1
    assert report.valid_geometries_count == 1
    assert report.asset_category == "building"
    assert (out_dir / "grammanchitra_layer_1_test.cleaned.geojson").exists()
    assert (out_dir / "grammanchitra_layer_1_test.report.json").exists()

    # Test bundle cleaning
    bundle_out = tmp_path / "bundle_out"
    bundle_summary = clean_acquisition_bundle(
        raw_acquisition_dir=raw_dir,
        output_dir=bundle_out,
    )
    assert bundle_summary["total_files_processed"] == 1
    assert bundle_summary["totals"]["features"] == 1
    assert (bundle_out / "bundle_cleaning_summary.json").exists()

