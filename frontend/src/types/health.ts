export interface HealthStatusResponse {
  status: string;
  application: string;
  version: string;
}

export type ConnectionState = 'idle' | 'loading' | 'connected' | 'error';

export interface HealthCheckState {
  state: ConnectionState;
  data: HealthStatusResponse | null;
  error: string | null;
  lastChecked: Date | null;
}
