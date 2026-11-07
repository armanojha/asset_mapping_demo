"""
GeoJSON export and file validation module for the unified processing pipeline.
Writes datasets to tiered processed storage and verifies parseability via GeoPandas.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import geopandas as gpd

logger = logging.getLogger("processing.geojson_exporter")


class GeoJSONExportError(RuntimeError):
    """Raised when an exported GeoJSON fails post-write validation."""
    pass


class GeoJSONExporter:
    """
    Handles organized, tiered exports of GeoDataFrames and validates GeoJSON compliance.
    """

    def __init__(self, base_processed_dir: Path):
        self.base_dir = Path(base_processed_dir)
        self.normalized_dir = self.base_dir / "normalized"
        self.cleaned_dir = self.base_dir / "cleaned"
        self.classified_dir = self.base_dir / "classified"
        self.validated_dir = self.base_dir / "validated"
        self.final_dir = self.base_dir / "final"
        self.reports_dir = self.base_dir / "reports"

        # Create all directories
        for d in [
            self.normalized_dir,
            self.cleaned_dir,
            self.classified_dir,
            self.validated_dir,
            self.final_dir,
            self.reports_dir,
        ]:
            d.mkdir(parents=True, exist_ok=True)

    def export_and_verify(
        self,
        gdf: gpd.GeoDataFrame,
        output_path: Path,
        driver: str = "GeoJSON",
    ) -> Path:
        """
        Exports a GeoDataFrame to file and immediately verifies that it can be
        re-read by GeoPandas without corruption or record loss.
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        logger.info("Exporting %d records to %s", len(gdf), output_path)
        gdf.to_file(output_path, driver=driver)

        # Verification check
        try:
            reloaded = gpd.read_file(output_path)
            if len(reloaded) != len(gdf):
                raise GeoJSONExportError(
                    f"Export verification failed for {output_path}: "
                    f"Wrote {len(gdf)} records, but reloaded {len(reloaded)} records."
                )
            logger.info("Verified export integrity for %s (%d records)", output_path.name, len(reloaded))
        except Exception as e:
            raise GeoJSONExportError(f"Post-write GeoPandas validation failed for {output_path}: {e}") from e

        return output_path

    def export_stage(
        self,
        gdf: gpd.GeoDataFrame,
        stage: str,
        acquisition_id: str,
        layer_name: str,
    ) -> Path:
        """
        Exports a dataset at a specific pipeline stage to its corresponding directory.
        Supported stages: normalized, cleaned, classified, validated, final.
        """
        stage_map = {
            "normalized": self.normalized_dir,
            "cleaned": self.cleaned_dir,
            "classified": self.classified_dir,
            "validated": self.validated_dir,
            "final": self.final_dir,
        }
        target_dir = stage_map.get(stage.lower(), self.final_dir) / acquisition_id
        target_dir.mkdir(parents=True, exist_ok=True)

        out_path = target_dir / f"{layer_name}.{stage.lower()}.geojson"
        return self.export_and_verify(gdf, out_path)

    def save_report(
        self,
        report_data: Dict[str, Any],
        acquisition_id: str,
        report_name: str,
    ) -> Path:
        """Saves a JSON report under data/processed/reports/<acquisition_id>/."""
        target_dir = self.reports_dir / acquisition_id
        target_dir.mkdir(parents=True, exist_ok=True)

        out_path = target_dir / f"{report_name}.json"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(report_data, f, indent=2)

        logger.info("Saved processing report to %s", out_path)
        return out_path
