/**
 * VillageScene: Core 3D Procedural Scene Orchestrator.
 * Combines all Phase 3 procedural geometry generators into a unified React Three Fiber scene graph.
 *
 * Vertical Layer Staging:
 * - Tier 0: Land Parcels (Y = -0.01m) & Cadastral Demarcation Lines (Y = -0.005m)
 * - Tier 0: Water Bodies Bed (Y = -0.35m) & Water Surface (Y = -0.05m)
 * - Tier 1: Road Networks Surface (Y = 0.00m)
 * - Tier 1: Vegetation Ground Coverage (Y = 0.02m) & Instanced Trees
 * - Tier 2: Building Plinths (Y = +0.15m), Extruded Walls, and Roofs
 */

import React, { useEffect, useMemo } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { CoordinateConverter } from '../generators/CoordinateConverter';
import { BuildingGenerator, Building3DMetadata } from '../generators/BuildingGenerator';
import { RoofGenerator } from '../generators/RoofGenerator';
import { RoadGenerator } from '../generators/RoadGenerator';
import { WaterGenerator } from '../generators/WaterGenerator';
import { LandParcelGenerator } from '../generators/LandParcelGenerator';
import { VegetationGenerator } from '../generators/VegetationGenerator';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import { LoadedGeospatialFeature } from '../types/geospatial';

export interface LayerVisibilitySettings {
  buildings: boolean;
  roofs: boolean;
  roads: boolean;
  parcels: boolean;
  water: boolean;
  vegetation: boolean;
}

export interface VillageSceneProps {
  buildingFeatures: LoadedGeospatialFeature[];
  roadFeatures: LoadedGeospatialFeature[];
  parcelFeatures: LoadedGeospatialFeature[];
  waterFeatures?: LoadedGeospatialFeature[];
  vegetationFeatures?: LoadedGeospatialFeature[];
  converter: CoordinateConverter;
  materialSystem: BuildingMaterialSystem;
  visibility: LayerVisibilitySettings;
  selectedId: string | null;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (metadata: Building3DMetadata) => void;
}

// -----------------------------------------------------------------------------
// Sub-components for individual procedural feature meshes
// -----------------------------------------------------------------------------

interface BuildingItemProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
  generator: BuildingGenerator;
  isSelected: boolean;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (metadata: Building3DMetadata) => void;
}

const BuildingItem: React.FC<BuildingItemProps> = ({
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

interface RoadItemProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
  generator: RoadGenerator;
}

const RoadItem: React.FC<RoadItemProps> = ({ feature, converter, generator }) => {
  const roadObject = useMemo(() => {
    return generator.generateRoad(feature, converter);
  }, [feature, converter, generator]);

  return <primitive object={roadObject.mesh} />;
};

interface ParcelItemProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
  generator: LandParcelGenerator;
}

const ParcelItem: React.FC<ParcelItemProps> = ({ feature, converter, generator }) => {
  const parcelObject = useMemo(() => {
    return generator.generateParcel(feature, converter);
  }, [feature, converter, generator]);

  return <primitive object={parcelObject.group} />;
};

interface WaterItemProps {
  feature: LoadedGeospatialFeature;
  converter: CoordinateConverter;
  generator: WaterGenerator;
}

const WaterItem: React.FC<WaterItemProps> = ({ feature, converter, generator }) => {
  const waterObject = useMemo(() => {
    return generator.generateWaterBody(feature, converter);
  }, [feature, converter, generator]);

  return <primitive object={waterObject.mesh} />;
};

// -----------------------------------------------------------------------------
// VillageScene Main Component
// -----------------------------------------------------------------------------

export const VillageScene: React.FC<VillageSceneProps> = ({
  buildingFeatures,
  roadFeatures,
  parcelFeatures,
  waterFeatures = [],
  vegetationFeatures = [],
  converter,
  materialSystem,
  visibility,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
}) => {
  // 1. Procedural Generators (cached with materialSystem and configuration)
  const roofGenerator = useMemo(() => {
    return new RoofGenerator({}, materialSystem);
  }, [materialSystem]);

  const buildingGenerator = useMemo(() => {
    return new BuildingGenerator(
      {
        enableRoofs: visibility.roofs,
        enablePlinths: true,
        enableShadows: true,
      },
      materialSystem,
      roofGenerator
    );
  }, [visibility.roofs, materialSystem, roofGenerator]);

  const roadGenerator = useMemo(() => {
    return new RoadGenerator({}, materialSystem);
  }, [materialSystem]);

  const waterGenerator = useMemo(() => {
    return new WaterGenerator({}, materialSystem);
  }, [materialSystem]);

  const parcelGenerator = useMemo(() => {
    return new LandParcelGenerator({}, materialSystem);
  }, [materialSystem]);

  const vegetationGenerator = useMemo(() => {
    return new VegetationGenerator({}, materialSystem);
  }, [materialSystem]);

  // 2. Batch Vegetation Layer (instanced trees and green areas)
  const vegetationLayerObject = useMemo(() => {
    if (!visibility.vegetation || vegetationFeatures.length === 0) {
      return null;
    }
    return vegetationGenerator.generateVegetationLayer(vegetationFeatures, converter);
  }, [visibility.vegetation, vegetationFeatures, vegetationGenerator, converter]);

  return (
    <group name="VillageSceneRoot">
      {/* Reference Spatial Grid Helper */}
      <gridHelper args={[700, 70, '#334155', '#1e293b']} position={[0, -0.06, 0]} />

      {/* TIER 0: Cadastral Land Parcels (Y = -0.01m) */}
      {visibility.parcels && (
        <group name="LandParcelsLayer">
          {parcelFeatures.map((feat) => (
            <ParcelItem
              key={feat.featureId}
              feature={feat}
              converter={converter}
              generator={parcelGenerator}
            />
          ))}
        </group>
      )}

      {/* TIER 0: Water Bodies (Bed Y = -0.35m, Surface Y = -0.05m) */}
      {visibility.water && waterFeatures.length > 0 && (
        <group name="WaterBodiesLayer">
          {waterFeatures.map((feat) => (
            <WaterItem
              key={feat.featureId}
              feature={feat}
              converter={converter}
              generator={waterGenerator}
            />
          ))}
        </group>
      )}

      {/* TIER 1: Road Networks (Y = 0.00m) */}
      {visibility.roads && (
        <group name="RoadsLayer">
          {roadFeatures.map((feat) => (
            <RoadItem
              key={feat.featureId}
              feature={feat}
              converter={converter}
              generator={roadGenerator}
            />
          ))}
        </group>
      )}

      {/* TIER 1: Vegetation Layer (Y = 0.02m + Instanced Trees) */}
      {visibility.vegetation && vegetationLayerObject && (
        <primitive object={vegetationLayerObject.group} />
      )}

      {/* TIER 2: Buildings and Roofs (Plinth Y = +0.15m) */}
      {visibility.buildings && (
        <group name="BuildingsLayer">
          {buildingFeatures.map((feat) => (
            <BuildingItem
              key={feat.featureId}
              feature={feat}
              converter={converter}
              generator={buildingGenerator}
              isSelected={selectedId === feat.featureId}
              isHovered={hoveredId === feat.featureId}
              onHover={onHover}
              onSelect={onSelect}
            />
          ))}
        </group>
      )}
    </group>
  );
};
