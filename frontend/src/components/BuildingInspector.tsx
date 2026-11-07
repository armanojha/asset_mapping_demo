import React from 'react';
import { Building3DMetadata } from '../generators/BuildingGenerator';

interface BuildingInspectorProps {
  metadata: Building3DMetadata | null;
  onClose: () => void;
}

export const BuildingInspector: React.FC<BuildingInspectorProps> = ({ metadata, onClose }) => {
  if (!metadata) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '1rem',
        right: '1rem',
        width: '340px',
        maxHeight: 'calc(100vh - 4rem)',
        overflowY: 'auto',
        backgroundColor: '#ffffff',
        borderRadius: '12px',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
        border: '1px solid #e2e8f0',
        padding: '1.25rem',
        zIndex: 50,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '0.875rem',
        color: '#1e293b',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#0f172a' }}>
          Building Inspector
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '1.25rem',
            cursor: 'pointer',
            color: '#64748b',
            padding: '0.2rem 0.5rem',
          }}
          title="Close Inspector"
        >
          &times;
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
          <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 600 }}>
            Feature Identifier
          </span>
          <div style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0284c7' }}>
            {metadata.featureId}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>Source ID</span>
            <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {metadata.sourceId}
            </div>
          </div>
          <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>Provider</span>
            <div style={{ fontWeight: 500 }}>{metadata.sourceName}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>Height</span>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
              {metadata.heightMeters.toFixed(1)} m
            </div>
            <span
              style={{
                fontSize: '0.65rem',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: metadata.isHeightEstimated ? '#fef3c7' : '#dcfce7',
                color: metadata.isHeightEstimated ? '#92400e' : '#166534',
                fontWeight: 600,
              }}
            >
              {metadata.isHeightEstimated ? 'ESTIMATED' : 'MEASURED'}
            </span>
          </div>
          <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>Storeys / Levels</span>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a' }}>
              {metadata.stories} {metadata.stories === 1 ? 'Floor' : 'Floors'}
            </div>
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
              {metadata.heightEstimationMethod}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>Roof Typology</span>
            <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
              {metadata.roofType.replace('_', ' ')}
            </div>
            <span style={{ fontSize: '0.65rem', color: metadata.isRoofEstimated ? '#b45309' : '#15803d' }}>
              {metadata.isRoofEstimated ? 'Estimated' : 'Surveyed'}
            </span>
          </div>
          <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>Plinth Offset</span>
            <div style={{ fontWeight: 600 }}>+{metadata.plinthElevationM.toFixed(2)} m</div>
            <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Tier {metadata.verticalTier}</span>
          </div>
        </div>

        {metadata.areaSqm !== undefined && (
          <div style={{ padding: '0.5rem', backgroundColor: '#f8fafc', borderRadius: '6px' }}>
            <span style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase' }}>Footprint Area</span>
            <div style={{ fontWeight: 600 }}>{metadata.areaSqm.toFixed(2)} m²</div>
          </div>
        )}

        <div style={{ padding: '0.5rem', backgroundColor: metadata.hasRoadOverlap ? '#fef2f2' : '#f0fdf4', borderRadius: '6px' }}>
          <span style={{ fontSize: '0.7rem', color: metadata.hasRoadOverlap ? '#991b1b' : '#166534', fontWeight: 600, textTransform: 'uppercase' }}>
            Road Eave Alignment
          </span>
          <div style={{ fontSize: '0.8rem', color: metadata.hasRoadOverlap ? '#b91c1c' : '#15803d', fontWeight: 500 }}>
            {metadata.hasRoadOverlap
              ? `Overlaps road by ${metadata.roadOverlapAreaSqm.toFixed(4)} m² (Mitigated via +0.15m Plinth)`
              : 'Clear setback (No road overlap)'}
          </div>
        </div>
      </div>
    </div>
  );
};
