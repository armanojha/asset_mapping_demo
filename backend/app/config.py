from pathlib import Path
from typing import List, Union
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Project root directory (one level above backend/)
BASE_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    PROJECT_NAME: str = "Village Asset Mapping System"
    VERSION: str = "0.1.0"
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    API_V1_STR: str = "/api/v1"

    # CORS configuration
    CORS_ORIGINS: Union[List[str], str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ]

    # GIS Data Ingestion - Gram Manchitra
    GRAM_MANCHITRA_BASE_URL: str = (
        "https://grammanchitragis.nic.in/grammanchitra/rest/services"
    )
    GRAM_MANCHITRA_SOI_MP_URL: str = (
        "https://grammanchitragis.nic.in/grammanchitra/rest/services/SOI_Svamitva/SOI_MP/MapServer"
    )
    GRAM_MANCHITRA_SSL_VERIFY: bool = False

    # GIS Data Ingestion - SVAMITVA
    SVAMITVA_POC_URL: str = (
        "https://grammanchitragis.nic.in/grammanchitra/rest/services/panchayat/svamitva_POC_Vehicle/MapServer"
    )
    SVAMITVA_SSL_VERIFY: bool = False

    # GIS Data Ingestion - OpenStreetMap
    OSM_OVERPASS_URL: str = "https://overpass-api.de/api/interpreter"
    OSM_USER_AGENT: str = "VillageAssetMappingSystem/0.1.0 (GIS Ingestion Pipeline)"

    # HTTP Client Controls
    HTTP_TIMEOUT_SECONDS: float = 30.0
    HTTP_MAX_RETRIES: int = 3
    HTTP_RETRY_BACKOFF_FACTOR: float = 1.5

    # Storage Paths (resolved to project root data directories)
    DATA_DIR: str = str(BASE_DIR / "data")
    RAW_DATA_DIR: str = str(BASE_DIR / "data" / "raw")
    PROCESSED_DATA_DIR: str = str(BASE_DIR / "data" / "processed")
    GENERATED_DATA_DIR: str = str(BASE_DIR / "data" / "generated")

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",") if i.strip()]
        elif isinstance(v, list):
            return v
        return [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:5173",
        ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
