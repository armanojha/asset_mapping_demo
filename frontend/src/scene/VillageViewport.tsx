/**
 * Interactive 3D Isometric Viewport for the Village Asset Mapping System.
 *
 * Implements:
 * 1. Museum-grade warm slate canvas background (#1a1d24) with soft atmospheric depth.
 * 2. True isometric axonometric orthographic camera with bounded pan navigation.
 * 3. Monolithic sandstone diorama pedestal and ground terrain.
 * 4. Centralized layer management with floating glassmorphism control panel.
 * 5. Encroachment audit overlay highlighting 175 buildings intersecting road corridors.
 * 6. Interactive raycasting building inspection drawer.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { GeoJSONLoader } from '../loaders/GeoJSONLoader';
import { CoordinateConverter } from '../generators/CoordinateConverter';
import { Building3DMetadata } from '../generators/BuildingGenerator';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import { LoadedGeospatialFeature } from '../types/geospatial';
import { INITIAL_LAYER_STATES, LayerId, LayerManagerMap } from '../types/layers';
import { BuildingInspector } from '../components/BuildingInspector';
import { LayerControlPanel } from '../components/LayerControlPanel';
import { CadastralCompass } from '../components/CadastralCompass';
import { Camera, CameraHandle } from './Camera';
import { Lighting } from './Lighting';
import { VillageScene } from './VillageScene';

export const VillageViewport: React.FC = () => {
  const [buildingFeatures, setBuildingFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [roadFeatures, setRoadFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [parcelFeatures, setParcelFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [waterFeatures, setWaterFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [vegetationFeatures, setVegetationFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [landmarkFeatures, setLandmarkFeatures] = useState<LoadedGeospatialFeature[]>([]);
  const [boundaryFeature, setBoundaryFeature] = useState<LoadedGeospatialFeature | null>(null);

  const [layers, setLayers] = useState<LayerManagerMap>(INITIAL_LAYER_STATES);
  const [highlightEncroachments, setHighlightEncroachments] = useState<boolean>(false);
  const [wireframe, setWireframe] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState<Building3DMetadata | null>(null);

  const cameraHandleRef = useRef<CameraHandle>(null);

  const materialSystem = useMemo(() => {
    return new BuildingMaterialSystem({ wireframe });
  }, [wireframe]);

  const converter = useMemo(() => {
    return new CoordinateConverter();
  }, []);

  // Load all village datasets from Phase 2 canonical GeoJSON files
  useEffect(() => {
    let isMounted = true;
    const loader = new GeoJSONLoader();

    async function loadAllVillageLayers() {
      setLoading(true);
      setError(null);
      try {
        const [bldgRes, roadRes, parcelRes, waterRes, bndRes, vegRes, assetRes] = await Promise.all([
          loader.loadFromUrl('/data/buildings.geojson', 'Gudwara_Buildings'),
          loader.loadFromUrl('/data/roads.geojson', 'Gudwara_Roads'),
          loader.loadFromUrl('/data/land_parcels.geojson', 'Gudwara_Parcels'),
          loader.loadFromUrl('/data/water_bodies.geojson', 'Gudwara_WaterBodies').catch(() => ({ features: [] })),
          loader.loadFromUrl('/data/village_boundary.geojson', 'Gudwara_Boundary').catch(() => ({ features: [] })),
          loader.loadFromUrl('/data/vegetation.geojson', 'Gudwara_Vegetation').catch(() => ({ features: [] })),
          loader.loadFromUrl('/data/community_assets.geojson', 'Gudwara_Assets').catch(() => ({ features: [] })),
        ]);

        if (isMounted) {
          const bldgs = bldgRes.features;
          const roads = roadRes.features;
          const parcels = parcelRes.features;
          const water = waterRes.features;
          const bnd = bndRes.features[0] || null;
          const veg = vegRes.features;
          const assets = assetRes.features;

          setBuildingFeatures(bldgs);
          setRoadFeatures(roads);
          setParcelFeatures(parcels);
          setWaterFeatures(water);
          setBoundaryFeature(bnd);
          setVegetationFeatures(veg);
          setLandmarkFeatures(assets);

          // Update layer manager feature counts & statuses
          setLayers((prev) => ({
            ...prev,
            buildings: {
              ...prev.buildings,
              featureCount: bldgs.length,
              status: bldgs.length > 0 ? 'ready' : 'empty',
            },
            roofs: {
              ...prev.roofs,
              featureCount: bldgs.length,
              status: bldgs.length > 0 ? 'ready' : 'empty',
            },
            roads: {
              ...prev.roads,
              featureCount: roads.length,
              status: roads.length > 0 ? 'ready' : 'empty',
            },
            parcels: {
              ...prev.parcels,
              featureCount: parcels.length,
              status: parcels.length > 0 ? 'ready' : 'empty',
            },
            water: {
              ...prev.water,
              featureCount: water.length,
              status: water.length > 0 ? 'ready' : 'empty',
              statusDescription: water.length > 0 ? 'Narmada River Channel (Northern Boundary)' : 'No surface water',
            },
            vegetation: {
              ...prev.vegetation,
              featureCount: veg.length,
              status: veg.length > 0 ? 'ready' : 'empty',
              statusDescription: veg.length > 0 ? 'Field Bund (मेड़) trees & temple sacred groves' : 'No vegetation data',
            },
            terrain: {
              ...prev.terrain,
              featureCount: bnd ? 1 : 0,
              status: bnd ? 'ready' : 'empty',
            },
            satellite: {
              ...prev.satellite,
              featureCount: 1,
              status: 'ready',
              statusDescription: '4K sub-meter aerial satellite orthophoto of Gudwara',
            },
            landmarks: {
              ...prev.landmarks,
              featureCount: assets.length,
              status: assets.length > 0 ? 'ready' : 'empty',
              statusDescription: `${assets.length} verified landmarks & community POIs`,
            },
          }));

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

  const handleToggleLayer = (layerId: LayerId) => {
    setLayers((prev) => ({
      ...prev,
      [layerId]: {
        ...prev[layerId],
        visible: !prev[layerId].visible,
      },
    }));
  };

  const handleResetCamera = () => {
    if (cameraHandleRef.current) {
      cameraHandleRef.current.resetCamera();
    }
  };

  const handleSetTopDownView = () => {
    if (cameraHandleRef.current) {
      cameraHandleRef.current.setTopDownView();
    }
  };

  const handleSetIsometricView = () => {
    if (cameraHandleRef.current) {
      cameraHandleRef.current.setIsometricView();
    }
  };

  const handleSetRevenueOverview = () => {
    if (cameraHandleRef.current) {
      cameraHandleRef.current.setRevenueOverview();
    }
  };

  const handleSetAbadiFocus = () => {
    if (cameraHandleRef.current) {
      cameraHandleRef.current.setAbadiFocus();
    }
  };

  const handleSetRiverfrontFocus = () => {
    if (cameraHandleRef.current) {
      cameraHandleRef.current.setRiverfrontFocus();
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '680px',
        backgroundColor: '#1a1d24', // Museum-grade warm deep slate
        borderRadius: '16px',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.40)',
        border: '1px solid #2d3748',
      }}
    >
      {/* 3D Canvas */}
      <Canvas shadows>
        {/* Polished Isometric Orthographic Camera with Bounded Navigation */}
        <Camera
          ref={cameraHandleRef}
          isometricDistance={220}
          zoom={2.4}
          boundaryExtentMeters={380}
        />

        {/* Volumetric Mid-Morning Solar Daylighting & Soft PCF Shadows */}
        <Lighting />

        {/* Core Procedural Scene Graph with Vertical Staging */}
        <VillageScene
          buildingFeatures={buildingFeatures}
          roadFeatures={roadFeatures}
          parcelFeatures={parcelFeatures}
          waterFeatures={waterFeatures}
          vegetationFeatures={vegetationFeatures}
          landmarkFeatures={landmarkFeatures}
          boundaryFeature={boundaryFeature}
          converter={converter}
          materialSystem={materialSystem}
          layers={layers}
          highlightEncroachments={highlightEncroachments}
          selectedId={selectedMetadata?.featureId || null}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          onSelect={setSelectedMetadata}
        />
      </Canvas>

      {/* Floating Glassmorphism Layer Control & Camera Presets Panel */}
      <LayerControlPanel
        layers={layers}
        onToggleLayer={handleToggleLayer}
        wireframe={wireframe}
        onToggleWireframe={() => setWireframe(!wireframe)}
        highlightEncroachments={highlightEncroachments}
        onToggleEncroachments={() => setHighlightEncroachments(!highlightEncroachments)}
        onResetView={handleResetCamera}
        onSetTopDownView={handleSetTopDownView}
        onSetIsometricView={handleSetIsometricView}
        onSetRevenueOverview={handleSetRevenueOverview}
        onSetAbadiFocus={handleSetAbadiFocus}
        onSetRiverfrontFocus={handleSetRiverfrontFocus}
      />

      {/* Cadastral True North Compass Rose */}
      <CadastralCompass
        onResetView={handleResetCamera}
        onSetTopDownView={handleSetTopDownView}
      />

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
            backgroundColor: 'rgba(26, 29, 36, 0.85)',
            color: '#f8fafc',
            gap: '0.75rem',
            zIndex: 50,
          }}
        >
          <div style={{ fontSize: '1.2rem', fontWeight: 600 }}>
            Triangulating Gudwara Living Diorama (Three.js)...
          </div>
          <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
            Extruding 424 buildings, 106 road corridors, 242 cadastral parcel slabs, and diorama pedestal
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

      {/* Interactive Raycasting Building Inspector Drawer */}
      <BuildingInspector metadata={selectedMetadata} onClose={() => setSelectedMetadata(null)} />
    </div>
  );
};
