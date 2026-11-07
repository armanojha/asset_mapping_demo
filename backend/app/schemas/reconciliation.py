"""
Schemas for duplicate feature reconciliation, attribute merging, and local metric origin centering.
"""

from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class VillageAnchorOrigin(BaseModel):
    """
    Geodetic and metric anchor point for centering 3D procedural meshes.
    Prevents single-precision WebGL floating point jitter.
    """
    village_name: str
    projected_crs: str = Field(default="EPSG:32644", description="Metric projected CRS (e.g. UTM Zone 44N)")
    origin_x_utm: float = Field(..., description="Projected Easting (X) anchor coordinate in meters")
    origin_y_utm: float = Field(..., description="Projected Northing (Y) anchor coordinate in meters")
    origin_lon_wgs84: float = Field(..., description="WGS84 Longitude of village anchor")
    origin_lat_wgs84: float = Field(..., description="WGS84 Latitude of village anchor")
    bounds_local_m: Optional[List[float]] = Field(
        None, description="Local bounding box in meters: [min_x, min_y, max_x, max_y] relative to origin"
    )


class ReconciliationReport(BaseModel):
    """Audit report of duplicate reconciliation and attribute merging."""
    dataset_name: str
    original_feature_count: int
    unique_feature_count: int
    duplicates_merged_count: int
    reconciled_attributes_count: int = Field(default=0, description="Total null attributes rescued from twin records")
    attribute_conflicts_count: int = Field(default=0, description="Conflicting non-null attribute occurrences")
    conflicts_log: List[Dict[str, Any]] = Field(default_factory=list)

    def summary_dict(self) -> Dict[str, Any]:
        """Compact summary excluding conflict logs."""
        return self.model_dump(exclude={"conflicts_log"})
