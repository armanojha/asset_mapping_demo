import React from 'react';

interface HeaderProps {
  title: string;
  version: string;
}

export const Header: React.FC<HeaderProps> = ({ title, version }) => {
  return (
    <header
      style={{
        borderBottom: '1px solid #e2e8f0',
        padding: '1.25rem 2rem',
        backgroundColor: '#ffffff',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 700,
            color: '#1a202c',
          }}
        >
          {title}
        </h1>
        <p
          style={{
            margin: '0.25rem 0 0 0',
            fontSize: '0.875rem',
            color: '#718096',
          }}
        >
          Procedural 2.5D Isometric GIS Visualization
        </p>
      </div>
      <div>
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.75rem',
            borderRadius: '9999px',
            backgroundColor: '#edf2f7',
            color: '#4a5568',
            fontSize: '0.8125rem',
            fontWeight: 600,
          }}
        >
          v{version}
        </span>
      </div>
    </header>
  );
};
