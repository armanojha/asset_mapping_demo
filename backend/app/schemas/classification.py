"""
Schemas for standardized geographic feature classification.
Defines canonical categories, standardized feature models, and classification audit reports.
"""

from enum import Enum
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class PrimaryCategory(str, Enum):
    """Canonical primary geographic feature categories."""
    BUILDINGS = "BUILDINGS"
    ROADS = "ROADS"
    WATER_BODIES = "WATER_BODIES"
    LAND_PARCELS = "LAND_PARCELS"
    VEGETATION = "VEGETATION"
    AGRICULTURAL_LAND = "AGRICULTURAL_LAND"
    COMMUNITY_ASSETS = "COMMUNITY_ASSETS"
    ADMINISTRATIVE_BOUNDARIES = "ADMINISTRATIVE_BOUNDARIES"
    OTHER = "OTHER"


class StandardizedFeatureMetadata(BaseModel):
    """Provenance and processing metadata for a standardized feature."""
    original_crs: str = Field(default="EPSG:4326", description="Original coordinate reference system")
    processing_status: str = Field(default="validated", description="Current pipeline processing status")
    classification_method: str = Field(
        default="source_attribute_mapping",
        description="Method used for classification (e.g. source_attribute_mapping, default_layer_fallback)",
    )
    classification_confidence: float = Field(
        default=1.0, ge=0.0, le=1.0, description="Confidence score of classification rule match"
    )
    raw_properties_count: int = Field(default=0, description="Number of original attributes captured")
    processing_notes: List[str] = Field(default_factory=list, description="Audit log of applied transformations")


class StandardizedFeature(BaseModel):
    """
    Standardized internal geographic feature representation.
    Preserves original provenance while normalizing category and attributes.
    Follows GeoJSON Feature structural conventions.
    """
    feature_id: str = Field(..., description="Unique internal system identifier (UUID or deterministic ID)")
    source_id: Optional[Union[str, int]] = Field(None, description="Original feature identifier from source data")
    source_name: str = Field(..., description="Data source name (e.g. grammanchitra, svamitva, osm)")
    source_layer: Optional[str] = Field(None, description="Original source layer or dataset name")
    category: PrimaryCategory = Field(..., description="Standardized primary category")
    subcategory: Optional[str] = Field(None, description="Domain subcategory (e.g. residential, school, paved_road)")
    geometry_type: str = Field(..., description="GeoJSON geometry type (e.g. Polygon, MultiPolygon, LineString)")
    geometry: Dict[str, Any] = Field(..., description="GeoJSON geometry dictionary (type + coordinates)")
    properties: Dict[str, Any] = Field(
        default_factory=dict,
        description="Normalized properties dictionary including raw attributes under 'raw_attributes'",
    )
    metadata: StandardizedFeatureMetadata = Field(
        default_factory=StandardizedFeatureMetadata,
        description="Provenance and processing history metadata",
    )

    def to_geojson_feature(self) -> Dict[str, Any]:
        """Serializes the standardized feature into a standard GeoJSON Feature object."""
        props = dict(self.properties)
        props.update({
            "feature_id": self.feature_id,
            "source_id": self.source_id,
            "source_name": self.source_name,
            "source_layer": self.source_layer,
            "category": self.category.value,
            "subcategory": self.subcategory,
            "_metadata": self.metadata.model_dump(),
        })
        return {
            "type": "Feature",
            "id": self.feature_id,
            "geometry": self.geometry,
            "properties": props,
        }


class StandardizedFeatureCollection(BaseModel):
    """GeoJSON FeatureCollection wrapper for standardized features."""
    type: str = Field(default="FeatureCollection")
    features: List[StandardizedFeature] = Field(default_factory=list)
    dataset_name: Optional[str] = Field(None, description="Optional collection or village identifier")
    total_count: int = Field(default=0)


class ClassificationRuleMatch(BaseModel):
    """Audit record of a matched classification rule."""
    field_matched: Optional[str] = None
    value_matched: Optional[Any] = None
    match_type: str = Field(default="exact", description="exact, case_insensitive, layer_fallback, or fallback_other")
    target_category: PrimaryCategory
    target_subcategory: Optional[str] = None


class ClassificationReport(BaseModel):
    """Comprehensive dataset classification report."""
    dataset_name: str
    source_name: str
    total_features: int
    category_counts: Dict[str, int] = Field(default_factory=dict)
    subcategory_counts: Dict[str, int] = Field(default_factory=dict)
    unclassified_features_count: int = Field(default=0, description="Features classified as OTHER")
    unclassified_feature_samples: List[Dict[str, Any]] = Field(
        default_factory=list, description="Sample of attributes from unclassified features"
    )
    rule_match_stats: Dict[str, int] = Field(
        default_factory=dict, description="Histogram of rule types matched"
    )

    def summary_dict(self) -> Dict[str, Any]:
        """Compact summary excluding sample records."""
        return self.model_dump(exclude={"unclassified_feature_samples"})
