import logging
from fastapi import APIRouter, Depends, status
from app.schemas.village import (
    VillageAcquisitionRequest,
    VillageAcquisitionResponse,
)
from app.services.village_acquisition import VillageAcquisitionService

logger = logging.getLogger("api.villages")

router = APIRouter()


def get_village_acquisition_service() -> VillageAcquisitionService:
    """Dependency provider for VillageAcquisitionService."""
    return VillageAcquisitionService()


@router.post(
    "/villages/acquire",
    response_model=VillageAcquisitionResponse,
    status_code=status.HTTP_200_OK,
    summary="Acquire Village GIS Infrastructure Data",
    description="""
    Queries approved GIS data sources (Gram Manchitra, SVAMITVA, OpenStreetMap)
    for a selected village, persisting raw datasets and sidecar metadata,
    and returning a structured acquisition report.
    Supports partial success if individual sources fail or return empty sets.
    """,
)
async def acquire_village_data(
    request: VillageAcquisitionRequest,
    service: VillageAcquisitionService = Depends(get_village_acquisition_service),
) -> VillageAcquisitionResponse:
    logger.info(
        "Received village acquisition request: state=%s, village=%s, sources=%s",
        request.state,
        request.village,
        request.sources,
    )
    response = await service.acquire_village(request)
    return response
