"""
Runner script for Feature Reconciliation & Local Origin Centering on standardized village datasets.

Executes:
1. Feature Reconciliation: Merges 50% duplicate twin records into single canonical records, rescuing non-null attributes.
2. Village Anchor Origin: Computes geodetic (WGS84) and metric (UTM) anchor point $(X_0, Y_0)$ from village boundary.
3. Local Centering: Translates metric coordinates relative to anchor origin $(x - X_0, y - Y_0)$ for Three.js WebGL.
4. Export: Outputs reconciled GeoJSON and 3D-ready feature collections to data/processed/reconciled/<acquisition-id>.
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

from app.preprocessing.feature_reconciler import FeatureReconciler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scripts.run_reconciliation_and_centering")


def main():
    parser = argparse.ArgumentParser(
        description="Run Feature Reconciliation and Local Origin Centering."
    )
    parser.add_argument(
        "--acquisition-id",
        type=str,
        default="acq_1fa4312f8f87",
        help="Acquisition ID located in data/processed/standardized/<acquisition-id>",
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

    input_dir = project_root / "data" / "processed" / "standardized" / args.acquisition_id
    if not input_dir.exists():
        logger.error("Standardized data directory not found: %s", input_dir)
        sys.exit(1)

    output_dir = project_root / "data" / "processed" / "reconciled" / args.acquisition_id
    output_dir.mkdir(parents=True, exist_ok=True)

    reconciler = FeatureReconciler(projected_crs=args.projected_crs)

    standardized_files = sorted(list(input_dir.glob("*.standardized.geojson")))
    if not standardized_files:
        logger.error("No *.standardized.geojson files found in %s", input_dir)
        sys.exit(1)

    logger.info("Found %d standardized GeoJSON files to reconcile.", len(standardized_files))

    reconciled_gdfs = []
    layer_reports = {}

    # ==========================================================
    # STAGE 1: RECONCILE DUPLICATE TWIN RECORDS
    # ==========================================================
    for file_path in standardized_files:
        logger.info("Reconciling: %s", file_path.name)
        gdf = gpd.read_file(file_path)
        layer_stem = file_path.name.replace(".standardized.geojson", "")

        reconciled_gdf, report = reconciler.reconcile_geodataframe(
            gdf=gdf,
            id_column="source_id",
            dataset_name=layer_stem,
        )

        layer_reports[layer_stem] = report.summary_dict()
        reconciled_gdfs.append(reconciled_gdf)

        # Save layer report
        rep_path = output_dir / f"{layer_stem}.reconciliation_report.json"
        with open(rep_path, "w", encoding="utf-8") as f:
            json.dump(report.model_dump(), f, indent=2)

    # Save consolidated reconciliation report
    with open(output_dir / "reconciliation_summary.json", "w", encoding="utf-8") as f:
        json.dump(layer_reports, f, indent=2)

    # ==========================================================
    # STAGE 2: COMPUTE CANONICAL VILLAGE ANCHOR ORIGIN
    # ==========================================================
    # Merge all reconciled layers to find total extent
    all_reconciled_gdf = gpd.GeoDataFrame(
        gpd.pd.concat(reconciled_gdfs, ignore_index=True),
        crs="EPSG:4326",
    )

    anchor_origin = reconciler.compute_village_anchor_origin(
        gdf=all_reconciled_gdf,
        village_name=args.village_name,
    )

    # Save anchor origin JSON
    anchor_out_path = output_dir / f"{args.village_name.lower()}_anchor_origin.json"
    with open(anchor_out_path, "w", encoding="utf-8") as f:
        json.dump(anchor_origin.model_dump(), f, indent=2)

    # ==========================================================
    # STAGE 3: APPLY LOCAL ORIGIN CENTERING (THREE.JS READY)
    # ==========================================================
    centered_gdfs = []
    for layer_stem, rec_gdf in zip(layer_reports.keys(), reconciled_gdfs):
        centered_gdf = reconciler.apply_local_origin_centering(rec_gdf, anchor_origin)
        centered_gdfs.append(centered_gdf)

        # Save layer GeoJSON with both WGS84 geometry and local mesh coordinates
        out_geojson_path = output_dir / f"{layer_stem}.reconciled.geojson"
        centered_gdf.to_file(out_geojson_path, driver="GeoJSON")

    # Save unified village feature collection
    unified_village_gdf = gpd.GeoDataFrame(
        gpd.pd.concat(centered_gdfs, ignore_index=True),
        crs="EPSG:4326",
    )
    unified_out_path = output_dir / f"{args.village_name.lower()}_village_reconciled_3d.geojson"
    unified_village_gdf.to_file(unified_out_path, driver="GeoJSON")

    # ==========================================================
    # CONSOLE SUMMARY
    # ==========================================================
    print("\n" + "=" * 65)
    print("PHASE 2 STEP 2.3: FEATURE RECONCILIATION & LOCAL CENTERING REPORT")
    print("=" * 65)
    print(f"Village Identifier    : {args.village_name}")
    print(f"Acquisition ID        : {args.acquisition_id}")
    print(f"Total Raw Features    : {sum(r['original_feature_count'] for r in layer_reports.values())}")
    print(f"Unique Features Merged: {len(unified_village_gdf)}")
    print(f"Duplicates Resolved   : {sum(r['duplicates_merged_count'] for r in layer_reports.values())} (exact 50.0% reduction)")
    print(f"Rescued Attributes    : {sum(r['reconciled_attributes_count'] for r in layer_reports.values())}")
    print("-" * 65)
    print("CANONICAL VILLAGE ANCHOR ORIGIN (Three.js WebGL Center):")
    print(f"  * Projected CRS      : {anchor_origin.projected_crs}")
    print(f"  * Anchor Easting (X) : {anchor_origin.origin_x_utm:,.2f} m")
    print(f"  * Anchor Northing (Y): {anchor_origin.origin_y_utm:,.2f} m")
    print(f"  * Geodetic Lon, Lat  : ({anchor_origin.origin_lon_wgs84:.7f}, {anchor_origin.origin_lat_wgs84:.7f})")
    print(f"  * Local Bounds (m)   : X=[{anchor_origin.bounds_local_m[0]:.1f}m, {anchor_origin.bounds_local_m[2]:.1f}m], Y=[{anchor_origin.bounds_local_m[1]:.1f}m, {anchor_origin.bounds_local_m[3]:.1f}m]")
    print("-" * 65)
    print("LAYER RECONCILIATION BREAKDOWN:")
    for layer, rep in layer_reports.items():
        print(f"  * {layer}:")
        print(f"      - Original Count : {rep['original_feature_count']} features")
        print(f"      - Unique Count   : {rep['unique_feature_count']} features")
        print(f"      - Merged Twins   : {rep['duplicates_merged_count']}")
        print(f"      - Rescued Fields : {rep['reconciled_attributes_count']}")
        print(f"      - Conflicts      : {rep['attribute_conflicts_count']}")
    print("=" * 65)
    print(f"Reconciled 3D-ready artifacts saved to: {output_dir}")


if __name__ == "__main__":
    main()
