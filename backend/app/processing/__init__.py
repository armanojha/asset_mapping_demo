"""
Unified GIS processing package for the Village Asset Mapping System.
Orchestrates format detection, CRS validation, coordinate normalization, geometry cleaning,
feature classification, spatial validation, non-destructive export, and reproducibility audits.
"""

from app.processing.crs_normalizer import CRSNormalizer, CRSValidationError
from app.processing.feature_classifier import FeatureClassifier
from app.processing.geojson_exporter import GeoJSONExporter, GeoJSONExportError
from app.processing.geometry_cleaner import GeometryCleaner
from app.processing.pipeline import (
    LayerProcessingResult,
    ProcessingConfig,
    ProcessingPipeline,
    ProcessingPipelineReport,
)
from app.processing.spatial_validator import SpatialValidator

__all__ = [
    "CRSNormalizer",
    "CRSValidationError",
    "GeometryCleaner",
    "FeatureClassifier",
    "SpatialValidator",
    "GeoJSONExporter",
    "GeoJSONExportError",
    "ProcessingConfig",
    "LayerProcessingResult",
    "ProcessingPipelineReport",
    "ProcessingPipeline",
]
