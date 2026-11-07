/**
 * Procedural Building Geometry Generator for the Village Asset Mapping System.
 * Converts 2D/2.5D GeoJSON footprints (Polygon & MultiPolygon) into 3D extruded buildings
 * with courtyard preservation, plinth offsets, procedural height estimation, and integrated roof typologies.
 */

import * as THREE from 'three';
import { CoordinateConverter } from './CoordinateConverter';
import { RoofGenerator, RoofType } from './RoofGenerator';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import {
  Coordinate,
  GeoJSONMultiPolygon,
  GeoJSONPolygon,
  LoadedGeospatialFeature,
} from '../types/geospatial';

export interface BuildingGeneratorOptions {
  defaultStoreyHeightMeters?: number; // Default: 3.0m
  defaultBuildingHeightMeters?: number; // Default: 4.5m
  defaultPlinthElevationMeters?: number; // Default: 0.15m
  enableRoofs?: boolean;              // Default: true
  enablePlinths?: boolean;            // Default: true
  enableShadows?: boolean;            // Default: true
}

export interface HeightEstimationResult {
  heightMeters: number;
  isHeightEstimated: boolean;
  heightEstimationMethod: 'measured' | 'storey_count_multiplication' | 'footprint_area_heuristic' | 'default_fallback';
  measuredHeightMeters?: number;
  stories: number;
}

export interface GeneratedBuildingObject {
  group: THREE.Group;
  wallMesh: THREE.Mesh;
  plinthMesh?: THREE.Mesh;
  roofMesh?: THREE.Mesh | THREE.Group;
  metadata: Building3DMetadata;
}

export interface Building3DMetadata {
  featureId: string;
  sourceId: string;
  sourceName: string;
  sourceLayer: string;
  category: string;
  subcategory: string;
  heightMeters: number;
  isHeightEstimated: boolean;
  heightEstimationMethod: string;
  measuredHeightMeters?: number;
  stories: number;
  roofType: string;
  isRoofEstimated: boolean;
  roofEstimationMethod: string;
  verticalTier: number;
  plinthElevationM: number;
  hasRoadOverlap: boolean;
  roadOverlapAreaSqm: number;
  areaSqm?: number;
  originalCoordinates?: Coordinate[];
  rawAttributes: Record<string, any>;
}

export class BuildingGeneratorError extends Error {
  constructor(message: string) {
    super(`[BuildingGenerator] ${message}`);
    this.name = 'BuildingGeneratorError';
  }
}

export class BuildingGenerator {
  private readonly options: Required<BuildingGeneratorOptions>;
  private readonly materialSystem: BuildingMaterialSystem;
  private readonly roofGenerator: RoofGenerator;

  constructor(
    options: BuildingGeneratorOptions = {},
    materialSystem?: BuildingMaterialSystem,
    roofGenerator?: RoofGenerator
  ) {
    this.options = {
      defaultStoreyHeightMeters: options.defaultStoreyHeightMeters ?? 3.0,
      defaultBuildingHeightMeters: options.defaultBuildingHeightMeters ?? 4.5,
      defaultPlinthElevationMeters: options.defaultPlinthElevationMeters ?? 0.15,
      enableRoofs: options.enableRoofs ?? true,
      enablePlinths: options.enablePlinths ?? true,
      enableShadows: options.enableShadows ?? true,
    };
    this.materialSystem = materialSystem || BuildingMaterialSystem.getInstance();
    this.roofGenerator = roofGenerator || new RoofGenerator({}, this.materialSystem);
  }

  /**
   * Generates a 3D building group from a loaded geospatial feature.
   */
  public generateBuilding(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedBuildingObject {
    if (feature.geometryType !== 'Polygon' && feature.geometryType !== 'MultiPolygon') {
      throw new BuildingGeneratorError(
        `Feature '${feature.featureId}' has unsupported geometry type '${feature.geometryType}'. Expected Polygon or MultiPolygon.`
      );
    }

    const buildingGroup = new THREE.Group();
    buildingGroup.name = `Building_${feature.featureId}`;

    // Resolve building height in strict priority order
    const heightResult = this.estimateBuildingHeight(feature);

    const plinthElevation =
      typeof feature.plinthElevationM === 'number' && feature.plinthElevationM > 0
        ? feature.plinthElevationM
        : this.options.defaultPlinthElevationMeters;

    // Convert polygon parts to 2D local space [x, -z]
    const polygonParts: Coordinate[][][] =
      feature.geometryType === 'Polygon'
        ? [(feature.geometry as GeoJSONPolygon).coordinates]
        : (feature.geometry as GeoJSONMultiPolygon).coordinates;

    const wallMeshes: THREE.Mesh[] = [];
    const plinthMeshes: THREE.Mesh[] = [];
    const roofMeshes: (THREE.Mesh | THREE.Group)[] = [];

    let lastRoofType: RoofType = 'flat_terrace';
    let lastRoofIsEstimated = true;
    let lastRoofMethod = 'default';

    for (let partIdx = 0; partIdx < polygonParts.length; partIdx++) {
      const rings = polygonParts[partIdx];
      if (!rings || rings.length === 0 || rings[0].length < 3) continue;

      // Convert exterior ring and interior holes to 2D local space
      const exteriorRing = rings[0];
      const interiorRings = rings.slice(1);

      const exteriorPoints2D = this.coordsToLocal2D(exteriorRing, converter);
      const interiorPoints2DList = interiorRings.map((hole) => this.coordsToLocal2D(hole, converter));

      // Create Three.js Shape with Holes (courtyard preservation)
      const shape = this.createShapeWithHoles(exteriorPoints2D, interiorPoints2DList);

      // 1. Plinth Geometry (if enabled and elevated)
      if (this.options.enablePlinths && plinthElevation > 0.001) {
        const plinthGeom = new THREE.ExtrudeGeometry(shape, {
          depth: plinthElevation,
          bevelEnabled: false,
        });
        plinthGeom.rotateX(-Math.PI / 2);
        // Staged on ground (Y=0 to Y=plinthElevation)
        plinthGeom.computeVertexNormals();

        const plinthMesh = new THREE.Mesh(plinthGeom, this.materialSystem.plinthMaterial);
        plinthMesh.name = `Plinth_${feature.featureId}_part${partIdx}`;
        if (this.options.enableShadows) {
          plinthMesh.receiveShadow = true;
        }
        buildingGroup.add(plinthMesh);
        plinthMeshes.push(plinthMesh);
      }

      // 2. Extruded Building Walls Geometry
      const wallGeom = new THREE.ExtrudeGeometry(shape, {
        depth: heightResult.heightMeters,
        bevelEnabled: false,
      });
      // Rotate so extrusion is along +Y (Up) and footprint sits on XZ
      wallGeom.rotateX(-Math.PI / 2);
      wallGeom.translate(0, plinthElevation, 0);
      wallGeom.computeVertexNormals();

      const wallMesh = new THREE.Mesh(wallGeom, this.materialSystem.defaultWallMaterial);
      wallMesh.name = `Walls_${feature.featureId}_part${partIdx}`;
      if (this.options.enableShadows) {
        wallMesh.castShadow = true;
        wallMesh.receiveShadow = true;
      }
      buildingGroup.add(wallMesh);
      wallMeshes.push(wallMesh);

      // 3. Roof Generation
      if (this.options.enableRoofs) {
        const wallTopY = plinthElevation + heightResult.heightMeters;
        const roofResult = this.roofGenerator.generateRoof(
          shape,
          exteriorPoints2D,
          wallTopY,
          feature.roofType,
          feature.properties
        );

        buildingGroup.add(roofResult.mesh);
        roofMeshes.push(roofResult.mesh);

        lastRoofType = roofResult.roofType;
        lastRoofIsEstimated = roofResult.isRoofEstimated;
        lastRoofMethod = roofResult.roofEstimationMethod;
      }
    }

    // Attach comprehensive metadata to group and primary mesh for raycast inspection
    const primaryMesh = wallMeshes[0] || buildingGroup;
    const metadata: Building3DMetadata = {
      featureId: feature.featureId,
      sourceId: feature.sourceId,
      sourceName: feature.sourceName,
      sourceLayer: feature.sourceLayer,
      category: feature.category,
      subcategory: feature.subcategory,
      heightMeters: heightResult.heightMeters,
      isHeightEstimated: heightResult.isHeightEstimated,
      heightEstimationMethod: heightResult.heightEstimationMethod,
      measuredHeightMeters: heightResult.measuredHeightMeters,
      stories: heightResult.stories,
      roofType: lastRoofType,
      isRoofEstimated: lastRoofIsEstimated,
      roofEstimationMethod: lastRoofMethod,
      verticalTier: feature.verticalTier,
      plinthElevationM: plinthElevation,
      hasRoadOverlap: feature.hasRoadOverlap,
      roadOverlapAreaSqm: feature.roadOverlapAreaSqm,
      areaSqm: typeof feature.properties['st_area(shape)'] === 'number' ? feature.properties['st_area(shape)'] : undefined,
      originalCoordinates:
        polygonParts.length > 0 && polygonParts[0].length > 0 ? polygonParts[0][0] : undefined,
      rawAttributes: feature.rawAttributes,
    };

    buildingGroup.userData = metadata;
    primaryMesh.userData = metadata;

    return {
      group: buildingGroup,
      wallMesh: primaryMesh,
      plinthMesh: plinthMeshes[0],
      roofMesh: roofMeshes[0],
      metadata,
    };
  }

  /**
   * Height Estimation Strategy in strict priority order:
   * 1. Explicit building height.
   * 2. Building level count multiplied by configurable storey height.
   * 3. Configurable default height or footprint area heuristic.
   */
  public estimateBuildingHeight(feature: LoadedGeospatialFeature): HeightEstimationResult {
    const props = feature.properties || {};

    // 1. Explicit measured building height
    const explicitHeight =
      typeof props._explicit_height === 'number' && props._explicit_height > 0
        ? props._explicit_height
        : typeof props.height === 'number' && props.height > 0
        ? props.height
        : typeof props.bldg_height === 'number' && props.bldg_height > 0
        ? props.bldg_height
        : null;

    if (explicitHeight !== null) {
      const stories = Math.max(1, Math.round(explicitHeight / this.options.defaultStoreyHeightMeters));
      return {
        heightMeters: Math.round(explicitHeight * 100) / 100,
        isHeightEstimated: false,
        heightEstimationMethod: 'measured',
        measuredHeightMeters: explicitHeight,
        stories,
      };
    }

    // 2. Building level count multiplied by configurable storey height
    const levelCount =
      typeof props.levels === 'number' && props.levels > 0
        ? props.levels
        : typeof props.stories === 'number' && props.stories > 0
        ? props.stories
        : typeof props._procedural_stories === 'number' && props._procedural_stories > 0
        ? props._procedural_stories
        : null;

    if (levelCount !== null) {
      const estimatedH = levelCount * this.options.defaultStoreyHeightMeters;
      return {
        heightMeters: Math.round(estimatedH * 100) / 100,
        isHeightEstimated: true,
        heightEstimationMethod: 'storey_count_multiplication',
        stories: levelCount,
      };
    }

    // 3. Procedural height synthesized in Phase 2 from footprint area heuristic
    if (typeof feature.heightMeters === 'number' && feature.heightMeters > 0) {
      const stories = Math.max(1, Math.round(feature.heightMeters / this.options.defaultStoreyHeightMeters));
      return {
        heightMeters: feature.heightMeters,
        isHeightEstimated: true,
        heightEstimationMethod: 'footprint_area_heuristic',
        stories,
      };
    }

    // 4. Configurable default fallback
    return {
      heightMeters: this.options.defaultBuildingHeightMeters,
      isHeightEstimated: true,
      heightEstimationMethod: 'default_fallback',
      stories: 1,
    };
  }

  // =========================================================================
  // GEOMETRY HELPERS
  // =========================================================================

  /**
   * Converts a ring of WGS84 coordinates into local 2D space [x_local, y_local] (Easting, Northing).
   */
  private coordsToLocal2D(coords: Coordinate[], converter: CoordinateConverter): [number, number][] {
    const points2D: [number, number][] = [];
    for (const c of coords) {
      const lon = c[0];
      const lat = c[1];
      const [utmX, utmY] = converter.wgs84ToUtm(lon, lat, converter.getAnchor().projectedCrs === 'EPSG:32644' ? 44 : 44);
      const localX = utmX - converter.getAnchor().originXUtm;
      const localY = utmY - converter.getAnchor().originYUtm;
      points2D.push([localX, localY]);
    }
    return points2D;
  }

  /**
   * Constructs a THREE.Shape with interior holes excised cleanly.
   */
  private createShapeWithHoles(
    exterior: [number, number][],
    holes: [number, number][][]
  ): THREE.Shape {
    const shape = new THREE.Shape();
    if (exterior.length === 0) return shape;

    // Exterior contour (ensure counter-clockwise)
    shape.moveTo(exterior[0][0], exterior[0][1]);
    for (let i = 1; i < exterior.length; i++) {
      shape.lineTo(exterior[i][0], exterior[i][1]);
    }
    shape.closePath();

    // Interior holes (ensure clockwise)
    for (const holeCoords of holes) {
      if (holeCoords.length < 3) continue;
      const holePath = new THREE.Path();
      holePath.moveTo(holeCoords[0][0], holeCoords[0][1]);
      for (let i = 1; i < holeCoords.length; i++) {
        holePath.lineTo(holeCoords[i][0], holeCoords[i][1]);
      }
      holePath.closePath();
      shape.holes.push(holePath);
    }

    return shape;
  }
}
