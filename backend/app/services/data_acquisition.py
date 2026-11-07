import logging
from typing import Any, Dict, List, Optional, Tuple, Union

from app.ingestion.grammanchitra import GramManchitraConnector
from app.ingestion.osm import OpenStreetMapConnector
from app.ingestion.svamitva import SvamitvaConnector
from app.schemas.geographic import DatasetAcquisitionResult, LayerMetadata

logger = logging.getLogger("services.data_acquisition")


class DataAcquisitionService:
    """
    Coordinates multi-source GIS data acquisition across Gram Manchitra,
    SVAMITVA, and OpenStreetMap.
    """

    def __init__(
        self,
        grammanchitra_connector: Optional[GramManchitraConnector] = None,
        svamitva_connector: Optional[SvamitvaConnector] = None,
        osm_connector: Optional[OpenStreetMapConnector] = None,
    ):
        self.grammanchitra = grammanchitra_connector or GramManchitraConnector()
        self.svamitva = svamitva_connector or SvamitvaConnector()
        self.osm = osm_connector or OpenStreetMapConnector()

    async def check_connectivity(self) -> Dict[str, bool]:
        """Test health and connectivity of all configured GIS providers."""
        return {
            "grammanchitra": await self.grammanchitra.test_connection(),
            "svamitva": await self.svamitva.test_connection(),
            "osm": await self.osm.test_connection(),
        }

    async def get_layer_catalog(self) -> Dict[str, List[LayerMetadata]]:
        """Fetch available layer metadata across connectors."""
        catalog: Dict[str, List[LayerMetadata]] = {
            "grammanchitra": [],
            "svamitva": [],
            "osm": [],
        }

        # Gram Manchitra core layers (0: Road, 1: Built_Up_Area, 2: Parcel_Area)
        for lid in [0, 1, 2]:
            try:
                meta = await self.grammanchitra.get_layer_metadata(lid)
                catalog["grammanchitra"].append(meta)
            except Exception as e:
                logger.warning("Could not fetch Gram Manchitra layer %s: %s", lid, e)

        # SVAMITVA core layers (0: Road_Centerline, 1: Road_Poly)
        for lid in [0, 1]:
            try:
                meta = await self.svamitva.get_layer_metadata(lid)
                catalog["svamitva"].append(meta)
            except Exception as e:
                logger.warning("Could not fetch SVAMITVA layer %s: %s", lid, e)

        # OSM virtual categories
        for cat in ["all", "amenities", "roads", "water"]:
            meta = await self.osm.get_layer_metadata(cat)
            catalog["osm"].append(meta)

        return catalog

    async def acquire_village_assets(
        self,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        village_lgd_code: Optional[str] = None,
        include_osm: bool = True,
        limit_per_layer: int = 100,
    ) -> Dict[str, List[DatasetAcquisitionResult]]:
        """
        Coordinates acquisition of village data across available sources.
        """
        results: Dict[str, List[DatasetAcquisitionResult]] = {
            "grammanchitra": [],
            "svamitva": [],
            "osm": [],
        }

        where_clause = f"village_code='{village_lgd_code}'" if village_lgd_code else "1=1"

        # 1. Acquire Gram Manchitra built-up structures and roads
        for lid in [0, 1]:
            res = await self.grammanchitra.acquire_dataset(
                layer_id=lid,
                where=where_clause,
                bbox=bbox,
                limit=limit_per_layer,
            )
            results["grammanchitra"].append(res)

        # 2. Acquire SVAMITVA road centerline
        sv_res = await self.svamitva.acquire_dataset(
            layer_id=0,
            bbox=bbox,
            limit=limit_per_layer,
        )
        results["svamitva"].append(sv_res)

        # 3. Acquire OSM supplementary infrastructure
        if include_osm and bbox:
            osm_res = await self.osm.acquire_dataset(
                layer_id="all",
                bbox=bbox,
                limit=limit_per_layer,
            )
            results["osm"].append(osm_res)

        return results
