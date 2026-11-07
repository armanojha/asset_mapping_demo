"""
Schemas for spatial validation, boundary relationships, metric analysis, and spatial quality reporting.
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class SpatialRelationStatus(str, Enum):
    """Spatial relationship of a feature relative to the village boundary."""
    FULLY_INSIDE = "fully_inside"
    INTERSECTING_CROSSING = "intersecting_crossing"
    OUTSIDE = "outside"
    OUTLIER_SUSPICIOUS = "outlier_suspicious"


class ClippingStatus(str, Enum):
    """Status of geometry clipping against the village boundary."""
    NOT_CLIPPED = "not_clipped"
    CLIPPED_CROSSING = "clipped_crossing"
    OUTSIDE_UNCLIPPED = "outside_unclipped"


class BoundaryType(str, Enum):
    """Classification of the boundary geometry used for spatial validation."""
    VERIFIED_ADMINISTRATIVE = "verified_administrative"
    DERIVED_CADASTRAL_HULL = "derived_cadastral_hull"
    GRAM_PANCHAYAT_PROXY = "gram_panchayat_proxy"


class BoundaryDefinition(BaseModel):
    """Metadata describing the boundary geometry utilized."""
    boundary_name: str
    boundary_type: BoundaryType
    is_verified: bool = Field(..., description="Whether this is a legally verified revenue village boundary")
    source_layer: Optional[str] = None
    crs: str = Field(default="EPSG:4326")
    area_sqm: Optional[float] = None
    bounding_box: Optional[List[float]] = None
    notes: Optional[str] = None


class FeatureSpatialAudit(BaseModel):
    """Row-level spatial validation audit for an individual feature."""
    feature_id: str
    source_id: Optional[Union[str, int]] = None
    category: str
    spatial_relation: SpatialRelationStatus
    distance_to_boundary_meters: float = Field(
        default=0.0, description="0.0 if inside or crossing; metric distance to boundary exterior if outside"
    )
    clipping_status: ClippingStatus = Field(default=ClippingStatus.NOT_CLIPPED)
    area_original_sqm: Optional[float] = None
    area_clipped_sqm: Optional[float] = None
    is_suspicious: bool = False
    suspicious_reason: Optional[str] = None


class SpatialValidationReport(BaseModel):
    """Comprehensive spatial quality and boundary alignment audit report."""
    village_identifier: str
    boundary_used: BoundaryDefinition
    projected_crs: str = Field(default="EPSG:32644", description="Metric projected CRS used for calculations")
    total_features_evaluated: int
    fully_inside_count: int = 0
    partially_intersecting_count: int = 0
    outside_count: int = 0
    suspicious_outlier_count: int = 0
    category_spatial_breakdown: Dict[str, Dict[str, int]] = Field(
        default_factory=dict,
        description="Spatial distribution counts per category: {BUILDING: {fully_inside: X, crossing: Y, outside: Z}}",
    )
    potential_alignment_issues: List[str] = Field(default_factory=list)
    audits: List[FeatureSpatialAudit] = Field(default_factory=list)

    def summary_dict(self) -> Dict[str, Any]:
        """Compact summary excluding individual feature audit items."""
        return self.model_dump(exclude={"audits"})
