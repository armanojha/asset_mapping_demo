/**
 * Modular Lighting System for the Isometric Village Scene.
 * Provides balanced natural daylighting with soft directional shadows,
 * subtle sky/ground hemisphere bounce, and clear ambient fill illumination.
 */

import React from 'react';

export interface LightingProps {
  ambientIntensity?: number;
  sunPosition?: [number, number, number];
  sunIntensity?: number;
  sunColor?: string;
  skyColor?: string;
  groundColor?: string;
  hemisphereIntensity?: number;
  enableShadows?: boolean;
}

export const Lighting: React.FC<LightingProps> = ({
  ambientIntensity = 0.65,
  sunPosition = [180, 280, 140],
  sunIntensity = 1.35,
  sunColor = '#fffdf5',
  skyColor = '#bae6fd',
  groundColor = '#334155',
  hemisphereIntensity = 0.45,
  enableShadows = true,
}) => {
  return (
    <>
      {/* 1. Ambient Fill Light - prevents dark, unreadable shadows */}
      <ambientLight intensity={ambientIntensity} color="#f8fafc" />

      {/* 2. Directional Sunlight - key light creating crisp isometric depth */}
      <directionalLight
        position={sunPosition}
        intensity={sunIntensity}
        color={sunColor}
        castShadow={enableShadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-300}
        shadow-camera-right={300}
        shadow-camera-top={300}
        shadow-camera-bottom={-300}
        shadow-camera-near={10}
        shadow-camera-far={800}
        shadow-bias={-0.0004}
      />

      {/* 3. Hemisphere Sky/Ground Light - natural outdoor environment bounce */}
      <hemisphereLight
        args={[skyColor, groundColor, hemisphereIntensity]}
      />
    </>
  );
};
