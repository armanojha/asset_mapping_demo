from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class GeometryValidationStatus(str, Enum):
    VALID = "valid"
    REPAIRED = "repaired"
    INVALID_UNREPAIRABLE = "invalid_unrepairable"
    EMPTY = "empty"
    NULL = "null"
    UNEXPECTED_TYPE = "unexpected_type"


class FeatureGeometryAudit(BaseModel):
    """Detailed validation and repair audit for an individual feature geometry."""

    feature_index: int = Field(..., description="Row index in dataset")
    source_feature_id: Optional[Union[str, int]] = Field(
        default=None, description="Original source primary key (e.g. objectid or uniq_id)"
    )
    original_geom_type: Optional[str] = Field(default=None, description="Geometry type before cleaning")
    cleaned_geom_type: Optional[str] = Field(default=None, description="Geometry type after cleaning")
    initial_validity: bool = Field(..., description="Whether geometry was initially valid")
    validity_reason: Optional[str] = Field(default=None, description="Explanation of validity or invalidity")
    status: GeometryValidationStatus = Field(..., description="Final validation status")
    repair_operations: List[str] = Field(default_factory=list, description="Ordered list of repair operations applied")
    was_repaired: bool = Field(default=False, description="True if geometry was modified to achieve validity")
    is_empty_or_null: bool = Field(default=False, description="True if geometry is null or empty")
    unexpected_type_warning: Optional[str] = Field(default=None, description="Warning if geometry type deviates from rules")


class GeometryRepairReport(BaseModel):
    """Comprehensive dataset-level summary of geometry validation and repairs."""

    dataset_name: str = Field(..., description="Name or identifier of the dataset processed")
    asset_category: str = Field(..., description="Asset category rule applied (building, road, parcel, water, boundary)")
    original_feature_count: int = Field(..., description="Total feature count before processing")
    valid_geometries_count: int = Field(default=0, description="Count of initially valid geometries")
    invalid_geometries_count: int = Field(default=0, description="Count of initially invalid geometries")
    repaired_geometries_count: int = Field(default=0, description="Count of successfully repaired geometries")
    unrepairable_geometries_count: int = Field(default=0, description="Count of geometries that could not be repaired")
    empty_geometries_count: int = Field(default=0, description="Count of empty geometries")
    null_geometries_count: int = Field(default=0, description="Count of null geometries")
    duplicate_geometries_count: int = Field(default=0, description="Count of exact duplicate geometries")
    removed_geometries_count: int = Field(default=0, description="Count of removed geometries (0 by rule)")
    geometry_type_changes: Dict[str, int] = Field(
        default_factory=dict, description="Histogram of geometry type transitions (e.g. 'Polygon -> MultiPolygon': 2)"
    )
    unexpected_geometry_types: Dict[str, int] = Field(
        default_factory=dict, description="Count of unexpected geometry types encountered"
    )
    feature_audits: List[FeatureGeometryAudit] = Field(
        default_factory=list, description="Detailed audit record per feature"
    )

    def summary_dict(self) -> Dict[str, Any]:
        """Compact summary excluding detailed feature array."""
        d = self.model_dump(exclude={"feature_audits"})
        return d
