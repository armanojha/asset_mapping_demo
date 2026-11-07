from fastapi import APIRouter
from app.config import settings
from app.schemas.health import HealthResponse

router = APIRouter()


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Service Health Check",
    description="Returns the health status, application name, and version.",
)
async def get_health() -> HealthResponse:
    """Return health status information."""
    return HealthResponse(
        status="healthy",
        application=settings.PROJECT_NAME,
        version=settings.VERSION,
    )
