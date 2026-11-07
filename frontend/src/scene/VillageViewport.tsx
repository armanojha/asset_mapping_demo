/**
 * Interactive 3D Viewport for the Village Asset Mapping System.
 * Renders real village buildings, road networks, and cadastral land parcels from Phase 2 GeoJSON.
 * Supports layer visibility toggles, interactive raycasting, and cadastral inspection.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { GeoJSONLoader } from '../loaders/GeoJSONLoader';
import { CoordinateConverter } from '../generators/CoordinateConverter';
import { BuildingGenerator, Building3DMetadata } from '../generators/BuildingGenerator';
import { RoofGenerator } from '../generators/RoofGenerator';
import { RoadGenerator } from '../generators/RoadGenerator';
import { LandParcelGenerator } from '../generators/LandParcelGenerator';
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

interface RoadMeshItemProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
  generator: RoadGenerator;
}

const RoadMeshItem: React.FC<RoadMeshItemProps> = ({ feature, converter, generator }) => {
  const roadObject = useMemo(() => {
    return generator.generateRoad(feature, converter);
  }, [feature, converter, generator]);

  return <primitive object={roadObject.mesh} />;
};

interface ParcelMeshItemProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
  generator: LandParcelGenerator;
}

const ParcelMeshItem: React.FC<ParcelMeshItemProps> = ({ feature, converter, generator }) => {
  const parcelObject = useMemo(() => {
    return generator.generateParcel(feature, converter);
  }, [feature, converter, generator]);

  return <primitive object={parcelObject.group} />;
};

export const VillageViewport: React.FC = () => {
  const [buildingFeatures, setBuildingFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [roadFeatures, setRoadFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [parcelFeatures, setParcelFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState<Building3DMetadata | null>(null);

  // Layer Visibility Controls
  const [showBuildings, setShowBuildings] = useState<boolean>(true);
  const [showRoofs, setShowRoofs] = useState<boolean>(true);
  const [showRoads, setShowRoads] = useState<boolean>(true);
  const [showParcels, setShowParcels] = useState<boolean>(true);
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
        enableRoofs: showRoofs,
        enablePlinths: true,
        enableShadows: true,
      },
      materialSystem,
      roofGenerator
    );
  }, [showRoofs, materialSystem, roofGenerator]);

  const roadGenerator = useMemo(() => {
    return new RoadGenerator({}, materialSystem);
  }, [materialSystem]);

  const parcelGenerator = useMemo(() => {
    return new LandParcelGenerator({}, materialSystem);
  }, [materialSystem]);

  const converter = useMemo(() => {
    return new CoordinateConverter();
  }, []);

  // Load actual village datasets from static GeoJSON files
  useEffect(() => {
    let isMounted = true;
    const loader = new GeoJSONLoader();

    async function loadAllVillageLayers() {
      setLoading(true);
      setError(null);
      try {
        const [bldgRes, roadRes, parcelRes] = await Promise.all([
          loader.loadFromUrl('/data/buildings.geojson', 'Gudwara_Buildings'),
          loader.loadFromUrl('/data/roads.geojson', 'Gudwara_Roads'),
          loader.loadFromUrl('/data/land_parcels.geojson', 'Gudwara_Parcels'),
        ]);

        if (isMounted) {
          setBuildingFeatures(bldgRes.features);
          setRoadFeatures(roadRes.features);
          setParcelFeatures(parcelRes.features);
          setLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to load village GeoJSON layers');
          setLoading(false);
        }
      }
    }

    loadAllVillageLayers();
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
        height: '640px',
        backgroundColor: '#0f172a',
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        border: '1px solid #334155',
      }}
    >
      {/* 3D Canvas */}
      <Canvas shadows>
        <PerspectiveCamera makeDefault position={[120, 160, 180]} fov={40} near={0.5} far={2500} />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.05}
          maxPolarAngle={Math.PI / 2.05} // Prevent camera going below terrain
          minDistance={10}
          maxDistance={900}
        />

        {/* Lighting */}
        <ambientLight intensity={0.65} color="#f8fafc" />
        <directionalLight
          position={[160, 260, 120]}
          intensity={1.35}
          castShadow
          shadow-mapSize-width={2048}
          shadow-mapSize-height={2048}
          shadow-camera-left={-260}
          shadow-camera-right={260}
          shadow-camera-top={260}
          shadow-camera-bottom={-260}
          shadow-camera-near={10}
          shadow-camera-far={700}
          shadow-bias={-0.0005}
        />
        <hemisphereLight args={['#bae6fd', '#334155', 0.45]} />

        {/* Reference Grid */}
        <gridHelper args={[650, 65, '#334155', '#1e293b']} position={[0, -0.06, 0]} />

        {/* 1. Cadastral Land Parcels Layer (Tier 0: Y = -0.01m) */}
        {showParcels &&
          parcelFeatures.map((feat) => (
            <ParcelMeshItem
              key={feat.featureId}
              feature={feat}
              converter={converter}
              generator={parcelGenerator}
            />
          ))}

        {/* 2. Road Network Surface Layer (Tier 1: Y = 0.00m) */}
        {showRoads &&
          roadFeatures.map((feat) => (
            <RoadMeshItem
              key={feat.featureId}
              feature={feat}
              converter={converter}
              generator={roadGenerator}
            />
          ))}

        {/* 3. Building Footprints & Roofs Layer (Tier 2: Plinth Y = +0.15m) */}
        {showBuildings &&
          buildingFeatures.map((feat) => (
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

      {/* Floating Layer Toolbar */}
      <div
        style={{
          position: 'absolute',
          top: '1rem',
          left: '1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.4rem',
          alignItems: 'center',
          backgroundColor: 'rgba(15, 23, 42, 0.88)',
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
          Gudwara Digital Village (2.5D)
        </span>
        <span style={{ color: '#64748b' }}>|</span>

        {/* Layer Visibility Toggles */}
        <button
          onClick={() => setShowBuildings(!showBuildings)}
          style={{
            background: showBuildings ? '#0284c7' : '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Buildings ({buildingFeatures.length}): {showBuildings ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setShowRoofs(!showRoofs)}
          disabled={!showBuildings}
          style={{
            background: showRoofs && showBuildings ? '#0284c7' : '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '0.75rem',
            cursor: showBuildings ? 'pointer' : 'not-allowed',
            opacity: showBuildings ? 1 : 0.5,
          }}
        >
          Roofs: {showRoofs ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setShowRoads(!showRoads)}
          style={{
            background: showRoads ? '#0284c7' : '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Roads ({roadFeatures.length}): {showRoads ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setShowParcels(!showParcels)}
          style={{
            background: showParcels ? '#0284c7' : '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Parcels ({parcelFeatures.length}): {showParcels ? 'ON' : 'OFF'}
        </button>

        <button
          onClick={() => setWireframe(!wireframe)}
          style={{
            background: wireframe ? '#eab308' : '#334155',
            color: wireframe ? '#000000' : '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 8px',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          Wireframe
        </button>

        <button
          onClick={handleResetCamera}
          style={{
            background: '#334155',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '3px 8px',
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
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            color: '#f8fafc',
            gap: '0.75rem',
            zIndex: 30,
          }}
        >
          <div style={{ fontSize: '1.15rem', fontWeight: 600 }}>
            Triangulating 3D Village Features (Three.js)...
          </div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Extruding 424 buildings, 106 road corridors, and 242 cadastral parcel slabs
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
            zIndex: 45,
          }}
        >
          Error loading village layers: {error}
        </div>
      )}

      {/* Interactive Raycasting Building Inspector */}
      <BuildingInspector metadata={selectedMetadata} onClose={() => setSelectedMetadata(null)} />
    </div>
  );
};
