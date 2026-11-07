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
      <Header title="Village Asset Mapping System - 2.5D Isometric World" version="0.3.0" />

      <main style={{ padding: '1.5rem', maxWidth: '1440px', margin: '0 auto' }}>
        {/* Interactive 3D Real Village Viewport */}
        <section style={{ marginBottom: '1.5rem' }}>
          <div style={{ marginBottom: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: 0, fontWeight: 700, color: '#f8fafc' }}>
                Procedural 3D Village Viewport (Phase 3)
              </h2>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                Rendering actual cadastral building footprints from SVAMITVA / Gram Manchitra surveys in Three.js. Click any building to inspect its cadastral metadata.
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
              Phase 3 Procedural Engine Status
            </h3>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#94a3b8', fontSize: '0.825rem', lineHeight: '1.6' }}>
              <li><strong style={{ color: '#38bdf8' }}>Footprint Extrusion</strong>: 424 real building polygons from Gudwara, MP loaded & extruded.</li>
              <li><strong style={{ color: '#38bdf8' }}>Courtyard Preservation</strong>: Interior holes cleanly excised via Earcut triangulation.</li>
              <li><strong style={{ color: '#38bdf8' }}>Height Estimation</strong>: Priority logic (explicit measured &gt; storey multiplication &gt; area heuristic).</li>
              <li><strong style={{ color: '#38bdf8' }}>Roof Typologies</strong>: Flat terrace, gabled tile, and hipped roofs with irregular fallbacks.</li>
              <li><strong style={{ color: '#38bdf8' }}>Raycast Inspector</strong>: Instant click-to-inspect cadastral identity and spatial bounds.</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
