"""
Runner script for Feature Classification and Spatial Validation on acquired village datasets.

Executes:
1. Feature Classification: Standardizes heterogeneous GIS features into canonical internal schema.
2. Boundary Derivation/Resolution: Derives cadastral hull boundary with explicit verification tagging.
3. Spatial Validation: Measures spatial containment, intersection, and metric distance in EPSG:32644.
4. Non-Destructive Export: Stores standardized GeoJSONs, classification reports, and spatial quality audits.

Usage:
    python backend/scripts/run_classification_and_spatial_validation.py --acquisition-id acq_1fa4312f8f87
"""

import argparse
import json
import logging
import sys
from pathlib import Path

# Add backend directory to path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import geopandas as gpd

from app.preprocessing.feature_classifier import FeatureClassifier
from app.preprocessing.spatial_validator import SpatialValidator
from app.schemas.classification import StandardizedFeatureCollection
from app.schemas.spatial_validation import BoundaryDefinition, BoundaryType

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scripts.run_classification_and_spatial_validation")


def main():
    parser = argparse.ArgumentParser(
        description="Run Feature Classification & Spatial Validation on cleaned village datasets."
    )
    parser.add_argument(
        "--acquisition-id",
        type=str,
        default="acq_1fa4312f8f87",
        help="Acquisition ID located in data/processed/cleaned/<acquisition-id>",
    )
    parser.add_argument(
        "--village-name",
        type=str,
        default="GUDWARA",
        help="Name of the target village",
    )
    parser.add_argument(
        "--projected-crs",
        type=str,
        default="EPSG:32644",
        help="Projected metric CRS (default UTM 44N EPSG:32644)",
    )

    args = parser.parse_args()
    project_root = backend_dir.parent

    cleaned_dir = project_root / "data" / "processed" / "cleaned" / args.acquisition_id
    if not cleaned_dir.exists():
        logger.error("Cleaned data directory not found: %s", cleaned_dir)
        sys.exit(1)

    output_dir = project_root / "data" / "processed" / "standardized" / args.acquisition_id
    output_dir.mkdir(parents=True, exist_ok=True)

    classifier = FeatureClassifier()
    spatial_validator = SpatialValidator(projected_crs=args.projected_crs)

    cleaned_files = sorted(list(cleaned_dir.glob("*.cleaned.geojson")))
    if not cleaned_files:
        logger.error("No *.cleaned.geojson files found in %s", cleaned_dir)
        sys.exit(1)

    logger.info("Found %d cleaned GeoJSON files to classify and validate.", len(cleaned_files))

    all_classified_gdfs = []
    classification_summaries = {}

    # ==========================================================
    # STAGE 1: FEATURE CLASSIFICATION
    # ==========================================================
    for file_path in cleaned_files:
        logger.info("Classifying: %s", file_path.name)
        gdf = gpd.read_file(file_path)

        # Detect layer name
        layer_name = file_path.name.replace(".cleaned.geojson", "")

        collection, report = classifier.classify_geodataframe(
            gdf=gdf,
            source_name="grammanchitra",
            source_layer=layer_name,
            id_column="uniq_id",
            dataset_name=layer_name,
        )

        classification_summaries[layer_name] = report.summary_dict()

        # Build standardized GeoDataFrame
        geojson_features = [f.to_geojson_feature() for f in collection.features]
        classified_gdf = gpd.GeoDataFrame.from_features(geojson_features, crs="EPSG:4326")
        all_classified_gdfs.append(classified_gdf)

        # Save standardized GeoJSON
        std_out_path = output_dir / f"{layer_name}.standardized.geojson"
        classified_gdf.to_file(std_out_path, driver="GeoJSON")

        # Save classification report
        rep_out_path = output_dir / f"{layer_name}.classification_report.json"
        with open(rep_out_path, "w", encoding="utf-8") as f:
            json.dump(report.model_dump(), f, indent=2)

    # Save consolidated classification summary
    with open(output_dir / "classification_summary.json", "w", encoding="utf-8") as f:
        json.dump(classification_summaries, f, indent=2)

    logger.info("Feature classification completed successfully.")

    # ==========================================================
    # STAGE 2: BOUNDARY DERIVATION / RESOLUTION
    # ==========================================================
    # Merge parcel and building datasets to derive estimated village cadastral hull
    combined_gdf = gpd.GeoDataFrame(
        pd_concat := gpd.pd.concat(all_classified_gdfs, ignore_index=True),
        crs="EPSG:4326",
    )

    # Derive boundary
    boundary_geom, boundary_def = spatial_validator.derive_boundary_from_features(
        gdf=combined_gdf,
        village_name=args.village_name,
        buffer_meters=15.0,
        projected_crs=args.projected_crs,
    )

    # Save boundary GeoJSON
    boundary_gdf = gpd.GeoDataFrame(
        [{"boundary_name": boundary_def.boundary_name, "is_verified": boundary_def.is_verified, "geometry": boundary_geom}],
        crs="EPSG:4326",
    )
    boundary_out_path = output_dir / f"{args.village_name.lower()}_derived_boundary.geojson"
    boundary_gdf.to_file(boundary_out_path, driver="GeoJSON")

    # ==========================================================
    # STAGE 3: SPATIAL VALIDATION & QUALITY AUDIT
    # ==========================================================
    audited_gdf, spatial_report = spatial_validator.validate_dataset(
        gdf=combined_gdf,
        boundary_geom=boundary_geom,
        boundary_definition=boundary_def,
        village_identifier=args.village_name,
        id_column="feature_id",
        category_column="category",
    )

    # Save spatial validation report
    with open(output_dir / "spatial_validation_report.json", "w", encoding="utf-8") as f:
        json.dump(spatial_report.model_dump(), f, indent=2)

    # Save consolidated audited village GeoDataFrame
    audited_out_path = output_dir / f"{args.village_name.lower()}_village_audited.geojson"
    audited_gdf.to_file(audited_out_path, driver="GeoJSON")

    # ==========================================================
    # SUMMARY DISPLAY
    # ==========================================================
    print("\n" + "=" * 65)
    print("PHASE 2: STANDARDIZED CLASSIFICATION & SPATIAL VALIDATION REPORT")
    print("=" * 65)
    print(f"Village Identifier  : {args.village_name}")
    print(f"Acquisition ID      : {args.acquisition_id}")
    print(f"Total Features      : {spatial_report.total_features_evaluated}")
    print(f"Boundary Used       : {boundary_def.boundary_name} (Verified: {boundary_def.is_verified})")
    print(f"Derived Area (m^2)  : {boundary_def.area_sqm:,.2f} m^2 (~{boundary_def.area_sqm / 10000:.2f} hectares)")
    print("-" * 65)
    print("FEATURE CLASSIFICATION BREAKDOWN:")
    for layer, s in classification_summaries.items():
        print(f"  * {layer}:")
        for cat, cnt in s["category_counts"].items():
            print(f"      - {cat}: {cnt} features")
        for sub, cnt in s["subcategory_counts"].items():
            print(f"          |-- {sub}: {cnt}")
    print("-" * 65)
    print("SPATIAL RELATIONSHIP AUDIT:")
    pct_inside = (spatial_report.fully_inside_count / spatial_report.total_features_evaluated * 100) if spatial_report.total_features_evaluated > 0 else 0
    print(f"  * Fully Inside Boundary    : {spatial_report.fully_inside_count} ({pct_inside:.1f}%)")
    print(f"  * Partially Intersecting   : {spatial_report.partially_intersecting_count}")
    print(f"  * Outside Boundary         : {spatial_report.outside_count}")
    print(f"  * Suspicious Outliers      : {spatial_report.suspicious_outlier_count}")
    print("-" * 65)
    print("CATEGORY SPATIAL BREAKDOWN:")
    for cat, b_down in spatial_report.category_spatial_breakdown.items():
        print(f"  * {cat}: Inside={b_down['fully_inside']}, Crossing={b_down['intersecting_crossing']}, Outside={b_down['outside']}")
    print("=" * 65)
    print(f"Standardized artifacts saved to: {output_dir}")


if __name__ == "__main__":
    main()
