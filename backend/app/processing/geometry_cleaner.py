"""
Geometry validation and repair module for the unified processing pipeline.
Performs topological validation, collection extraction, CCW winding normalization,
and line deduplication without destructive alteration.
"""

import logging
from typing import Optional

import geopandas as gpd

from app.preprocessing.geometry_cleaner import GeometryCleaner
from app.schemas.preprocessing import GeometryRepairReport

logger = logging.getLogger("processing.geometry_cleaner")

__all__ = ["GeometryCleaner", "GeometryRepairReport"]
