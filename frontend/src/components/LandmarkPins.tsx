/**
 * 3D Interactive Landmark & POI Pins for the Village Asset Mapping System.
 * Renders elevation-anchored 3D pins with glowing icon beacons and crisp floating HTML badges.
 * Visualizes verified Gram Manchitra and Google Maps landmarks (Awc Gudwara, Rishi Patel, Lodhi's farmhouse, Temples, Stadium).
 */

import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { CoordinateConverter } from '../generators/CoordinateConverter';
import { GeoJSONPoint, LoadedGeospatialFeature } from '../types/geospatial';

export interface LandmarkPinsProps {
  assets: LoadedGeospatialFeature[];
  converter: CoordinateConverter;
  visible?: boolean;
}

interface SinglePinProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
}

const SinglePin: React.FC<SinglePinProps> = ({ feature, converter }) => {
  const geom = feature.geometry as GeoJSONPoint;
  const [lon, lat] = geom.coordinates;
  const local = converter.toLocal(lon, lat);

  const props = feature.properties || {};
  const shortName = props.short_name || props.name || 'Landmark';
  const fullName = props.name || shortName;
  const badgeColor = props.badge_color || '#f59e0b';

  // 3D Pin Beacon Geometries
  const poleHeight = 6.0;
  const beadRadius = 0.85;

  const beadMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: badgeColor,
      roughness: 0.25,
      metalness: 0.30,
      emissive: badgeColor,
      emissiveIntensity: 0.40,
    });
  }, [badgeColor]);

  const poleMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.60,
      metalness: 0.20,
    });
  }, []);

  return (
    <group position={[local.x, 0, local.z]} name={`Pin_${feature.featureId}`}>
      {/* 1. Slender vertical pin pole */}
      <mesh position={[0, poleHeight / 2, 0]} material={poleMaterial} castShadow>
        <cylinderGeometry args={[0.18, 0.25, poleHeight, 8]} />
      </mesh>

      {/* 2. Glowing faceted pin jewel */}
      <mesh position={[0, poleHeight, 0]} material={beadMaterial} castShadow>
        <octahedronGeometry args={[beadRadius, 1]} />
      </mesh>

      {/* 3. Base anchoring ring */}
      <mesh position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.7, 16]} />
        <meshBasicMaterial color={badgeColor} transparent opacity={0.65} side={THREE.DoubleSide} />
      </mesh>

      {/* 4. High-contrast Frosted Glass Floating Badge */}
      <Html
        position={[0, poleHeight + 1.0, 0]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div
          title={fullName}
          style={{
            background: 'rgba(15, 23, 42, 0.90)',
            backdropFilter: 'blur(8px)',
            border: `1.5px solid ${badgeColor}`,
            borderRadius: '20px',
            padding: '3px 10px',
            color: '#f8fafc',
            fontSize: '11px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: '600',
            letterSpacing: '0.02em',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            userSelect: 'none',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: badgeColor,
              boxShadow: `0 0 8px ${badgeColor}`,
            }}
          />
          <span>{shortName}</span>
        </div>
      </Html>
    </group>
  );
};

export const LandmarkPins: React.FC<LandmarkPinsProps> = ({ assets, converter, visible = true }) => {
  if (!visible || !assets || assets.length === 0) {
    return null;
  }

  const validPoints = assets.filter((f) => f.geometryType === 'Point');

  return (
    <group name="LandmarkPinsLayer">
      {validPoints.map((feat) => (
        <SinglePin key={feat.featureId} feature={feat} converter={converter} />
      ))}
    </group>
  );
};
