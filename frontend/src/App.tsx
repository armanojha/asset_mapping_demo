import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { BackendStatus } from './components/BackendStatus';
import { VillageViewport } from './scene/VillageViewport';
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
        backgroundColor: '#0f172a',
        color: '#f8fafc',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <Header title="Village Asset Mapping System - 2.5D Isometric World" version="0.4.0" />

      <main style={{ padding: '1.5rem', maxWidth: '1440px', margin: '0 auto' }}>
        {/* Interactive 3D Real Village Viewport */}
        <section style={{ marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700, color: '#f8fafc' }}>
                Living Digital Village — 2.5D Isometric Diorama (Phase 4)
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                Rendering actual cadastral building footprints from SVAMITVA &amp; Gram Manchitra surveys in a handcrafted Central Indian diorama. Click any building to inspect its cadastral metadata.
              </p>
            </div>
          </div>

          <VillageViewport />
        </section>

        {/* Backend Status & System Telemetry */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
          <BackendStatus healthState={healthState} onRefresh={fetchHealth} />

          <div
            style={{
              padding: '1.25rem',
              backgroundColor: '#1e293b',
              borderRadius: '12px',
              border: '1px solid #334155',
              textAlign: 'left',
            }}
          >
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem 0', color: '#f8fafc', fontWeight: 600 }}>
              Phase 4 Living Diorama &amp; Spatial Analytics Status
            </h3>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#94a3b8', fontSize: '0.825rem', lineHeight: '1.6' }}>
              <li><strong style={{ color: '#38bdf8' }}>Diorama Pedestal</strong>: Monolithic sandstone base extruded -6.0m from official village boundary.</li>
              <li><strong style={{ color: '#38bdf8' }}>Central Indian Palette</strong>: Chuna lime-wash, warm straw, earthen plaster, and terracotta tiles.</li>
              <li><strong style={{ color: '#38bdf8' }}>Volumetric Scale</strong>: 1.2x vertical exaggeration for human-scale isometric readability.</li>
              <li><strong style={{ color: '#38bdf8' }}>Mid-Morning Sun</strong>: 42° solar elevation casting soft 45° diagonal shadows through village alleyways.</li>
              <li><strong style={{ color: '#38bdf8' }}>Encroachment Audit</strong>: 175 houses intersecting road corridors with one-click audit highlight.</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
