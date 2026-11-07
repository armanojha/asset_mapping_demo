"""
Command-line utility to run Phase 2 Geometry Cleaning on raw acquired datasets.

Usage:
    python backend/scripts/run_geometry_cleaning.py --acquisition-id acq_1fa4312f8f87
    python backend/scripts/run_geometry_cleaning.py --input-dir data/raw/grammanchitra/acq_1fa4312f8f87 --output-dir data/processed/cleaned/acq_1fa4312f8f87
"""

import argparse
import json
import logging
import sys
from pathlib import Path

# Add backend directory to path so app modules import cleanly
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.preprocessing.pipeline import clean_acquisition_bundle

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("scripts.run_geometry_cleaning")


def main():
    parser = argparse.ArgumentParser(description="Run Geometry Cleaning Pipeline on acquired village datasets.")
    parser.add_argument(
        "--acquisition-id",
        type=str,
        default="acq_1fa4312f8f87",
        help="Acquisition ID to process from data/raw/grammanchitra/<id>",
    )
    parser.add_argument(
        "--input-dir",
        type=str,
        default=None,
        help="Optional explicit input directory containing raw GeoJSON files",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Optional explicit output directory to store cleaned GeoJSON and reports",
    )

    args = parser.parse_args()

    # Project root is parent of backend_dir
    project_root = backend_dir.parent

    if args.input_dir:
        input_dir = Path(args.input_dir)
        if not input_dir.is_absolute():
            input_dir = project_root / input_dir
    else:
        input_dir = project_root / "data" / "raw" / "grammanchitra" / args.acquisition_id

    if args.output_dir:
        output_dir = Path(args.output_dir)
        if not output_dir.is_absolute():
            output_dir = project_root / output_dir
    else:
        output_dir = project_root / "data" / "processed" / "cleaned" / args.acquisition_id

    logger.info("Executing Geometry Cleaning Pipeline:")
    logger.info("  Input directory : %s", input_dir)
    logger.info("  Output directory: %s", output_dir)

    if not input_dir.exists():
        logger.error("Input directory does not exist: %s", input_dir)
        sys.exit(1)

    summary = clean_acquisition_bundle(input_dir, output_dir)

    print("\n" + "=" * 60)
    print("GEOMETRY CLEANING SUMMARY")
    print("=" * 60)
    print(f"Acquisition: {input_dir.name}")
    print(f"Files Processed: {summary['total_files_processed']}")
    print("-" * 60)
    totals = summary["totals"]
    print(f"Total Features     : {totals['features']}")
    print(f"Initially Valid    : {totals['valid']}")
    print(f"Initially Invalid  : {totals['invalid']}")
    print(f"Repaired           : {totals['repaired']}")
    print(f"Unrepairable       : {totals['unrepairable']}")
    print(f"Empty              : {totals['empty']}")
    print(f"Duplicate Geoms    : {totals['duplicates']}")
    print(f"Removed Geometries : {totals['removed']} (rule: zero deleted)")
    print("-" * 60)
    print("Layer Details:")
    for layer_name, info in summary["layers"].items():
        print(
            f"  - {layer_name}: {info['original_feature_count']} features "
            f"(category: {info['asset_category']}, valid: {info['valid_geometries_count']}, "
            f"repaired: {info['repaired_geometries_count']}, duplicates: {info['duplicate_geometries_count']})"
        )
    print("=" * 60)
    print(f"Results saved to: {output_dir}")


if __name__ == "__main__":
    main()
