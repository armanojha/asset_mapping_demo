/**
 * VillageScene: Core 3D Procedural Scene Orchestrator.
 * Combines all Phase 4 procedural geometry generators into a unified React Three Fiber scene graph.
 *
 * Vertical Layer Staging:
 * - Tier -1: Sandstone Diorama Pedestal Base (Y = -6.00m to -0.05m)
 * - Tier 0: Cadastral Ground Terrain (Y = -0.05m)
 * - Tier 0: Land Parcel Slabs (Y = -0.01m) & Boundary Demarcation Strokes (Y = -0.005m)
 * - Tier 0: Water Bodies Bed (Y = -0.35m) & Water Surface Plane (Y = -0.05m)
 * - Tier 1: Road Networks Surface (Y = +0.03m with clean curbs)
 * - Tier 1: Generalized Green Coverage (Y = +0.02m) & Instanced Surveyed Trees
 * - Tier 2: Building Plinths (Y = +0.20m), Extruded Walls (1.2x scale), and Roofs
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
import { DemGridData, TerrainGenerator } from '../generators/TerrainGenerator';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import { LoadedGeospatialFeature } from '../types/geospatial';
import { LayerManagerMap } from '../types/layers';

export interface VillageSceneProps {
  buildingFeatures: LoadedGeospatialFeature[];
  roadFeatures: LoadedGeospatialFeature[];
  parcelFeatures: LoadedGeospatialFeature[];
  waterFeatures?: LoadedGeospatialFeature[];
  vegetationFeatures?: LoadedGeospatialFeature[];
  boundaryFeature?: LoadedGeospatialFeature | null;
  demData?: DemGridData | null;
  converter: CoordinateConverter;
  materialSystem: BuildingMaterialSystem;
  layers: LayerManagerMap;
  highlightEncroachments?: boolean;
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
  materialSystem: BuildingMaterialSystem;
  highlightEncroachments: boolean;
  isSelected: boolean;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: (metadata: Building3DMetadata) => void;
}

const BuildingItem: React.FC<BuildingItemProps> = ({
  feature,
  converter,
  generator,
  materialSystem,
  highlightEncroachments,
  isSelected,
  isHovered,
  onHover,
  onSelect,
}) => {
  const buildingObject = useMemo(() => {
    return generator.generateBuilding(feature, converter);
  }, [feature, converter, generator]);

  useEffect(() => {
    if (buildingObject.wallMesh) {
      if (isSelected) {
        buildingObject.wallMesh.material = materialSystem.selectedWallMaterial;
      } else if (isHovered) {
        buildingObject.wallMesh.material = materialSystem.hoveredWallMaterial;
      } else {
        buildingObject.wallMesh.material = materialSystem.getWallMaterialForFeature(
          feature.featureId,
          feature.hasRoadOverlap,
          highlightEncroachments
        );
      }
    }
  }, [isSelected, isHovered, highlightEncroachments, buildingObject, materialSystem, feature]);

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
  boundaryFeature = null,
  demData = null,
  converter,
  materialSystem,
  layers,
  highlightEncroachments = false,
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
        enableRoofs: layers.roofs.visible,
        enablePlinths: true,
        enableShadows: true,
        verticalExaggeration: 1.2,
        highlightEncroachments,
      },
      materialSystem,
      roofGenerator
    );
  }, [layers.roofs.visible, highlightEncroachments, materialSystem, roofGenerator]);

  const roadGenerator = useMemo(() => {
    return new RoadGenerator(
      {
        verticalElevationMeters: 0.03, // Raised curb height above parcel plane
      },
      materialSystem
    );
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

  const terrainGenerator = useMemo(() => {
    return new TerrainGenerator(
      {
        verticalExaggeration: 1.2,
        pedestalDepthMeters: 6.0,
        surfaceElevationOffsetMeters: -0.05,
      },
      materialSystem
    );
  }, [materialSystem]);

  // 2. Terrain & Diorama Pedestal Object
  const terrainObject = useMemo(() => {
    if (!boundaryFeature || !layers.terrain.visible) return null;
    return terrainGenerator.generateTerrain(boundaryFeature, converter, demData);
  }, [boundaryFeature, layers.terrain.visible, terrainGenerator, converter, demData]);

  // 3. Batch Vegetation Layer (instanced trees and green areas)
  const vegetationLayerObject = useMemo(() => {
    if (!layers.vegetation.visible || vegetationFeatures.length === 0) {
      return null;
    }
    return vegetationGenerator.generateVegetationLayer(vegetationFeatures, converter);
  }, [layers.vegetation.visible, vegetationFeatures, vegetationGenerator, converter]);

  return (
    <group name="VillageSceneRoot">
      {/* TIER -1 & 0: Terrain Surface & Monolithic Sandstone Diorama Pedestal */}
      {layers.terrain.visible && terrainObject && (
        <primitive object={terrainObject.group} />
      )}

      {/* TIER 0: Cadastral Land Parcels (Y = -0.01m) */}
      {layers.parcels.visible && (
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
      {layers.water.visible && waterFeatures.length > 0 && (
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

      {/* TIER 1: Road Networks (Y = +0.03m with visible curbs) */}
      {layers.roads.visible && (
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

      {/* TIER 1: Vegetation Layer (Y = +0.02m + Instanced Trees) */}
      {layers.vegetation.visible && vegetationLayerObject && (
        <primitive object={vegetationLayerObject.group} />
      )}

      {/* TIER 2: Buildings and Roofs (Plinth Y = +0.20m, 1.2x vertical scale) */}
      {layers.buildings.visible && (
        <group name="BuildingsLayer">
          {buildingFeatures.map((feat) => (
            <BuildingItem
              key={feat.featureId}
              feature={feat}
              converter={converter}
              generator={buildingGenerator}
              materialSystem={materialSystem}
              highlightEncroachments={highlightEncroachments}
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
