import { HealthStatusResponse } from '../types';

/**
 * Retrieves the base URL for the backend API from environment variables,
 * falling back to default local backend URL if not defined.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';

export class ApiError extends Error {
  public statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Checks backend health by querying the health endpoint.
 */
export async function checkBackendHealth(): Promise<HealthStatusResponse> {
  const endpoint = `${API_BASE_URL}/health`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new ApiError(
        `Server responded with HTTP ${response.status}: ${response.statusText}`,
        response.status,
      );
    }

    const data: HealthStatusResponse = await response.json();
    return data;
  } catch (err: unknown) {
    if (err instanceof ApiError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Unknown network error';
    throw new ApiError(`Unable to reach backend at ${API_BASE_URL}: ${message}`);
  }
}
