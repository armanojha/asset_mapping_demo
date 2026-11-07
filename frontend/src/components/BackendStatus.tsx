import React from 'react';
import { HealthCheckState } from '../types';
import { API_BASE_URL } from '../services/api';

interface BackendStatusProps {
  healthState: HealthCheckState;
  onRefresh: () => void;
}

export const BackendStatus: React.FC<BackendStatusProps> = ({ healthState, onRefresh }) => {
  const { state, data, error, lastChecked } = healthState;

  const isConnected = state === 'connected';
  const isLoading = state === 'loading';
  const isError = state === 'error';

  const badgeColor = isConnected
    ? '#10b981'
    : isError
      ? '#ef4444'
      : isLoading
        ? '#f59e0b'
        : '#6b7280';

  const statusLabel = isConnected
    ? 'Connected'
    : isError
      ? 'Disconnected'
      : isLoading
        ? 'Connecting...'
        : 'Standby';

  return (
    <div
      style={{
        maxWidth: '600px',
        margin: '2rem auto',
        padding: '1.5rem',
        borderRadius: '12px',
        border: '1px solid #e2e8f0',
        backgroundColor: '#ffffff',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          paddingBottom: '0.75rem',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <span style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b' }}>
          Backend API Connection
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              width: '10px',
              height: '10px',
              borderRadius: '50%',
              backgroundColor: badgeColor,
              display: 'inline-block',
            }}
          />
          <span
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              color: badgeColor,
            }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div style={{ fontSize: '0.875rem', color: '#475569', marginBottom: '1rem' }}>
        <p style={{ margin: '0.25rem 0' }}>
          <strong>Configured Base URL:</strong> <code>{API_BASE_URL}</code>
        </p>
        {lastChecked && (
          <p style={{ margin: '0.25rem 0' }}>
            <strong>Last Checked:</strong> {lastChecked.toLocaleTimeString()}
          </p>
        )}
      </div>

      {isLoading && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#fffbeb',
            borderRadius: '8px',
            border: '1px solid #fde68a',
            color: '#b45309',
            fontSize: '0.875rem',
            marginBottom: '1rem',
          }}
        >
          Checking connection to backend service...
        </div>
      )}

      {isConnected && data && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#ecfdf5',
            borderRadius: '8px',
            border: '1px solid #a7f3d0',
            color: '#065f46',
            fontSize: '0.875rem',
            marginBottom: '1rem',
          }}
        >
          <p style={{ margin: '0.25rem 0' }}>
            <strong>Backend Status:</strong> {data.status}
          </p>
          <p style={{ margin: '0.25rem 0' }}>
            <strong>Service Name:</strong> {data.application}
          </p>
          <p style={{ margin: '0.25rem 0' }}>
            <strong>API Version:</strong> {data.version}
          </p>
        </div>
      )}

      {isError && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: '#fef2f2',
            borderRadius: '8px',
            border: '1px solid #fecaca',
            color: '#991b1b',
            fontSize: '0.875rem',
            marginBottom: '1rem',
          }}
        >
          <strong>Connection Failed:</strong>
          <p style={{ margin: '0.5rem 0 0 0', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
            {error || 'Unable to establish connection with backend.'}
          </p>
        </div>
      )}

      <div style={{ textAlign: 'right' }}>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            backgroundColor: isLoading ? '#f1f5f9' : '#0f172a',
            color: isLoading ? '#94a3b8' : '#ffffff',
            fontWeight: 500,
            fontSize: '0.875rem',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            transition: 'background-color 0.2s',
          }}
        >
          {isLoading ? 'Checking...' : 'Check Status'}
        </button>
      </div>
    </div>
  );
};
