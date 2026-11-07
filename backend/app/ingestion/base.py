import asyncio
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import httpx

from app.config import settings
from app.schemas.geographic import (
    DataSourceMetadata,
    DatasetAcquisitionResult,
    GeographicExtent,
    LayerMetadata,
)

logger = logging.getLogger("ingestion")


class GISError(Exception):
    """Base exception for GIS ingestion errors."""

    pass


class ConnectionTimeoutError(GISError):
    """Raised when request times out."""

    pass


class InvalidResponseError(GISError):
    """Raised when server returns invalid or unexpected response."""

    pass


class LayerNotFoundError(GISError):
    """Raised when a requested layer ID does not exist in the service."""

    pass


class BaseGISConnector(ABC):
    """
    Reusable base connector for GIS data sources with retry logic,
    timeout handling, response validation, structured logging, and dual-layer persistence.
    """

    def __init__(
        self,
        source_name: str,
        base_url: str,
        ssl_verify: bool = True,
        timeout_seconds: Optional[float] = None,
        max_retries: Optional[int] = None,
        backoff_factor: Optional[float] = None,
    ):
        self.source_name = source_name
        self.base_url = base_url.rstrip("/")
        self.ssl_verify = ssl_verify
        self.timeout_seconds = timeout_seconds or settings.HTTP_TIMEOUT_SECONDS
        self.max_retries = max_retries or settings.HTTP_MAX_RETRIES
        self.backoff_factor = backoff_factor or settings.HTTP_RETRY_BACKOFF_FACTOR

    async def _execute_request_with_retry(
        self,
        url: str,
        method: str = "GET",
        params: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> httpx.Response:
        """
        Executes an HTTP request with exponential backoff retries.
        """
        attempt = 0
        last_exception: Optional[Exception] = None

        request_headers = headers or {}
        if "User-Agent" not in request_headers:
            request_headers["User-Agent"] = settings.OSM_USER_AGENT

        while attempt < self.max_retries:
            attempt += 1
            try:
                logger.debug(
                    "Executing %s request to %s (attempt %d/%d)",
                    method,
                    url,
                    attempt,
                    self.max_retries,
                )
                async with httpx.AsyncClient(
                    verify=self.ssl_verify,
                    timeout=httpx.Timeout(self.timeout_seconds),
                ) as client:
                    if method.upper() == "GET":
                        response = await client.get(url, params=params, headers=request_headers)
                    elif method.upper() == "POST":
                        response = await client.post(url, data=data, params=params, headers=request_headers)
                    else:
                        raise ValueError(f"Unsupported HTTP method: {method}")

                    # If server returns 5xx, retry
                    if response.status_code >= 500:
                        logger.warning(
                            "Server returned HTTP %d on attempt %d: %s",
                            response.status_code,
                            attempt,
                            response.text[:200],
                        )
                        last_exception = InvalidResponseError(
                            f"HTTP server error {response.status_code}: {response.text[:200]}"
                        )
                    else:
                        return response

            except httpx.TimeoutException as exc:
                logger.warning(
                    "Timeout connecting to %s on attempt %d: %s", url, attempt, exc
                )
                last_exception = ConnectionTimeoutError(f"Connection timed out: {exc}")
            except httpx.RequestError as exc:
                logger.warning(
                    "Network error connecting to %s on attempt %d: %s", url, attempt, exc
                )
                last_exception = GISError(f"Network request error: {exc}")

            if attempt < self.max_retries:
                sleep_time = self.backoff_factor ** (attempt - 1)
                logger.debug("Backing off for %.2f seconds before retry...", sleep_time)
                await asyncio.sleep(sleep_time)

        raise last_exception or GISError(f"Failed to fetch from {url} after {self.max_retries} attempts")

    def _save_raw_and_normalized_dataset(
        self,
        raw_content: str,
        normalized_geojson: Optional[Dict[str, Any]],
        subfolder: str,
        filename_stem: str,
        metadata: DataSourceMetadata,
    ) -> Tuple[str, str, Optional[str]]:
        """
        Saves:
        1. Original raw server response string (<stem>.raw.json or <stem>.raw.geojson).
        2. Normalized GeoJSON (<stem>.geojson) if available.
        3. Companion metadata (<stem>.meta.json).
        Returns: (raw_path, meta_path, normalized_path)
        """
        base_dir = Path(settings.RAW_DATA_DIR) / subfolder
        base_dir.mkdir(parents=True, exist_ok=True)

        raw_file = base_dir / f"{filename_stem}.raw.json"
        meta_file = base_dir / f"{filename_stem}.meta.json"
        normalized_file: Optional[Path] = None

        with open(raw_file, "w", encoding="utf-8") as f:
            f.write(raw_content)

        if normalized_geojson is not None:
            normalized_file = base_dir / f"{filename_stem}.geojson"
            with open(normalized_file, "w", encoding="utf-8") as f:
                json.dump(normalized_geojson, f, indent=2)

        with open(meta_file, "w", encoding="utf-8") as f:
            f.write(metadata.model_dump_json(indent=2))

        logger.info(
            "Saved raw dataset: %s, normalized: %s, metadata: %s",
            raw_file,
            normalized_file,
            meta_file,
        )
        return (
            str(raw_file),
            str(meta_file),
            str(normalized_file) if normalized_file else None,
        )

    def _save_raw_dataset(
        self,
        raw_content: str,
        subfolder: str,
        filename_stem: str,
        metadata: DataSourceMetadata,
    ) -> Tuple[str, str]:
        """Backward-compatible helper saving raw file and metadata sidecar."""
        raw_path, meta_path, _ = self._save_raw_and_normalized_dataset(
            raw_content=raw_content,
            normalized_geojson=None,
            subfolder=subfolder,
            filename_stem=filename_stem,
            metadata=metadata,
        )
        return raw_path, meta_path

    @abstractmethod
    async def test_connection(self) -> bool:
        """Verify endpoint connectivity."""
        pass

    @abstractmethod
    async def get_layer_metadata(self, layer_id: Union[int, str]) -> LayerMetadata:
        """Fetch schema metadata for a specified layer."""
        pass

    @abstractmethod
    async def acquire_dataset(
        self,
        layer_id: Union[int, str],
        where: Optional[str] = None,
        bbox: Optional[Tuple[float, float, float, float]] = None,
        limit: Optional[int] = None,
    ) -> DatasetAcquisitionResult:
        """Acquire geographic features and store them in raw storage."""
        pass
