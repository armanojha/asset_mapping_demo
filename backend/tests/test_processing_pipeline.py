"""
Unit and integration tests for the Unified GIS Preprocessing Pipeline.
Tests format detection, CRS validation, geometry cleaning, vertical staging,
spatial validation, partial failure isolation, and real-world Phase 1 village data execution.
"""

from pathlib import Path
import geopandas as gpd
import pytest
from shapely.geometry import LineString, Point, Polygon

from app.processing.crs_normalizer import CRSNormalizer, CRSValidationError
from app.processing.pipeline import ProcessingConfig, ProcessingPipeline


def test_crs_normalizer_detect_and_missing_rejection(tmp_path):
    """Verify CRS normalizer detects valid CRS and strictly rejects missing CRS."""
    normalizer = CRSNormalizer(target_crs="EPSG:4326")

    # 1. Valid CRS
    gdf_valid = gpd.GeoDataFrame(
        {"geometry": [Point(79.08, 23.11)]},
        crs="EPSG:4326",
    )
    detected = normalizer.detect_and_validate_crs(gdf_valid, "test_valid")
    assert detected == "EPSG:4326"

    # 2. Missing CRS strictly raises CRSValidationError (never silently assumed)
    gdf_missing = gpd.GeoDataFrame(
        {"geometry": [Point(79.08, 23.11)]},
        crs=None,
    )
    with pytest.raises(CRSValidationError) as exc_info:
        normalizer.detect_and_validate_crs(gdf_missing, "test_missing")
    assert "Silent CRS assumption is strictly prohibited" in str(exc_info.value)


def test_pipeline_unit_synthetic_workflow(tmp_path):
    """
    Unit test using synthetic geometries verifying end-to-end processing:
    CRS validation, geometry repair, vertical staging, and tiered export.
    """
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    # Create synthetic building dataset with a bowtie polygon (needs repair)
    b_bowtie = Polygon([(0, 0), (2, 2), (2, 0), (0, 2), (0, 0)])
    b_valid = Polygon([(5, 5), (7, 5), (7, 7), (5, 7), (5, 5)])
    b_gdf = gpd.GeoDataFrame(
        {
            "objectid": [1, 2],
            "built_up_area_type": [19, 19],
            "geometry": [b_bowtie, b_valid],
        },
        crs="EPSG:4326",
    )
    b_file = raw_dir / "synthetic_buildings.geojson"
    b_gdf.to_file(b_file, driver="GeoJSON")

    # Create synthetic road dataset
    r_line = LineString([(0, 0), (10, 0)])
    r_gdf = gpd.GeoDataFrame(
        {"objectid": [1], "road_type": [9], "geometry": [r_line]},
        crs="EPSG:4326",
    )
    r_file = raw_dir / "synthetic_roads.geojson"
    r_gdf.to_file(r_file, driver="GeoJSON")

    proc_dir = tmp_path / "processed"

    config = ProcessingConfig(
        village_name="SyntheticVillage",
        acquisition_id="test_syn_01",
        source_name="synthetic_test",
        input_datasets={
            "buildings": str(b_file),
            "roads": str(r_file),
        },
        base_output_dir=str(proc_dir),
    )

    pipeline = ProcessingPipeline(config)
    report = pipeline.execute()

    assert report.overall_status == "success"
    assert report.layers_evaluated == 2
    assert report.layers_succeeded == 2
    assert report.layers_failed == 0

    # Verify tiered directory structure was created
    assert (proc_dir / "normalized" / "test_syn_01").exists()
    assert (proc_dir / "cleaned" / "test_syn_01").exists()
    assert (proc_dir / "classified" / "test_syn_01").exists()
    assert (proc_dir / "validated" / "test_syn_01").exists()
    assert (proc_dir / "final" / "test_syn_01").exists()
    assert (proc_dir / "reports" / "test_syn_01").exists()

    # Verify building bowtie was repaired and final file can be loaded
    final_b_path = proc_dir / "final" / "test_syn_01" / "buildings.final.geojson"
    assert final_b_path.exists()
    loaded_b = gpd.read_file(final_b_path)
    assert len(loaded_b) == 2
    assert loaded_b.geometry.is_valid.all()
    # Check vertical staging and procedural height
    assert "_vertical_tier" in loaded_b.columns
    assert "_procedural_height_m" in loaded_b.columns
    assert loaded_b.iloc[0]["_plinth_elevation_m"] == 0.15


def test_pipeline_partial_failure_isolation(tmp_path):
    """
    Verify partial failure handling:
    If one dataset fails, the successful dataset is preserved and the failure is clearly reported.
    """
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()

    # Valid layer
    p_valid = Polygon([(0, 0), (1, 0), (1, 1), (0, 0)])
    gdf_ok = gpd.GeoDataFrame({"geometry": [p_valid]}, crs="EPSG:4326")
    file_ok = raw_dir / "valid_layer.geojson"
    gdf_ok.to_file(file_ok, driver="GeoJSON")

    # Corrupted / non-existent layer
    file_bad = raw_dir / "missing_corrupted.geojson"

    proc_dir = tmp_path / "processed"

    config = ProcessingConfig(
        village_name="PartialVillage",
        acquisition_id="test_partial_01",
        input_datasets={
            "valid_layer": str(file_ok),
            "bad_layer": str(file_bad),
        },
        base_output_dir=str(proc_dir),
    )

    pipeline = ProcessingPipeline(config)
    report = pipeline.execute()

    # Pipeline must report partial_success
    assert report.overall_status == "partial_success"
    assert report.layers_succeeded == 1
    assert report.layers_failed == 1

    # Successful layer preserved in output
    assert report.layer_results["valid_layer"].status == "success"
    assert (proc_dir / "final" / "test_partial_01" / "valid_layer.final.geojson").exists()

    # Failed layer documented with clear error
    assert report.layer_results["bad_layer"].status == "failed"
    assert "Input file not found" in (report.layer_results["bad_layer"].error or "")


def test_pipeline_integration_real_gudwara_dataset():
    """
    Integration test executing the full pipeline against real Phase 1 village data for Gudwara.
    Verifies reproducibility metadata, road-building overlap detection, and output parseability.
    """
    project_root = Path(__file__).resolve().parent.parent.parent
    raw_dir = project_root / "data" / "raw" / "grammanchitra" / "acq_1fa4312f8f87"

    # Ensure raw files exist
    road_raw = raw_dir / "grammanchitra_layer_0_20261107_095850.geojson"
    bldg_raw = raw_dir / "grammanchitra_layer_1_20261107_095851.geojson"
    prcl_raw = raw_dir / "grammanchitra_layer_2_20261107_095852.geojson"

    assert road_raw.exists()
    assert bldg_raw.exists()
    assert prcl_raw.exists()

    output_dir = project_root / "data" / "processed"

    config = ProcessingConfig(
        village_name="GUDWARA",
        acquisition_id="acq_1fa4312f8f87",
        source_name="grammanchitra",
        input_datasets={
            "roads": str(road_raw),
            "buildings": str(bldg_raw),
            "parcels": str(prcl_raw),
        },
        target_crs="EPSG:4326",
        projected_crs="EPSG:32644",
        base_output_dir=str(output_dir),
    )

    pipeline = ProcessingPipeline(config)
    report = pipeline.execute()

    assert report.overall_status == "success"
    assert report.layers_evaluated == 3
    assert report.layers_succeeded == 3
    assert report.layers_failed == 0
    assert report.total_raw_features == 772
    assert report.total_final_features == 772

    # Verify reproducibility metadata
    assert "python" in report.software_versions
    assert "geopandas" in report.software_versions
    assert "shapely" in report.software_versions
    assert "pyproj" in report.software_versions

    # Verify boundary information
    assert report.boundary_info is not None
    assert report.boundary_info["is_verified"] is False
    assert report.boundary_info["boundary_type"] == "derived_cadastral_hull"

    # Verify road-building overlap detection (Threat 1)
    assert report.road_overlap_summary is not None
    assert report.road_overlap_summary["buildings_overlapping_roads"] > 0

    # Verify all final datasets can be loaded via GeoPandas
    final_dir = output_dir / "final" / "acq_1fa4312f8f87"
    for layer in ["roads", "buildings", "parcels"]:
        final_file = final_dir / f"{layer}.final.geojson"
        assert final_file.exists()
        gdf = gpd.read_file(final_file)
        assert len(gdf) > 0
        assert gdf.crs.to_string() == "EPSG:4326"
        assert "_vertical_tier" in gdf.columns
        assert "_plinth_elevation_m" in gdf.columns

    # Verify canonical top-level files in data/processed/final/
    canonical_files = [
        "village_boundary.geojson",
        "buildings.geojson",
        "roads.geojson",
        "water_bodies.geojson",
        "land_parcels.geojson",
        "community_assets.geojson",
    ]
    for c_file in canonical_files:
        canonical_p = output_dir / "final" / c_file
        assert canonical_p.exists(), f"Canonical file missing: {canonical_p}"
        c_gdf = gpd.read_file(canonical_p)
        assert c_gdf.crs.to_string() == "EPSG:4326"

    # Specific count checks on canonical files
    assert len(gpd.read_file(output_dir / "final" / "buildings.geojson")) == 424
    assert len(gpd.read_file(output_dir / "final" / "roads.geojson")) == 106
    assert len(gpd.read_file(output_dir / "final" / "land_parcels.geojson")) == 242
    assert len(gpd.read_file(output_dir / "final" / "village_boundary.geojson")) == 1
    assert len(gpd.read_file(output_dir / "final" / "water_bodies.geojson")) == 0
    assert len(gpd.read_file(output_dir / "final" / "community_assets.geojson")) == 0
