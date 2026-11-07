"""
Unified GIS Preprocessing Pipeline for the Village Asset Mapping System.
Orchestrates format detection, CRS validation, coordinate normalization, geometry cleaning,
feature classification, spatial validation, non-destructive export, and reproducibility reporting.
Supports partial failure isolation and multi-tier output organization.
"""

import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import fastapi
import geopandas as gpd
import pydantic
import pyproj
import shapely
from pydantic import BaseModel, Field

from app.processing.crs_normalizer import CRSNormalizer, CRSValidationError
from app.processing.feature_classifier import FeatureClassifier
from app.processing.geojson_exporter import GeoJSONExporter
from app.processing.geometry_cleaner import GeometryCleaner
from app.processing.spatial_validator import SpatialValidator
from app.schemas.spatial_validation import BoundaryDefinition, BoundaryType

logger = logging.getLogger("processing.pipeline")


class ProcessingConfig(BaseModel):
    """Configuration for the unified GIS preprocessing pipeline."""
    village_name: str = Field(default="Village", description="Target village name")
    acquisition_id: str = Field(..., description="Unique acquisition batch identifier")
    source_name: str = Field(default="grammanchitra", description="Data source provider name")
    input_datasets: Dict[str, str] = Field(
        ...,
        description="Dictionary mapping layer identifiers (e.g. 'roads', 'buildings', 'parcels') to file paths",
    )
    target_crs: str = Field(default="EPSG:4326", description="Target geodetic CRS for standard exports")
    projected_crs: str = Field(default="EPSG:32644", description="Metric projected CRS for spatial calculations")
    base_output_dir: str = Field(default="data/processed", description="Root processed data directory")
    enabled_operations: List[str] = Field(
        default_factory=lambda: [
            "crs_validation",
            "coordinate_normalization",
            "geometry_cleaning",
            "feature_classification",
            "spatial_validation",
            "export_intermediate",
            "export_final",
        ],
        description="List of pipeline stages to execute",
    )
    export_format: str = Field(default="GeoJSON", description="Export file format")


class LayerProcessingResult(BaseModel):
    """Result and metrics for an individual processed layer."""
    layer_name: str
    status: str = Field(..., description="'success', 'partial_failure', or 'failed'")
    input_file: str
    raw_feature_count: int = 0
    final_feature_count: int = 0
    initial_crs: Optional[str] = None
    target_crs: Optional[str] = None
    geometry_cleaning_summary: Optional[Dict[str, Any]] = None
    classification_summary: Optional[Dict[str, Any]] = None
    spatial_validation_summary: Optional[Dict[str, Any]] = None
    exported_files: Dict[str, str] = Field(default_factory=dict)
    warnings: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class ProcessingPipelineReport(BaseModel):
    """Comprehensive pipeline execution and reproducibility report."""
    pipeline_version: str = "2.0.0"
    village_name: str
    acquisition_id: str
    source_name: str
    started_at: str
    completed_at: str
    duration_seconds: float
    overall_status: str = Field(..., description="'success', 'partial_success', or 'failed'")
    software_versions: Dict[str, str]
    configuration: Dict[str, Any]
    layers_evaluated: int
    layers_succeeded: int
    layers_failed: int
    total_raw_features: int
    total_final_features: int
    boundary_info: Optional[Dict[str, Any]] = None
    road_overlap_summary: Optional[Dict[str, Any]] = None
    layer_results: Dict[str, LayerProcessingResult] = Field(default_factory=dict)
    canonical_final_files: Dict[str, str] = Field(default_factory=dict)
    global_warnings: List[str] = Field(default_factory=list)
    global_errors: List[str] = Field(default_factory=list)

    def summary_dict(self) -> Dict[str, Any]:
        return self.model_dump()


class ProcessingPipeline:
    """
    Unified GIS Preprocessing Pipeline orchestrator.
    Executes tiered transformation, partial failure isolation, and reproducibility audits.
    """

    def __init__(self, config: ProcessingConfig):
        self.config = config
        self.base_output_dir = Path(config.base_output_dir)
        self.exporter = GeoJSONExporter(self.base_output_dir)
        self.crs_normalizer = CRSNormalizer(
            target_crs=config.target_crs,
            projected_crs=config.projected_crs,
        )
        self.geometry_cleaner = GeometryCleaner()
        self.feature_classifier = FeatureClassifier()
        self.spatial_validator = SpatialValidator(projected_crs=config.projected_crs)

    @staticmethod
    def _collect_environment_versions() -> Dict[str, str]:
        """Gathers library and runtime versions for complete reproducibility."""
        return {
            "python": sys.version.split()[0],
            "geopandas": gpd.__version__,
            "shapely": shapely.__version__,
            "pyproj": pyproj.__version__,
            "pydantic": pydantic.__version__,
            "fastapi": fastapi.__version__,
        }

    def execute(self) -> ProcessingPipelineReport:
        """
        Executes the unified preprocessing pipeline with partial failure reporting.
        """
        start_time = time.time()
        started_at = datetime.now(timezone.utc).isoformat()

        logger.info(
            "Starting Unified GIS Preprocessing Pipeline for '%s' (acquisition: %s)",
            self.config.village_name,
            self.config.acquisition_id,
        )

        layer_results: Dict[str, LayerProcessingResult] = {}
        processed_final_gdfs: Dict[str, gpd.GeoDataFrame] = {}
        global_warnings: List[str] = []
        global_errors: List[str] = []
        total_raw_count = 0
        total_final_count = 0

        # ==========================================================
        # STEP 1: LAYER-BY-LAYER PROCESSING (ISOLATED FAILURE SCOPES)
        # ==========================================================
        for layer_key, file_path_str in self.config.input_datasets.items():
            file_path = Path(file_path_str)
            logger.info("Pipeline processing layer '%s' from %s", layer_key, file_path)

            result = LayerProcessingResult(
                layer_name=layer_key,
                status="pending",
                input_file=str(file_path),
            )

            try:
                # 1.1 File Existence & Format Check
                if not file_path.exists():
                    raise FileNotFoundError(f"Input file not found: {file_path}")

                try:
                    gdf = gpd.read_file(file_path)
                except Exception as e:
                    raise ValueError(f"Failed to read geospatial format for {file_path}: {e}") from e

                result.raw_feature_count = len(gdf)
                total_raw_count += len(gdf)

                # 1.2 CRS Validation & Normalization
                if "crs_validation" in self.config.enabled_operations:
                    initial_crs = self.crs_normalizer.detect_and_validate_crs(gdf, layer_key)
                    result.initial_crs = initial_crs
                else:
                    initial_crs = str(gdf.crs)

                if "coordinate_normalization" in self.config.enabled_operations:
                    gdf, crs_audit = self.crs_normalizer.normalize_coordinates(gdf, layer_key)
                    result.target_crs = self.config.target_crs
                    if "export_intermediate" in self.config.enabled_operations:
                        exp_p = self.exporter.export_stage(
                            gdf, "normalized", self.config.acquisition_id, layer_key
                        )
                        result.exported_files["normalized"] = str(exp_p)

                # 1.3 Geometry Validation & Cleaning
                if "geometry_cleaning" in self.config.enabled_operations:
                    # Infer asset category
                    cat_hint = "building" if "build" in layer_key.lower() else "road" if "road" in layer_key.lower() else "parcel" if "parcel" in layer_key.lower() else "generic"
                    gdf, geom_report = self.geometry_cleaner.clean_geodataframe(
                        gdf=gdf,
                        asset_category=cat_hint,
                        dataset_name=layer_key,
                    )
                    result.geometry_cleaning_summary = geom_report.summary_dict()
                    if "export_intermediate" in self.config.enabled_operations:
                        exp_p = self.exporter.export_stage(
                            gdf, "cleaned", self.config.acquisition_id, layer_key
                        )
                        result.exported_files["cleaned"] = str(exp_p)

                # 1.4 Feature Classification & Vertical Staging
                if "feature_classification" in self.config.enabled_operations:
                    _, gdf, class_report = self.feature_classifier.classify_geodataframe_with_vertical_staging(
                        gdf=gdf,
                        source_name=self.config.source_name,
                        source_layer=layer_key,
                        id_column="uniq_id",
                        dataset_name=layer_key,
                    )
                    result.classification_summary = class_report.summary_dict()
                    if "export_intermediate" in self.config.enabled_operations:
                        exp_p = self.exporter.export_stage(
                            gdf, "classified", self.config.acquisition_id, layer_key
                        )
                        result.exported_files["classified"] = str(exp_p)

                # Mark layer successful
                result.status = "success"
                result.final_feature_count = len(gdf)
                processed_final_gdfs[layer_key] = gdf

            except Exception as exc:
                err_str = f"Error processing layer '{layer_key}': {exc}"
                logger.error(err_str, exc_info=True)
                result.status = "failed"
                result.error = err_str
                global_errors.append(err_str)

            layer_results[layer_key] = result

        # ==========================================================
        # STEP 2: BOUNDARY DERIVATION & SPATIAL VALIDATION
        # ==========================================================
        boundary_info = None
        overlap_summary = None
        derived_boundary_gdf: Optional[gpd.GeoDataFrame] = None

        if "spatial_validation" in self.config.enabled_operations and processed_final_gdfs:
            try:
                # Merge parcel and building datasets to derive village boundary
                valid_gdfs = [g for g in processed_final_gdfs.values() if not g.empty]
                if valid_gdfs:
                    combined_all = gpd.GeoDataFrame(
                        gpd.pd.concat(valid_gdfs, ignore_index=True),
                        crs=self.config.target_crs,
                    )

                    boundary_geom, boundary_def = self.spatial_validator.derive_boundary_from_features(
                        gdf=combined_all,
                        village_name=self.config.village_name,
                        buffer_meters=15.0,
                        projected_crs=self.config.projected_crs,
                    )

                    boundary_info = boundary_def.model_dump()

                    # Validate each layer against the boundary
                    for layer_key, gdf in list(processed_final_gdfs.items()):
                        audited_gdf, spatial_rep = self.spatial_validator.validate_dataset(
                            gdf=gdf,
                            boundary_geom=boundary_geom,
                            boundary_definition=boundary_def,
                            village_identifier=self.config.village_name,
                            id_column="feature_id",
                            category_column="category",
                        )
                        processed_final_gdfs[layer_key] = audited_gdf
                        layer_results[layer_key].spatial_validation_summary = spatial_rep.summary_dict()

                        if "export_intermediate" in self.config.enabled_operations:
                            exp_p = self.exporter.export_stage(
                                audited_gdf, "validated", self.config.acquisition_id, layer_key
                            )
                            layer_results[layer_key].exported_files["validated"] = str(exp_p)

                    # Export derived boundary GeoJSON
                    boundary_gdf = gpd.GeoDataFrame(
                        [{"boundary_name": boundary_def.boundary_name, "is_verified": boundary_def.is_verified, "geometry": boundary_geom}],
                        crs=self.config.target_crs,
                    )
                    derived_boundary_gdf = boundary_gdf
                    b_path = self.exporter.export_stage(
                        boundary_gdf, "validated", self.config.acquisition_id, f"{self.config.village_name.lower()}_boundary"
                    )
                    boundary_info["exported_boundary_file"] = str(b_path)

                    # Threat 1 Mitigation: Check building-road overlaps
                    building_key = next((k for k in processed_final_gdfs if "build" in k.lower()), None)
                    road_key = next((k for k in processed_final_gdfs if "road" in k.lower()), None)
                    if building_key and road_key:
                        b_gdf = processed_final_gdfs[building_key]
                        r_gdf = processed_final_gdfs[road_key]
                        audited_b_gdf, overlap_summary = self.spatial_validator.detect_building_road_overlaps(
                            building_gdf=b_gdf, road_gdf=r_gdf
                        )
                        processed_final_gdfs[building_key] = audited_b_gdf

            except Exception as exc:
                err_str = f"Spatial validation stage error: {exc}"
                logger.error(err_str, exc_info=True)
                global_errors.append(err_str)

        # ==========================================================
        # STEP 3: FINAL GEOJSON EXPORT & REPRODUCIBILITY AUDIT
        # ==========================================================
        canonical_final_files: Dict[str, str] = {}
        if "export_final" in self.config.enabled_operations:
            for layer_key, gdf in processed_final_gdfs.items():
                try:
                    exp_final = self.exporter.export_stage(
                        gdf, "final", self.config.acquisition_id, layer_key
                    )
                    layer_results[layer_key].exported_files["final"] = str(exp_final)
                    total_final_count += len(gdf)
                except Exception as exc:
                    err_str = f"Failed final export for {layer_key}: {exc}"
                    logger.error(err_str)
                    global_errors.append(err_str)

            # Export top-level canonical final layers (village_boundary, buildings, roads, water_bodies, land_parcels, community_assets)
            try:
                b_gdf = next((gdf for k, gdf in processed_final_gdfs.items() if "build" in k.lower()), None)
                r_gdf = next((gdf for k, gdf in processed_final_gdfs.items() if "road" in k.lower()), None)
                p_gdf = next((gdf for k, gdf in processed_final_gdfs.items() if "parcel" in k.lower()), None)
                w_gdf = next((gdf for k, gdf in processed_final_gdfs.items() if "water" in k.lower()), None)
                c_gdf = next((gdf for k, gdf in processed_final_gdfs.items() if "community" in k.lower()), None)

                canonical_paths = self.exporter.export_canonical_final_layers(
                    buildings_gdf=b_gdf,
                    roads_gdf=r_gdf,
                    land_parcels_gdf=p_gdf,
                    village_boundary_gdf=derived_boundary_gdf,
                    water_bodies_gdf=w_gdf,
                    community_assets_gdf=c_gdf,
                    crs=self.config.target_crs,
                )
                canonical_final_files = {k: str(v) for k, v in canonical_paths.items()}
            except Exception as exc:
                err_str = f"Failed canonical final layers export: {exc}"
                logger.error(err_str)
                global_errors.append(err_str)

        # Determine overall pipeline status
        success_count = sum(1 for r in layer_results.values() if r.status == "success")
        fail_count = sum(1 for r in layer_results.values() if r.status == "failed")

        if fail_count == 0:
            overall_status = "success"
        elif success_count > 0:
            overall_status = "partial_success"
        else:
            overall_status = "failed"

        duration = round(time.time() - start_time, 2)
        completed_at = datetime.now(timezone.utc).isoformat()

        report = ProcessingPipelineReport(
            village_name=self.config.village_name,
            acquisition_id=self.config.acquisition_id,
            source_name=self.config.source_name,
            started_at=started_at,
            completed_at=completed_at,
            duration_seconds=duration,
            overall_status=overall_status,
            software_versions=self._collect_environment_versions(),
            configuration=self.config.model_dump(),
            layers_evaluated=len(self.config.input_datasets),
            layers_succeeded=success_count,
            layers_failed=fail_count,
            total_raw_features=total_raw_count,
            total_final_features=total_final_count,
            boundary_info=boundary_info,
            road_overlap_summary=overlap_summary,
            layer_results=layer_results,
            canonical_final_files=canonical_final_files,
            global_warnings=global_warnings,
            global_errors=global_errors,
        )

        # Save formal report to data/processed/reports/<acquisition_id>/
        self.exporter.save_report(
            report.model_dump(),
            self.config.acquisition_id,
            f"pipeline_run_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}",
        )

        logger.info(
            "Pipeline completed in %.2fs: status=%s, succeeded=%d, failed=%d, total_features=%d",
            duration,
            overall_status,
            success_count,
            fail_count,
            total_final_count,
        )

        return report
