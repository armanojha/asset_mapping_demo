"""GIS data ingestion connectors package."""
from app.ingestion.base import (
    BaseGISConnector,
    GISError,
    ConnectionTimeoutError,
    InvalidResponseError,
)
from app.ingestion.grammanchitra import GramManchitraConnector
from app.ingestion.svamitva import SvamitvaConnector
from app.ingestion.osm import OpenStreetMapConnector

__all__ = [
    "BaseGISConnector",
    "GISError",
    "ConnectionTimeoutError",
    "InvalidResponseError",
    "GramManchitraConnector",
    "SvamitvaConnector",
    "OpenStreetMapConnector",
]
