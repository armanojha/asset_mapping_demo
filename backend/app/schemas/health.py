from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Pydantic model representing system health response."""

    status: str = Field(
        ...,
        description="Operational status of the service",
        examples=["healthy"],
    )
    application: str = Field(
        ...,
        description="Name of the application",
        examples=["Village Asset Mapping System"],
    )
    version: str = Field(
        ...,
        description="Current semantic version of the application",
        examples=["0.1.0"],
    )
