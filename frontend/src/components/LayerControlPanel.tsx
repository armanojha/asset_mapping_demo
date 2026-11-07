/**
 * Floating Layer Control Panel for the Village Asset Mapping System.
 * Provides clean, non-intrusive controls for toggling geographical layers,
 * inspecting feature counts, toggling road encroachment overlays, and switching camera presets.
 */

import React, { useState } from 'react';
import { LayerId, LayerManagerMap, LayerState } from '../types/layers';

export interface LayerControlPanelProps {
  layers: LayerManagerMap;
  onToggleLayer: (layerId: LayerId) => void;
  onSetOpacity?: (layerId: LayerId, opacity: number) => void;
  wireframe: boolean;
  onToggleWireframe: () => void;
  highlightEncroachments: boolean;
  onToggleEncroachments: () => void;
  onResetView: () => void;
  onSetTopDownView: () => void;
  onSetIsometricView: () => void;
}

export const LayerControlPanel: React.FC<LayerControlPanelProps> = ({
  layers,
  onToggleLayer,
  wireframe,
  onToggleWireframe,
  highlightEncroachments,
  onToggleEncroachments,
  onResetView,
  onSetTopDownView,
  onSetIsometricView,
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(false);

  const layerList: LayerState[] = Object.values(layers);

  return (
    <div
      style={{
        position: 'absolute',
        top: '1rem',
        left: '1rem',
        zIndex: 40,
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        backdropFilter: 'blur(12px)',
        borderRadius: '12px',
        border: '1px solid #334155',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        color: '#f8fafc',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        maxWidth: collapsed ? '220px' : '320px',
        transition: 'max-width 0.2s ease',
        overflow: 'hidden',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.65rem 0.85rem',
          backgroundColor: 'rgba(30, 41, 59, 0.85)',
          borderBottom: '1px solid #334155',
          cursor: 'pointer',
        }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#38bdf8',
            }}
          />
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
            Gudwara Digital Village
          </span>
        </div>
        <button
          style={{
            background: 'transparent',
            border: 'none',
            color: '#94a3b8',
            fontSize: '0.75rem',
            cursor: 'pointer',
            padding: '2px 6px',
          }}
          title={collapsed ? 'Expand Layer Panel' : 'Collapse Panel'}
        >
          {collapsed ? '▼' : '▲'}
        </button>
      </div>

      {!collapsed && (
        <div style={{ padding: '0.75rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {/* Layer Category Toggles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8' }}>
              Geographical Layers
            </span>

            {layerList.map((layer) => {
              const isDisabled = !layer.enabled;
              const isLayerEmpty = layer.status === 'empty' && layer.featureCount === 0;

              return (
                <div
                  key={layer.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0.35rem 0.5rem',
                    borderRadius: '6px',
                    backgroundColor: layer.visible ? 'rgba(51, 65, 85, 0.5)' : 'transparent',
                    border: '1px solid',
                    borderColor: layer.visible ? '#475569' : 'transparent',
                    opacity: isDisabled ? 0.5 : 1,
                  }}
                >
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      fontSize: '0.78rem',
                      userSelect: 'none',
                      flex: 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      disabled={isDisabled}
                      onChange={() => onToggleLayer(layer.id)}
                      style={{ cursor: 'pointer', accentColor: '#0284c7' }}
                    />
                    <span
                      style={{
                        display: 'inline-block',
                        width: '10px',
                        height: '10px',
                        borderRadius: '2px',
                        backgroundColor: layer.colorSwatch || '#64748b',
                        border: '1px solid rgba(255,255,255,0.2)',
                      }}
                    />
                    <span style={{ color: layer.visible ? '#f8fafc' : '#94a3b8' }}>
                      {layer.name}
                    </span>
                  </label>

                  <span
                    style={{
                      fontSize: '0.7rem',
                      color: isLayerEmpty ? '#eab308' : '#94a3b8',
                      backgroundColor: 'rgba(15, 23, 42, 0.6)',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                    title={layer.statusDescription}
                  >
                    {isLayerEmpty ? '0 (No Data)' : layer.featureCount}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ height: '1px', backgroundColor: '#334155' }} />

          {/* Special Audits & Overlays */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8' }}>
              Cadastral Analysis
            </span>

            {/* Encroachment Audit Button */}
            <button
              onClick={onToggleEncroachments}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: highlightEncroachments ? 'rgba(234, 88, 12, 0.25)' : 'rgba(51, 65, 85, 0.4)',
                border: highlightEncroachments ? '1px solid #ea580c' : '1px solid #475569',
                color: highlightEncroachments ? '#fdba74' : '#e2e8f0',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.74rem',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              title="Highlight 175 buildings intersecting surveyed road corridors"
            >
              <span>⚠ Road Encroachments (175)</span>
              <span style={{ fontWeight: 600 }}>{highlightEncroachments ? 'ACTIVE' : 'OFF'}</span>
            </button>

            {/* Wireframe Toggle */}
            <button
              onClick={onToggleWireframe}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: wireframe ? 'rgba(234, 179, 8, 0.25)' : 'rgba(51, 65, 85, 0.4)',
                border: wireframe ? '1px solid #eab308' : '1px solid #475569',
                color: wireframe ? '#fef08a' : '#e2e8f0',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.74rem',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span>📐 Wireframe Triangulation</span>
              <span style={{ fontWeight: 600 }}>{wireframe ? 'ON' : 'OFF'}</span>
            </button>
          </div>

          <div style={{ height: '1px', backgroundColor: '#334155' }} />

          {/* Camera View Presets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', color: '#94a3b8' }}>
              Camera Angles
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
              <button
                onClick={onSetIsometricView}
                style={{
                  background: '#0284c7',
                  border: 'none',
                  color: '#ffffff',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Isometric 2.5D
              </button>
              <button
                onClick={onSetTopDownView}
                style={{
                  background: '#334155',
                  border: 'none',
                  color: '#ffffff',
                  padding: '4px 8px',
                  borderRadius: '6px',
                  fontSize: '0.72rem',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Top-Down Cadastral
              </button>
            </div>
            <button
              onClick={onResetView}
              style={{
                background: '#475569',
                border: 'none',
                color: '#ffffff',
                padding: '4px 8px',
                borderRadius: '6px',
                fontSize: '0.72rem',
                cursor: 'pointer',
                fontWeight: 500,
                marginTop: '0.15rem',
              }}
            >
              Reset Camera Center
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
