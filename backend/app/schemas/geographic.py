from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field


class GeographicExtent(BaseModel):
    """Geographic bounding box in source CRS."""

    xmin: float = Field(..., description="Minimum X coordinate / Longitude / Easting")
    ymin: float = Field(..., description="Minimum Y coordinate / Latitude / Northing")
    xmax: float = Field(..., description="Maximum X coordinate / Longitude / Easting")
    ymax: float = Field(..., description="Maximum Y coordinate / Latitude / Northing")
    spatial_reference: Optional[Union[str, int, Dict[str, Any]]] = Field(
        default=None, description="Spatial reference system definition"
    )


class LayerField(BaseModel):
    """Attribute field definition from GIS service."""

    name: str = Field(..., description="System field attribute name")
    field_type: str = Field(..., description="Data type of the field")
    alias: Optional[str] = Field(default=None, description="Display alias for the field")
    nullable: Optional[bool] = Field(default=True, description="Whether null values are permitted")


class LayerMetadata(BaseModel):
    """Metadata for an individual GIS layer."""

    layer_id: Union[int, str] = Field(..., description="Identifier for the layer")
    layer_name: str = Field(..., description="Human-readable name of the layer")
    geometry_type: str = Field(..., description="Type of geometry (Polygon, LineString, Point, etc.)")
    fields: List[LayerField] = Field(default_factory=list, description="Attribute schema definition")
    description: Optional[str] = Field(default=None, description="Layer description or comments")
    max_record_count: Optional[int] = Field(default=None, description="Max queryable batch record count")
    extent: Optional[GeographicExtent] = Field(default=None, description="Layer geographic bounding box")


class GeographicFeatureMetadata(BaseModel):
    """Metadata representing an individual ingested GIS feature while preserving all source attributes."""

    feature_id: Union[int, str] = Field(..., description="Feature unique identifier")
    source_layer_id: Union[int, str] = Field(..., description="Originating layer ID")
    geometry_type: str = Field(..., description="GeoJSON geometry type")
    properties: Dict[str, Any] = Field(
        default_factory=dict,
        description="Preserved raw source attributes (e.g. plot numbers, LGD codes, asset names)",
    )


class DataSourceMetadata(BaseModel):
    """Sidecar metadata describing a downloaded raw GIS dataset."""

    source_name: str = Field(..., description="Name of the GIS provider (e.g. Gram Manchitra, SVAMITVA, OSM)")
    endpoint_url: str = Field(..., description="Original REST API endpoint called")
    layer_id: Union[int, str] = Field(..., description="Identifier of the layer acquired")
    download_timestamp: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        description="UTC timestamp when data was fetched",
    )
    crs: str = Field(default="EPSG:4326", description="Coordinate Reference System of the payload")
    format: str = Field(default="GeoJSON", description="Data payload serialization format")
    record_count: int = Field(default=0, description="Total number of features acquired")
    extent: Optional[GeographicExtent] = Field(default=None, description="Bounding box of acquired dataset")
    query_params: Dict[str, Any] = Field(default_factory=dict, description="Query parameters used for ingestion")


class DatasetAcquisitionResult(BaseModel):
    """Result summary of a dataset acquisition job."""

    success: bool = Field(..., description="Whether the acquisition completed without error")
    source: str = Field(..., description="Data provider identifier")
    layer_id: Union[int, str] = Field(..., description="Layer requested")
    file_path: Optional[str] = Field(default=None, description="Relative path to raw data file")
    metadata_path: Optional[str] = Field(default=None, description="Relative path to JSON sidecar metadata")
    feature_count: int = Field(default=0, description="Number of features saved")
    error_message: Optional[str] = Field(default=None, description="Error explanation if unsuccessful")
    execution_time_seconds: float = Field(default=0.0, description="Total elapsed seconds")
    metadata: Optional[DataSourceMetadata] = Field(default=None, description="Full sidecar metadata")
