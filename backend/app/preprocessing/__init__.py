"""GIS data preprocessing and normalization package."""
from app.preprocessing.geometry_cleaner import GeometryCleaner
from app.preprocessing.feature_classifier import FeatureClassifier
from app.preprocessing.spatial_validator import SpatialValidator
from app.preprocessing.feature_reconciler import FeatureReconciler
from app.preprocessing.pipeline import (
    clean_acquisition_bundle,
    clean_dataset_file,
    detect_asset_category_from_filename,
    detect_id_column,
)

__all__ = [
    "GeometryCleaner",
    "FeatureClassifier",
    "SpatialValidator",
    "FeatureReconciler",
    "clean_dataset_file",
    "clean_acquisition_bundle",
    "detect_asset_category_from_filename",
    "detect_id_column",
]
