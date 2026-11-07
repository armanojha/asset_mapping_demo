import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { BackendStatus } from './components/BackendStatus';
import { checkBackendHealth } from './services/api';
import { HealthCheckState } from './types';

const App: React.FC = () => {
  const [healthState, setHealthState] = useState<HealthCheckState>({
    state: 'idle',
    data: null,
    error: null,
    lastChecked: null,
  });

  const fetchHealth = useCallback(async () => {
    setHealthState((prev) => ({
      ...prev,
      state: 'loading',
      error: null,
    }));

    try {
      const data = await checkBackendHealth();
      setHealthState({
        state: 'connected',
        data,
        error: null,
        lastChecked: new Date(),
      });
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown communication error';
      setHealthState({
        state: 'error',
        data: null,
        error: errorMessage,
        lastChecked: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <Header title="Village Asset Mapping System" version="0.1.0" />

      <main style={{ padding: '2rem 1rem' }}>
        <BackendStatus healthState={healthState} onRefresh={fetchHealth} />

        <div
          style={{
            maxWidth: '600px',
            margin: '1.5rem auto',
            padding: '1.25rem',
            backgroundColor: '#ffffff',
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            textAlign: 'left',
          }}
        >
          <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.5rem 0', color: '#1e293b' }}>
            System Architecture Readiness
          </h2>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#64748b', fontSize: '0.875rem', lineHeight: '1.6' }}>
            <li>Procedural 2.5D isometric world pipeline ready for initialization.</li>
            <li>Three.js, React Three Fiber & Drei libraries installed for 3D viewports.</li>
            <li>Modular frontend architecture (`scene`, `generators`, `loaders`, `services`).</li>
            <li>FastAPI backend ready with CORS and standardized schemas.</li>
          </ul>
        </div>
      </main>
    </div>
  );
};

export default App;
