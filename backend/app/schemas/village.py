from typing import Any, Dict, List, Optional, Tuple, Union
from pydantic import BaseModel, Field


class VillageIdentifier(BaseModel):
    """Administrative identifier and geographical context for a village."""

    state: str = Field(..., description="State name", examples=["Madhya Pradesh"])
    district: Optional[str] = Field(default=None, description="District name", examples=["Sehore"])
    block: Optional[str] = Field(default=None, description="Block / Tehsil / Sub-district name")
    gram_panchayat: Optional[str] = Field(default=None, description="Gram Panchayat name")
    village: str = Field(..., description="Village name", examples=["Gudwara"])
    village_code: Optional[str] = Field(
        default=None,
        description="Official administrative code (e.g. Census Code or LGD Village Code)",
        examples=["491275"],
    )
    bounding_box: Optional[Tuple[float, float, float, float]] = Field(
        default=None,
        description="Optional bounding box envelope (min_lon, min_lat, max_lon, max_lat) in WGS84 EPSG:4326",
    )


class VillageAcquisitionRequest(BaseModel):
    """Request payload to initiate village geographical data acquisition."""

    state: str = Field(..., description="State name", examples=["Madhya Pradesh"])
    district: Optional[str] = Field(default=None, description="District name")
    block: Optional[str] = Field(default=None, description="Block / Tehsil name")
    gram_panchayat: Optional[str] = Field(default=None, description="Gram Panchayat name")
    village: str = Field(..., description="Village name", examples=["Example Village"])
    village_code: Optional[str] = Field(
        default=None,
        description="Official LGD or Census village code if known",
    )
    bounding_box: Optional[Tuple[float, float, float, float]] = Field(
        default=None,
        description="Optional bounding box (min_lon, min_lat, max_lon, max_lat)",
    )
    sources: List[str] = Field(
        default=["grammanchitra", "svamitva"],
        description="List of GIS sources to query (supported: 'grammanchitra', 'svamitva', 'osm')",
    )
    max_features_per_layer: Optional[int] = Field(
        default=1000,
        description="Maximum features to retrieve per layer (protects against unbounded queries)",
    )


class AcquiredLayerSummary(BaseModel):
    """Summary of an individual layer retrieved during village data acquisition."""

    source: str = Field(..., description="GIS provider source identifier")
    layer_id: Union[int, str] = Field(..., description="Layer ID or name")
    layer_name: str = Field(..., description="Human-readable layer name")
    geometry_type: str = Field(..., description="Geometry type (Polygon, LineString, etc.)")
    feature_count: int = Field(default=0, description="Number of features acquired")
    status: str = Field(..., description="Status: 'success', 'empty', or 'failed'")
    file_path: Optional[str] = Field(default=None, description="Path to normalized GeoJSON file")
    raw_file_path: Optional[str] = Field(default=None, description="Path to raw server response")
    error_message: Optional[str] = Field(default=None, description="Error message if failed")


class VillageAcquisitionResponse(BaseModel):
    """Structured report returned upon village data acquisition completion."""

    acquisition_id: str = Field(..., description="Unique UUID for this acquisition task")
    village: VillageIdentifier = Field(..., description="Village query identification context")
    sources_queried: List[str] = Field(default_factory=list, description="List of GIS sources queried")
    layers_retrieved: List[AcquiredLayerSummary] = Field(
        default_factory=list, description="Detailed list of layers processed"
    )
    feature_counts: Dict[str, int] = Field(
        default_factory=dict, description="Aggregate feature counts per layer/source"
    )
    downloaded_files: List[str] = Field(
        default_factory=list, description="All persisted dataset files on disk"
    )
    crs: str = Field(default="EPSG:4326", description="Coordinate Reference System of acquired datasets")
    partial_success: bool = Field(
        default=False,
        description="True if at least one layer succeeded while another failed or returned empty",
    )
    warnings: List[str] = Field(default_factory=list, description="Non-fatal warnings or limitations encountered")
    errors: List[str] = Field(default_factory=list, description="Fatal errors encountered for specific sources")
