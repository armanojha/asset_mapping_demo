/**
 * Procedural Vegetation Geometry Generator for the Village Asset Mapping System.
 * Converts verified surveyed tree points (Point / MultiPoint) and generalized vegetation /
 * forest coverage areas (Polygon / MultiPolygon) into 3D geometries.
 *
 * Strict Rules:
 * 1. Never generate trees at random across the village or parcel polygons.
 * 2. Distinguish between verified individual trees and generalized green coverage areas.
 * 3. Use THREE.InstancedMesh for repeated tree points to avoid unnecessary draw calls.
 * 4. Transparently report missing vegetation datasets without inventing synthetic data.
 */

import * as THREE from 'three';
import { CoordinateConverter } from './CoordinateConverter';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import {
  Coordinate,
  GeoJSONMultiPoint,
  GeoJSONMultiPolygon,
  GeoJSONPoint,
  GeoJSONPolygon,
  LoadedGeospatialFeature,
} from '../types/geospatial';

export interface VegetationGeneratorOptions {
  defaultTreeHeightMeters?: number;   // Default: 4.5m
  defaultCanopyRadiusMeters?: number; // Default: 1.8m
  defaultTrunkRadiusMeters?: number;  // Default: 0.25m
  canopySegments?: number;            // Default: 8 (low-poly isometric style)
  enableShadows?: boolean;            // Default: true
  groundElevationMeters?: number;     // Default: 0.02m (above ground parcels)
}

export type VegetationRepresentationType =
  | 'individual_tree_point'
  | 'vegetation_cluster'
  | 'generalized_vegetation_coverage';

export interface Vegetation3DMetadata {
  featureId: string;
  sourceId: string;
  sourceName: string;
  sourceLayer: string;
  category: string;
  subcategory: string;
  representationType: VegetationRepresentationType;
  isExactTreeInventory: boolean;
  treeCount: number;
  coverageAreaSqm?: number;
  heightMeters?: number;
  isHeightEstimated: boolean;
  rawAttributes: Record<string, any>;
}

export interface GeneratedVegetationObject {
  group: THREE.Group;
  metadata: Vegetation3DMetadata;
  meshCount: number;
}

export interface VegetationLayerResult {
  group: THREE.Group;
  isVegetationAvailable: boolean;
  totalFeatures: number;
  individualTreesCount: number;
  generalizedPolygonsCount: number;
  statusMessage: string;
  metadataList: Vegetation3DMetadata[];
}

export class VegetationGeneratorError extends Error {
  constructor(message: string) {
    super(`[VegetationGenerator] ${message}`);
    this.name = 'VegetationGeneratorError';
  }
}

export class VegetationGenerator {
  private readonly options: Required<VegetationGeneratorOptions>;
  private readonly materialSystem: BuildingMaterialSystem;

  // Cached unit geometries for instancing
  private readonly unitTrunkGeometry: THREE.CylinderGeometry;
  private readonly unitCanopyGeometry: THREE.ConeGeometry;

  constructor(options: VegetationGeneratorOptions = {}, materialSystem?: BuildingMaterialSystem) {
    this.options = {
      defaultTreeHeightMeters: options.defaultTreeHeightMeters ?? 4.5,
      defaultCanopyRadiusMeters: options.defaultCanopyRadiusMeters ?? 1.8,
      defaultTrunkRadiusMeters: options.defaultTrunkRadiusMeters ?? 0.25,
      canopySegments: options.canopySegments ?? 8,
      enableShadows: options.enableShadows ?? true,
      groundElevationMeters: options.groundElevationMeters ?? 0.02,
    };

    this.materialSystem = materialSystem || BuildingMaterialSystem.getInstance();

    // Standard low-poly procedural tree template:
    // Cylinder: trunk height = 1.0, radiusTop = 0.8, radiusBottom = 1.0
    this.unitTrunkGeometry = new THREE.CylinderGeometry(
      0.8,
      1.0,
      1.0,
      this.options.canopySegments
    );
    this.unitTrunkGeometry.translate(0, 0.5, 0); // Base at origin Y=0

    // Cone: canopy height = 1.0, radius = 1.0
    this.unitCanopyGeometry = new THREE.ConeGeometry(
      1.0,
      1.0,
      this.options.canopySegments
    );
    this.unitCanopyGeometry.translate(0, 0.5, 0); // Base at origin Y=0
  }

  /**
   * Generates a 3D vegetation object for a single geospatial feature.
   */
  public generateVegetationFeature(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedVegetationObject {
    switch (feature.geometryType) {
      case 'Point':
        return this.generatePointTree(feature, converter);
      case 'MultiPoint':
        return this.generateMultiPointTrees(feature, converter);
      case 'Polygon':
      case 'MultiPolygon':
        return this.generateGeneralizedVegetationCoverage(feature, converter);
      default:
        throw new VegetationGeneratorError(
          `Feature '${feature.featureId}' has unsupported geometry type '${feature.geometryType}' for vegetation.`
        );
    }
  }

  /**
   * Generates an entire vegetation layer from an array of features.
   * If the input array is empty, reports missing dataset without fabricating data.
   */
  public generateVegetationLayer(
    features: LoadedGeospatialFeature[],
    converter: CoordinateConverter
  ): VegetationLayerResult {
    const layerGroup = new THREE.Group();
    layerGroup.name = 'VegetationLayer';

    if (!features || features.length === 0) {
      return {
        group: layerGroup,
        isVegetationAvailable: false,
        totalFeatures: 0,
        individualTreesCount: 0,
        generalizedPolygonsCount: 0,
        statusMessage:
          'No verified vegetation dataset or surveyed tree points available for this village. Synthetic coverage not generated.',
        metadataList: [],
      };
    }

    // Separate verified tree points from generalized vegetation polygons
    const treePointCoords: Array<{
      x: number;
      z: number;
      height: number;
      radius: number;
      metadata: Vegetation3DMetadata;
    }> = [];

    const polygonFeatures: LoadedGeospatialFeature[] = [];
    const metadataList: Vegetation3DMetadata[] = [];

    for (const feat of features) {
      if (feat.geometryType === 'Point') {
        const pointGeom = feat.geometry as GeoJSONPoint;
        const [lon, lat] = pointGeom.coordinates;
        const local = converter.toLocal(lon, lat);
        const { height, radius, isEstimated } = this.resolveTreeDimensions(feat);

        const meta: Vegetation3DMetadata = {
          featureId: feat.featureId,
          sourceId: feat.sourceId,
          sourceName: feat.sourceName,
          sourceLayer: feat.sourceLayer,
          category: feat.category,
          subcategory: feat.subcategory || 'tree',
          representationType: 'individual_tree_point',
          isExactTreeInventory: true,
          treeCount: 1,
          heightMeters: height,
          isHeightEstimated: isEstimated,
          rawAttributes: feat.rawAttributes,
        };

        treePointCoords.push({
          x: local.x,
          z: local.z,
          height,
          radius,
          metadata: meta,
        });
        metadataList.push(meta);
      } else if (feat.geometryType === 'MultiPoint') {
        const multiPointGeom = feat.geometry as GeoJSONMultiPoint;
        const { height, radius, isEstimated } = this.resolveTreeDimensions(feat);

        const meta: Vegetation3DMetadata = {
          featureId: feat.featureId,
          sourceId: feat.sourceId,
          sourceName: feat.sourceName,
          sourceLayer: feat.sourceLayer,
          category: feat.category,
          subcategory: feat.subcategory || 'tree_cluster',
          representationType: 'vegetation_cluster',
          isExactTreeInventory: true,
          treeCount: multiPointGeom.coordinates.length,
          heightMeters: height,
          isHeightEstimated: isEstimated,
          rawAttributes: feat.rawAttributes,
        };
        metadataList.push(meta);

        for (const coord of multiPointGeom.coordinates) {
          const [lon, lat] = coord;
          const local = converter.toLocal(lon, lat);
          treePointCoords.push({
            x: local.x,
            z: local.z,
            height,
            radius,
            metadata: meta,
          });
        }
      } else if (
        feat.geometryType === 'Polygon' ||
        feat.geometryType === 'MultiPolygon'
      ) {
        polygonFeatures.push(feat);
      }
    }

    // 1. Batch generate all surveyed tree points using THREE.InstancedMesh
    if (treePointCoords.length > 0) {
      const instancedTreeGroup = this.buildInstancedTreeMesh(treePointCoords);
      layerGroup.add(instancedTreeGroup);
    }

    // 2. Generate generalized vegetation coverage for polygons
    let generalizedPolygonCount = 0;
    for (const polyFeat of polygonFeatures) {
      const polyObj = this.generateGeneralizedVegetationCoverage(polyFeat, converter);
      layerGroup.add(polyObj.group);
      metadataList.push(polyObj.metadata);
      generalizedPolygonCount++;
    }

    return {
      group: layerGroup,
      isVegetationAvailable: true,
      totalFeatures: features.length,
      individualTreesCount: treePointCoords.length,
      generalizedPolygonsCount: generalizedPolygonCount,
      statusMessage: `Successfully generated ${treePointCoords.length} verified tree instances and ${generalizedPolygonCount} generalized green coverage zones.`,
      metadataList,
    };
  }

  /**
   * Generates a single individual tree mesh for a Point geometry.
   */
  private generatePointTree(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedVegetationObject {
    const pointGeom = feature.geometry as GeoJSONPoint;
    const [lon, lat] = pointGeom.coordinates;
    const local = converter.toLocal(lon, lat);
    const { height, radius, isEstimated } = this.resolveTreeDimensions(feature);

    const group = new THREE.Group();
    group.name = `Tree_${feature.featureId}`;
    group.position.set(local.x, this.options.groundElevationMeters, local.z);

    const treeMeshGroup = this.createSingleTreeGroup(height, radius);
    group.add(treeMeshGroup);

    const metadata: Vegetation3DMetadata = {
      featureId: feature.featureId,
      sourceId: feature.sourceId,
      sourceName: feature.sourceName,
      sourceLayer: feature.sourceLayer,
      category: feature.category,
      subcategory: feature.subcategory || 'tree',
      representationType: 'individual_tree_point',
      isExactTreeInventory: true,
      treeCount: 1,
      heightMeters: height,
      isHeightEstimated: isEstimated,
      rawAttributes: feature.rawAttributes,
    };

    return { group, metadata, meshCount: 2 };
  }

  /**
   * Generates a group of trees for a MultiPoint feature.
   */
  private generateMultiPointTrees(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedVegetationObject {
    const multiPointGeom = feature.geometry as GeoJSONMultiPoint;
    const { height, radius, isEstimated } = this.resolveTreeDimensions(feature);

    const group = new THREE.Group();
    group.name = `TreeCluster_${feature.featureId}`;

    const points = multiPointGeom.coordinates.map((coord) => {
      const [lon, lat] = coord;
      const local = converter.toLocal(lon, lat);
      return {
        x: local.x,
        z: local.z,
        height,
        radius,
        metadata: {
          featureId: feature.featureId,
          sourceId: feature.sourceId,
          sourceName: feature.sourceName,
          sourceLayer: feature.sourceLayer,
          category: feature.category,
          subcategory: 'tree_cluster',
          representationType: 'vegetation_cluster' as const,
          isExactTreeInventory: true,
          treeCount: multiPointGeom.coordinates.length,
          heightMeters: height,
          isHeightEstimated: isEstimated,
          rawAttributes: feature.rawAttributes,
        },
      };
    });

    const instancedMeshGroup = this.buildInstancedTreeMesh(points);
    group.add(instancedMeshGroup);

    const metadata: Vegetation3DMetadata = {
      featureId: feature.featureId,
      sourceId: feature.sourceId,
      sourceName: feature.sourceName,
      sourceLayer: feature.sourceLayer,
      category: feature.category,
      subcategory: feature.subcategory || 'tree_cluster',
      representationType: 'vegetation_cluster',
      isExactTreeInventory: true,
      treeCount: multiPointGeom.coordinates.length,
      heightMeters: height,
      isHeightEstimated: isEstimated,
      rawAttributes: feature.rawAttributes,
    };

    return { group, metadata, meshCount: 2 };
  }

  /**
   * Generates generalized green coverage for vegetation polygons.
   * Does NOT interpret large vegetation polygons as exact tree inventories.
   */
  private generateGeneralizedVegetationCoverage(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedVegetationObject {
    const group = new THREE.Group();
    group.name = `VegetationArea_${feature.featureId}`;

    const polygons =
      feature.geometryType === 'MultiPolygon'
        ? (feature.geometry as GeoJSONMultiPolygon).coordinates
        : [(feature.geometry as GeoJSONPolygon).coordinates];

    let totalAreaSqm = 0;
    const surfY = this.options.groundElevationMeters;

    for (const polygonRings of polygons) {
      if (polygonRings.length === 0 || polygonRings[0].length < 3) continue;

      const exteriorRing = polygonRings[0];
      const shape = new THREE.Shape();

      // Exterior boundary
      for (let i = 0; i < exteriorRing.length; i++) {
        const [lon, lat] = exteriorRing[i];
        const local = converter.toLocal(lon, lat);
        if (i === 0) {
          shape.moveTo(local.x, -local.z);
        } else {
          shape.lineTo(local.x, -local.z);
        }
      }

      // Interior exclusion holes
      for (let h = 1; h < polygonRings.length; h++) {
        const holeRing = polygonRings[h];
        if (holeRing.length < 3) continue;
        const holePath = new THREE.Path();
        for (let j = 0; j < holeRing.length; j++) {
          const [lon, lat] = holeRing[j];
          const local = converter.toLocal(lon, lat);
          if (j === 0) {
            holePath.moveTo(local.x, -local.z);
          } else {
            holePath.lineTo(local.x, -local.z);
          }
        }
        shape.holes.push(holePath);
      }

      // Planar surface mesh
      const shapeGeom = new THREE.ShapeGeometry(shape);
      shapeGeom.rotateX(-Math.PI / 2); // Map Shape (X, Y) to 3D horizontal (X, Z)
      shapeGeom.computeVertexNormals();

      const surfaceMesh = new THREE.Mesh(shapeGeom, this.materialSystem.vegetationAreaMaterial);
      surfaceMesh.position.y = surfY;
      surfaceMesh.receiveShadow = true;
      group.add(surfaceMesh);

      // Boundary outline segments
      const borderPoints: THREE.Vector3[] = [];
      for (let i = 0; i < exteriorRing.length - 1; i++) {
        const p1 = converter.toLocal(exteriorRing[i][0], exteriorRing[i][1]);
        const p2 = converter.toLocal(exteriorRing[i + 1][0], exteriorRing[i + 1][1]);
        borderPoints.push(
          new THREE.Vector3(p1.x, surfY + 0.003, p1.z),
          new THREE.Vector3(p2.x, surfY + 0.003, p2.z)
        );
      }

      const borderGeom = new THREE.BufferGeometry().setFromPoints(borderPoints);
      const borderLine = new THREE.LineSegments(
        borderGeom,
        this.materialSystem.vegetationBorderMaterial
      );
      group.add(borderLine);

      // Compute approximate polygon area in sq meters
      totalAreaSqm += this.computePolygonArea(exteriorRing, converter);
    }

    const metadata: Vegetation3DMetadata = {
      featureId: feature.featureId,
      sourceId: feature.sourceId,
      sourceName: feature.sourceName,
      sourceLayer: feature.sourceLayer,
      category: feature.category,
      subcategory: feature.subcategory || 'green_space',
      representationType: 'generalized_vegetation_coverage',
      isExactTreeInventory: false,
      treeCount: 0,
      coverageAreaSqm: Math.round(totalAreaSqm * 100) / 100,
      isHeightEstimated: false,
      rawAttributes: feature.rawAttributes,
    };

    return { group, metadata, meshCount: group.children.length };
  }

  /**
   * Constructs high-performance instanced meshes for batches of tree points.
   * Utilizes two instanced meshes (trunks and canopies) for minimal draw calls.
   */
  public buildInstancedTreeMesh(
    trees: Array<{ x: number; z: number; height: number; radius: number }>
  ): THREE.Group {
    const instancedGroup = new THREE.Group();
    instancedGroup.name = 'InstancedTreesGroup';

    const count = trees.length;
    if (count === 0) return instancedGroup;

    const trunkMesh = new THREE.InstancedMesh(
      this.unitTrunkGeometry,
      this.materialSystem.treeTrunkMaterial,
      count
    );
    const canopyMesh = new THREE.InstancedMesh(
      this.unitCanopyGeometry,
      this.materialSystem.foliageTreeMaterial,
      count
    );

    if (this.options.enableShadows) {
      trunkMesh.castShadow = true;
      trunkMesh.receiveShadow = true;
      canopyMesh.castShadow = true;
      canopyMesh.receiveShadow = true;
    }

    const dummyMatrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();

    for (let i = 0; i < count; i++) {
      const tree = trees[i];
      const trunkHeight = tree.height * 0.35;
      const canopyHeight = tree.height * 0.65;
      const trunkRadius = tree.radius * 0.16;
      const canopyRadius = tree.radius;

      // 1. Trunk Instance Transform
      position.set(tree.x, this.options.groundElevationMeters, tree.z);
      scale.set(trunkRadius, trunkHeight, trunkRadius);
      dummyMatrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(i, dummyMatrix);

      // 2. Canopy Instance Transform
      position.set(tree.x, this.options.groundElevationMeters + trunkHeight, tree.z);
      scale.set(canopyRadius, canopyHeight, canopyRadius);
      dummyMatrix.compose(position, quaternion, scale);
      canopyMesh.setMatrixAt(i, dummyMatrix);
    }

    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;

    instancedGroup.add(trunkMesh);
    instancedGroup.add(canopyMesh);

    return instancedGroup;
  }

  /**
   * Helper to construct a single non-instanced low-poly tree compound group.
   */
  public createSingleTreeGroup(height: number, canopyRadius: number): THREE.Group {
    const treeGroup = new THREE.Group();
    const trunkHeight = height * 0.35;
    const canopyHeight = height * 0.65;
    const trunkRadius = canopyRadius * 0.16;

    // Trunk
    const trunkGeom = new THREE.CylinderGeometry(
      trunkRadius * 0.8,
      trunkRadius,
      trunkHeight,
      this.options.canopySegments
    );
    trunkGeom.translate(0, trunkHeight / 2, 0);
    const trunk = new THREE.Mesh(trunkGeom, this.materialSystem.treeTrunkMaterial);

    // Canopy
    const canopyGeom = new THREE.ConeGeometry(
      canopyRadius,
      canopyHeight,
      this.options.canopySegments
    );
    canopyGeom.translate(0, trunkHeight + canopyHeight / 2, 0);
    const canopy = new THREE.Mesh(canopyGeom, this.materialSystem.foliageTreeMaterial);

    if (this.options.enableShadows) {
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      canopy.castShadow = true;
      canopy.receiveShadow = true;
    }

    treeGroup.add(trunk);
    treeGroup.add(canopy);
    return treeGroup;
  }

  /**
   * Resolves tree dimensions from explicit attributes or configurable defaults.
   */
  private resolveTreeDimensions(feature: LoadedGeospatialFeature): {
    height: number;
    radius: number;
    isEstimated: boolean;
  } {
    const attrs = feature.rawAttributes || {};

    let height = this.options.defaultTreeHeightMeters;
    let radius = this.options.defaultCanopyRadiusMeters;
    let isEstimated = true;

    if (attrs.height && !isNaN(Number(attrs.height))) {
      height = Math.max(1.5, Number(attrs.height));
      isEstimated = false;
    } else if (attrs.tree_height && !isNaN(Number(attrs.tree_height))) {
      height = Math.max(1.5, Number(attrs.tree_height));
      isEstimated = false;
    }

    if (attrs.crown_diameter && !isNaN(Number(attrs.crown_diameter))) {
      radius = Math.max(0.5, Number(attrs.crown_diameter) / 2);
    } else if (attrs.canopy_radius && !isNaN(Number(attrs.canopy_radius))) {
      radius = Math.max(0.5, Number(attrs.canopy_radius));
    }

    return { height, radius, isEstimated };
  }

  /**
   * Computes approximate planar polygon area in square meters.
   */
  private computePolygonArea(ring: Coordinate[], converter: CoordinateConverter): number {
    let area = 0;
    const n = ring.length;
    for (let i = 0; i < n - 1; i++) {
      const p1 = converter.toLocal(ring[i][0], ring[i][1]);
      const p2 = converter.toLocal(ring[i + 1][0], ring[i + 1][1]);
      area += p1.x * p2.z - p2.x * p1.z;
    }
    return Math.abs(area) / 2.0;
  }
}
