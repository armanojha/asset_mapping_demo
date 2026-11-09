import React from 'react';

interface CadastralCompassProps {
  onResetView?: () => void;
  onSetTopDownView?: () => void;
}

export const CadastralCompass: React.FC<CadastralCompassProps> = ({
  onResetView,
  onSetTopDownView,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: '24px',
        right: '24px',
        zIndex: 35,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        userSelect: 'none',
      }}
    >
      <button
        type="button"
        onClick={onResetView}
        onDoubleClick={onSetTopDownView}
        title="Cadastral True North (Isometric 45°). Click: Reset Isometric View | Double Click: Top-Down View"
        style={{
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          backgroundColor: 'rgba(26, 29, 36, 0.82)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          outline: 'none',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.08)';
          e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1.0)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
        }}
      >
        <svg
          width="38"
          height="38"
          viewBox="0 0 100 100"
          style={{
            // Camera position [D, D, D] views diagonally from SE to NW (-45 deg azimuth)
            // True North in 3D right-handed space is -Z, pointing upper-left (-45 deg).
            transform: 'rotate(-45deg)',
            transition: 'transform 0.3s ease',
          }}
        >
          {/* Compass Rose Dial Rim */}
          <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255, 255, 255, 0.2)" strokeWidth="2" strokeDasharray="2,4" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255, 255, 255, 0.3)" strokeWidth="1.5" />

          {/* North Pointer (Red) */}
          <polygon points="50,10 57,50 50,44" fill="#ef4444" />
          <polygon points="50,10 43,50 50,44" fill="#dc2626" />

          {/* South Pointer (Slate) */}
          <polygon points="50,90 57,50 50,56" fill="#94a3b8" />
          <polygon points="50,90 43,50 50,56" fill="#64748b" />

          {/* Center Pivot Pin */}
          <circle cx="50" cy="50" r="4.5" fill="#f8fafc" stroke="#1e293b" strokeWidth="1.5" />

          {/* North Label 'N' */}
          <text
            x="50"
            y="26"
            textAnchor="middle"
            fill="#f8fafc"
            fontSize="13"
            fontWeight="bold"
            fontFamily="system-ui, sans-serif"
            style={{ transform: 'rotate(45deg, 50, 26)' }}
          >
            N
          </text>
        </svg>
      </button>

      <span
        style={{
          fontSize: '10px',
          fontWeight: 600,
          color: '#94a3b8',
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          textShadow: '0 1px 3px rgba(0,0,0,0.8)',
        }}
      >
        True North
      </span>
    </div>
  );
};
