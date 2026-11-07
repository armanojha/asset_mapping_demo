/**
 * Interactive 3D Viewport for the Village Asset Mapping System.
 * Renders real village buildings from Phase 2 GeoJSON datasets using React Three Fiber.
 * Supports interactive raycasting, building selection, hover highlights, and roof toggling.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { GeoJSONLoader } from '../loaders/GeoJSONLoader';
import { CoordinateConverter } from '../generators/CoordinateConverter';
import { BuildingGenerator, Building3DMetadata } from '../generators/BuildingGenerator';
import { RoofGenerator } from '../generators/RoofGenerator';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import { LoadedGeospatialFeature } from '../types/geospatial';
import { BuildingInspector } from '../components/BuildingInspector';

interface BuildingMeshItemProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
  generator: BuildingGenerator;
  isSelected: boolean;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (metadata: Building3DMetadata) => void;
}

const BuildingMeshItem: React.FC<BuildingMeshItemProps> = ({
  feature,
  converter,
  generator,
  isSelected,
  isHovered,
  onHover,
  onSelect,
}) => {
  const buildingObject = useMemo(() => {
    return generator.generateBuilding(feature, converter);
  }, [feature, converter, generator]);

  const materials = useMemo(() => BuildingMaterialSystem.getInstance(), []);

  // Update wall material based on interaction state
  useEffect(() => {
    if (buildingObject.wallMesh) {
      if (isSelected) {
        buildingObject.wallMesh.material = materials.selectedWallMaterial;
      } else if (isHovered) {
        buildingObject.wallMesh.material = materials.hoveredWallMaterial;
      } else {
        buildingObject.wallMesh.material = materials.defaultWallMaterial;
      }
    }
  }, [isSelected, isHovered, buildingObject, materials]);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect(buildingObject.metadata);
  };

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    onHover(feature.featureId);
  };

  const handlePointerOut = () => {
    document.body.style.cursor = 'auto';
    onHover(null);
  };

  return (
    <primitive
      object={buildingObject.group}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    />
  );
};

export const VillageViewport: React.FC = () => {
  const [features, setFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState<Building3DMetadata | null>(null);
  const [enableRoofs, setEnableRoofs] = useState<boolean>(true);
  const [wireframe, setWireframe] = useState<boolean>(false);

  const controlsRef = useRef<any>(null);

  const materialSystem = useMemo(() => {
    return new BuildingMaterialSystem({ wireframe });
  }, [wireframe]);

  const roofGenerator = useMemo(() => {
    return new RoofGenerator({}, materialSystem);
  }, [materialSystem]);

  const buildingGenerator = useMemo(() => {
    return new BuildingGenerator(
      {
        enableRoofs,
        enablePlinths: true,
        enableShadows: true,
      },
      materialSystem,
      roofGenerator
    );
  }, [enableRoofs, materialSystem, roofGenerator]);

  const converter = useMemo(() => {
    return new CoordinateConverter();
  }, []);

  // Load actual village buildings from static GeoJSON
  useEffect(() => {
    let isMounted = true;
    const loader = new GeoJSONLoader();

    async function loadVillageBuildings() {
      setLoading(true);
      setError(null);
      try {
        const result = await loader.loadFromUrl('/data/buildings.geojson', 'Gudwara_Buildings');
        if (isMounted) {
          setFeatures(result.features);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to load village buildings GeoJSON');
          setLoading(false);
        }
      }
    }

    loadVillageBuildings();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleResetCamera = () => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '620px',
        backgroundColor: '#0f172a',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        border: '1px solid #334155',
      }}
    >
      {/* 3D Canvas */}
      <Canvas shadows>
        {/* Isometric Angle Camera */}
        <PerspectiveCamera makeDefault position={[120, 160, 180]} fov={40} near={0.5} far={2000} />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2.1} // Prevent going below ground
          minDistance={10}
          maxDistance={800}
        />

        {/* Ambient & Sun Lighting */}
        <ambientLight intensity={0.65} color="#f8fafc" />
        <directionalLight
          position={[150, 250, 100]}
          intensity={1.3}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-250}
          shadow-camera-right={250}
          shadow-camera-top={250}
          shadow-camera-bottom={-250}
          shadow-camera-near={10}
          shadow-camera-far={600}
          shadow-bias={-0.0005}
        />
        <hemisphereLight args={['#bae6fd', '#334155', 0.4]} />

        {/* Ground Reference Grid */}
        <gridHelper args={[600, 60, '#334155', '#1e293b']} position={[0, -0.05, 0]} />

        {/* Ground Plane */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow>
          <planeGeometry args={[1000, 1000]} />
          <meshStandardMaterial color="#1e293b" roughness={0.9} metalness={0.1} />
        </mesh>

        {/* Render Generated Real Village Buildings */}
        {features.map((feat) => (
          <BuildingMeshItem
            key={feat.featureId}
            feature={feat}
            converter={converter}
            generator={buildingGenerator}
            isSelected={selectedMetadata?.featureId === feat.featureId}
            isHovered={hoveredId === feat.featureId}
            onHover={setHoveredId}
            onSelect={setSelectedMetadata}
          />
        ))}
      </Canvas>

      {/* Top Floating Control Bar */}
      <div
        style={{
          position: 'absolute',
          top: '1rem',
          left: '1rem',
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(8px)',
          padding: '0.5rem 0.85rem',
          borderRadius: '10px',
          border: '1px solid #334155',
          color: '#f8fafc',
          fontSize: '0.8rem',
          zIndex: 40,
        }}
      >
        <span style={{ fontWeight: 600, color: '#38bdf8' }}>
          Living Digital Village: Gudwara, MP
        </span>
        <span style={{ color: '#64748b' }}>|</span>
        <span
          style={{
            backgroundColor: '#0369a1',
            color: '#f0f9ff',
            padding: '2px 8px',
            borderRadius: '999px',
            fontWeight: 600,
          }}
        >
          {loading ? 'Loading...' : `${features.length} 3D Buildings`}
        </span>

        <button
          onClick={() => setEnableRoofs(!enableRoofs)}
          style={{
            background: enableRoofs ? '#0284c7' : '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
            marginLeft: '0.25rem',
          }}
        >
          Roofs: {enableRoofs ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setWireframe(!wireframe)}
          style={{
            background: wireframe ? '#eab308' : '#334155',
            color: wireframe ? '#000000' : '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Wireframe: {wireframe ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={handleResetCamera}
          style={{
            background: '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Reset View
        </button>
      </div>

      {/* Loading & Error States */}
      {loading && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            backgroundColor: 'rgba(15, 23, 42, 0.7)',
            color: '#f8fafc',
            gap: '0.75rem',
          }}
        >
          <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>
            Extruding Real Village Footprints (Three.js)...
          </div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Converting SVAMITVA cadastral coordinates & synthesizing roof typologies
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            position: 'absolute',
            bottom: '1rem',
            left: '1rem',
            backgroundColor: '#fee2e2',
            border: '1px solid #ef4444',
            color: '#991b1b',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            fontSize: '0.85rem',
          }}
        >
          Error loading building footprints: {error}
        </div>
      )}

      {/* Interactive Raycasting Building Inspector */}
      <BuildingInspector metadata={selectedMetadata} onClose={() => setSelectedMetadata(null)} />
    </div>
  );
};
