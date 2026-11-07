/**
 * Modular Volumetric Daylighting System for the Isometric Village Scene.
 * Implements mid-morning solar angles (42° solar elevation, 135° azimuth),
 * soft PCF directional shadows, and natural ambient skylight bounce.
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
  ambientIntensity = 0.45,
  sunPosition = [160, 210, 160], // 42° solar elevation, 135° azimuth (South-East light vector)
  sunIntensity = 1.45,
  sunColor = '#fff4e0',         // Warm natural sunlight
  skyColor = '#cbe3f7',         // Cool azure skylight
  groundColor = '#473b30',      // Warm earth bounce
  hemisphereIntensity = 0.50,
  enableShadows = true,
}) => {
  return (
    <>
      {/* 1. Ambient Fill Light - balanced fill preventing pitch-black shadows */}
      <ambientLight intensity={ambientIntensity} color="#f8fafc" />

      {/* 2. Key Directional Sunlight - casts 45° diagonal soft shadows through village alleys */}
      <directionalLight
        position={sunPosition}
        intensity={sunIntensity}
        color={sunColor}
        castShadow={enableShadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-280}
        shadow-camera-right={280}
        shadow-camera-top={280}
        shadow-camera-bottom={-280}
        shadow-camera-near={15}
        shadow-camera-far={750}
        shadow-bias={-0.00035}
        shadow-normalBias={0.02} // Eliminates shadow acne on thin roof parapets
      />

      {/* 3. Hemisphere Sky/Ground Light - outdoor atmospheric fill */}
      <hemisphereLight
        args={[skyColor, groundColor, hemisphereIntensity]}
      />
    </>
  );
};
