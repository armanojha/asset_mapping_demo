"""
Pipeline module for validating and cleaning geospatial datasets.
Applies category validation rules, repairs defective geometries, injects provenance tracking,
and exports cleaned data and audit reports without modifying raw sources.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import geopandas as gpd

from app.preprocessing.geometry_cleaner import GeometryCleaner
from app.schemas.preprocessing import GeometryRepairReport

logger = logging.getLogger("preprocessing.pipeline")


def detect_asset_category_from_filename(filename: str) -> str:
    """Infers the asset category rule from the dataset filename or metadata."""
    name_lower = filename.lower()
    if "road" in name_lower or "layer_0" in name_lower:
        return "road"
    elif "built_up" in name_lower or "building" in name_lower or "layer_1" in name_lower:
        return "building"
    elif "parcel" in name_lower or "layer_2" in name_lower:
        return "parcel"
    elif "water" in name_lower or "river" in name_lower or "stream" in name_lower:
        return "water"
    elif "boundary" in name_lower or "village_boundary" in name_lower:
        return "boundary"
    return "generic"


def detect_id_column(gdf: gpd.GeoDataFrame) -> Optional[str]:
    """Identifies the best unique identifier column present in the dataset."""
    candidates = ["uniq_id", "objectid", "OBJECTID", "osm_id", "id", "property_id"]
    for col in candidates:
        if col in gdf.columns:
            return col
    return None


def clean_dataset_file(
    input_geojson_path: Path,
    output_dir: Path,
    asset_category: Optional[str] = None,
    cleaner: Optional[GeometryCleaner] = None,
) -> Tuple[gpd.GeoDataFrame, GeometryRepairReport]:
    """
    Cleans a single GeoJSON file:
    1. Reads raw GeoJSON (does NOT modify raw file).
    2. Identifies geometry category & ID column.
    3. Runs geometry validation and cleaning via GeometryCleaner.
    4. Writes cleaned GeoJSON to output directory with audit fields.
    5. Writes detailed GeometryRepairReport JSON.
    """
    if cleaner is None:
        cleaner = GeometryCleaner()

    input_path = Path(input_geojson_path)
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    # Infer category if not supplied
    if not asset_category:
        asset_category = detect_asset_category_from_filename(input_path.name)

    logger.info("Loading dataset from %s (inferred category: %s)", input_path, asset_category)
    gdf = gpd.read_file(input_path)

    id_col = detect_id_column(gdf)
    dataset_name = input_path.stem

    cleaned_gdf, report = cleaner.clean_geodataframe(
        gdf=gdf,
        asset_category=asset_category,
        id_column=id_col,
        dataset_name=dataset_name,
    )

    # Inject source file provenance
    cleaned_gdf["_source_file"] = input_path.name
    cleaned_gdf["_cleaned_at"] = datetime.now(timezone.utc).isoformat()

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Save cleaned GeoJSON
    out_geojson_path = output_dir / f"{dataset_name}.cleaned.geojson"
    cleaned_gdf.to_file(out_geojson_path, driver="GeoJSON")
    logger.info("Saved cleaned GeoJSON to %s (%d records)", out_geojson_path, len(cleaned_gdf))

    # Save report JSON
    out_report_path = output_dir / f"{dataset_name}.report.json"
    with open(out_report_path, "w", encoding="utf-8") as f:
        json.dump(report.model_dump(), f, indent=2)
    logger.info("Saved geometry repair report to %s", out_report_path)

    return cleaned_gdf, report


def clean_acquisition_bundle(
    raw_acquisition_dir: Path,
    output_dir: Path,
) -> Dict[str, Any]:
    """
    Validates and cleans all GeoJSON datasets in an acquisition directory.
    Outputs cleaned files and consolidated summary to output_dir.
    """
    raw_dir = Path(raw_acquisition_dir)
    if not raw_dir.exists():
        raise FileNotFoundError(f"Raw acquisition directory not found: {raw_dir}")

    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    cleaner = GeometryCleaner()
    geojson_files = sorted(list(raw_dir.glob("*.geojson")))

    if not geojson_files:
        logger.warning("No GeoJSON files found in %s", raw_dir)
        return {"total_files_processed": 0, "layers": {}}

    bundle_summary: Dict[str, Any] = {
        "acquisition_dir": str(raw_dir),
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "total_files_processed": len(geojson_files),
        "layers": {},
        "totals": {
            "features": 0,
            "valid": 0,
            "invalid": 0,
            "repaired": 0,
            "unrepairable": 0,
            "empty": 0,
            "duplicates": 0,
            "removed": 0,
        },
    }

    for geojson_path in geojson_files:
        category = detect_asset_category_from_filename(geojson_path.name)
        cleaned_gdf, report = clean_dataset_file(
            input_geojson_path=geojson_path,
            output_dir=output_dir,
            asset_category=category,
            cleaner=cleaner,
        )

        bundle_summary["layers"][geojson_path.stem] = report.summary_dict()
        bundle_summary["totals"]["features"] += report.original_feature_count
        bundle_summary["totals"]["valid"] += report.valid_geometries_count
        bundle_summary["totals"]["invalid"] += report.invalid_geometries_count
        bundle_summary["totals"]["repaired"] += report.repaired_geometries_count
        bundle_summary["totals"]["unrepairable"] += report.unrepairable_geometries_count
        bundle_summary["totals"]["empty"] += report.empty_geometries_count
        bundle_summary["totals"]["duplicates"] += report.duplicate_geometries_count
        bundle_summary["totals"]["removed"] += report.removed_geometries_count

    # Write consolidated summary
    consolidated_path = output_dir / "bundle_cleaning_summary.json"
    with open(consolidated_path, "w", encoding="utf-8") as f:
        json.dump(bundle_summary, f, indent=2)

    logger.info(
        "Consolidated bundle cleaning completed for %s: %s",
        raw_dir.name,
        bundle_summary["totals"],
    )
    return bundle_summary
