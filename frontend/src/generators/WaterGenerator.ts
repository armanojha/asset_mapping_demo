/**
 * Procedural Water Geometry Generator for the Village Asset Mapping System.
 * Generates flat reflective water surfaces for ponds, lakes, reservoirs, tanks, and linear streams.
 * Supports interior holes (islands), recessed bed depth, and stream ribbon extrusion.
 */

import * as THREE from 'three';
import { CoordinateConverter } from './CoordinateConverter';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import {
  Coordinate,
  GeoJSONLineString,
  GeoJSONMultiLineString,
  GeoJSONMultiPolygon,
  GeoJSONPolygon,
  LoadedGeospatialFeature,
} from '../types/geospatial';

export interface WaterGeneratorOptions {
  waterSurfaceElevationMeters?: number; // Default: -0.05m (recessed below ground)
  bedDepthMeters?: number;             // Default: 0.30m
  defaultStreamWidthMeters?: number;   // Default: 3.5m
  enableWaterBed?: boolean;            // Default: true
}

export interface GeneratedWaterObject {
  mesh: THREE.Mesh | THREE.Group;
  metadata: Water3DMetadata;
}

export interface Water3DMetadata {
  featureId: string;
  sourceId: string;
  sourceName: string;
  sourceLayer: string;
  category: string;
  subcategory: string;
  waterSurfaceElevationM: number;
  areaSqm?: number;
  rawAttributes: Record<string, any>;
}

export class WaterGeneratorError extends Error {
  constructor(message: string) {
    super(`[WaterGenerator] ${message}`);
    this.name = 'WaterGeneratorError';
  }
}

export class WaterGenerator {
  private readonly options: Required<WaterGeneratorOptions>;
  private readonly materialSystem: BuildingMaterialSystem;

  constructor(options: WaterGeneratorOptions = {}, materialSystem?: BuildingMaterialSystem) {
    this.options = {
      waterSurfaceElevationMeters: options.waterSurfaceElevationMeters ?? -0.05,
      bedDepthMeters: options.bedDepthMeters ?? 0.30,
      defaultStreamWidthMeters: options.defaultStreamWidthMeters ?? 3.5,
      enableWaterBed: options.enableWaterBed ?? true,
    };
    this.materialSystem = materialSystem || BuildingMaterialSystem.getInstance();
  }

  /**
   * Generates a 3D water surface mesh or group from a loaded geospatial feature.
   */
  public generateWaterBody(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedWaterObject {
    const waterGroup = new THREE.Group();
    waterGroup.name = `Water_${feature.featureId}`;

    const surfY =
      typeof feature.plinthElevationM === 'number'
        ? feature.plinthElevationM
        : this.options.waterSurfaceElevationMeters;

    const bedDepth =
      typeof feature.properties.depth_meters === 'number' && feature.properties.depth_meters > 0
        ? feature.properties.depth_meters
        : this.options.bedDepthMeters;

    const geomType = feature.geometryType;

    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      const polyParts: Coordinate[][][] =
        geomType === 'Polygon'
          ? [(feature.geometry as GeoJSONPolygon).coordinates]
          : (feature.geometry as GeoJSONMultiPolygon).coordinates;

      for (const rings of polyParts) {
        if (!rings || rings.length === 0 || rings[0].length < 3) continue;

        const exterior2D = this.coordsToLocal2D(rings[0], converter);
        const holes2D = rings.slice(1).map((h) => this.coordsToLocal2D(h, converter));

        const shape = this.createShapeWithHoles(exterior2D, holes2D);

        // 1. Water Surface Plane
        const surfaceGeom = new THREE.ShapeGeometry(shape);
        surfaceGeom.rotateX(-Math.PI / 2);
        surfaceGeom.translate(0, surfY, 0);
        surfaceGeom.computeVertexNormals();

        const surfaceMesh = new THREE.Mesh(surfaceGeom, this.materialSystem.waterSurfaceMaterial);
        surfaceMesh.receiveShadow = true;
        waterGroup.add(surfaceMesh);

        // 2. Optional Recessed Water Bed Basin
        if (this.options.enableWaterBed) {
          const bedGeom = new THREE.ExtrudeGeometry(shape, {
            depth: bedDepth,
            bevelEnabled: false,
          });
          bedGeom.rotateX(-Math.PI / 2);
          bedGeom.translate(0, surfY - bedDepth, 0);
          bedGeom.computeVertexNormals();

          const bedMesh = new THREE.Mesh(bedGeom, this.materialSystem.waterBedMaterial);
          waterGroup.add(bedMesh);
        }
      }
    } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
      // Linear streams / rivers / nullahs
      const lineParts: Coordinate[][] =
        geomType === 'LineString'
          ? [(feature.geometry as GeoJSONLineString).coordinates]
          : (feature.geometry as GeoJSONMultiLineString).coordinates;

      const streamWidth =
        typeof feature.properties.width === 'number' && feature.properties.width > 0
          ? feature.properties.width
          : this.options.defaultStreamWidthMeters;

      for (const coords of lineParts) {
        if (!coords || coords.length < 2) continue;
        const points2D = this.coordsToLocal2D(coords, converter);
        const streamGeom = this.generateStreamRibbon(points2D, streamWidth, surfY);

        if (streamGeom) {
          const streamMesh = new THREE.Mesh(streamGeom, this.materialSystem.waterSurfaceMaterial);
          streamMesh.receiveShadow = true;
          waterGroup.add(streamMesh);
        }
      }
    } else {
      throw new WaterGeneratorError(
        `Feature '${feature.featureId}' has unsupported geometry type '${geomType}' for water bodies.`
      );
    }

    const metadata: Water3DMetadata = {
      featureId: feature.featureId,
      sourceId: feature.sourceId,
      sourceName: feature.sourceName,
      sourceLayer: feature.sourceLayer,
      category: feature.category,
      subcategory: feature.subcategory,
      waterSurfaceElevationM: surfY,
      areaSqm:
        typeof feature.properties['st_area(shape)'] === 'number'
          ? feature.properties['st_area(shape)']
          : undefined,
      rawAttributes: feature.rawAttributes,
    };

    waterGroup.userData = metadata;

    return {
      mesh: waterGroup,
      metadata,
    };
  }

  private generateStreamRibbon(
    points2D: [number, number][],
    width: number,
    elevationY: number
  ): THREE.BufferGeometry | null {
    if (points2D.length < 2) return null;
    const halfWidth = width / 2.0;
    const n = points2D.length;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let i = 0; i < n - 1; i++) {
      const p0 = points2D[i];
      const p1 = points2D[i + 1];

      const dx = p1[0] - p0[0];
      const dy = p1[1] - p0[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-5) continue;

      const nx = -dy / len;
      const ny = dx / len;

      const vL0 = new THREE.Vector3(p0[0] + nx * halfWidth, elevationY, -(p0[1] + ny * halfWidth));
      const vR0 = new THREE.Vector3(p0[0] - nx * halfWidth, elevationY, -(p0[1] - ny * halfWidth));
      const vL1 = new THREE.Vector3(p1[0] + nx * halfWidth, elevationY, -(p1[1] + ny * halfWidth));
      const vR1 = new THREE.Vector3(p1[0] - nx * halfWidth, elevationY, -(p1[1] - ny * halfWidth));

      // Two triangles for stream segment
      this.addTriangle(positions, normals, uvs, vL0, vR0, vR1);
      this.addTriangle(positions, normals, uvs, vL0, vR1, vL1);
    }

    if (positions.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    return geom;
  }

  private addTriangle(
    positions: number[],
    normals: number[],
    uvs: number[],
    v0: THREE.Vector3,
    v1: THREE.Vector3,
    v2: THREE.Vector3
  ) {
    positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    for (let i = 0; i < 3; i++) {
      normals.push(0, 1, 0);
    }
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }

  private coordsToLocal2D(coords: Coordinate[], converter: CoordinateConverter): [number, number][] {
    const points2D: [number, number][] = [];
    for (const c of coords) {
      const [utmX, utmY] = converter.wgs84ToUtm(c[0], c[1], 44);
      const localX = utmX - converter.getAnchor().originXUtm;
      const localY = utmY - converter.getAnchor().originYUtm;
      points2D.push([localX, localY]);
    }
    return points2D;
  }

  private createShapeWithHoles(exterior: [number, number][], holes: [number, number][][]): THREE.Shape {
    const shape = new THREE.Shape();
    if (exterior.length === 0) return shape;

    shape.moveTo(exterior[0][0], exterior[0][1]);
    for (let i = 1; i < exterior.length; i++) {
      shape.lineTo(exterior[i][0], exterior[i][1]);
    }
    shape.closePath();

    for (const h of holes) {
      if (h.length < 3) continue;
      const p = new THREE.Path();
      p.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) {
        p.lineTo(h[i][0], h[i][1]);
      }
      p.closePath();
      shape.holes.push(p);
    }
    return shape;
  }
}
