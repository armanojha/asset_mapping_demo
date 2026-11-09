/**
 * Procedural Road Geometry Generator for the Village Asset Mapping System.
 * Converts road LineString, MultiLineString, and Polygon features into visible 3D road surfaces.
 * Handles width estimation, miter joins at turns, end caps, and seamless corridor triangulation.
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

export interface RoadGeneratorOptions {
  defaultRoadWidthMeters?: number;    // Default: 4.0m
  pavedRoadWidthMeters?: number;      // Default: 6.0m
  villageRoadWidthMeters?: number;    // Default: 4.0m
  pathWidthMeters?: number;           // Default: 2.5m
  verticalElevationMeters?: number;   // Default: 0.04m (Tier 1)
  enableCurbs?: boolean;              // Default: true
  curbElevationOffsetMeters?: number; // Default: 0.035m (sits at +0.075m)
  maxMiterRatio?: number;             // Default: 2.5 (prevents spikes at sharp turns)
  roundCaps?: boolean;                // Default: true
}

export interface RoadWidthResult {
  widthMeters: number;
  isWidthEstimated: boolean;
  widthEstimationMethod: 'explicit_attribute' | 'subcategory_default' | 'default_fallback';
}

export interface GeneratedRoadObject {
  mesh: THREE.Mesh | THREE.Group;
  metadata: Road3DMetadata;
}

export interface Road3DMetadata {
  featureId: string;
  sourceId: string;
  sourceName: string;
  sourceLayer: string;
  category: string;
  subcategory: string;
  widthMeters: number;
  isWidthEstimated: boolean;
  widthEstimationMethod: string;
  verticalTier: number;
  plinthElevationM: number;
  lengthMeters?: number;
  rawAttributes: Record<string, any>;
}

export class RoadGeneratorError extends Error {
  constructor(message: string) {
    super(`[RoadGenerator] ${message}`);
    this.name = 'RoadGeneratorError';
  }
}

export class RoadGenerator {
  private readonly options: Required<RoadGeneratorOptions>;
  private readonly materialSystem: BuildingMaterialSystem;

  constructor(options: RoadGeneratorOptions = {}, materialSystem?: BuildingMaterialSystem) {
    this.options = {
      defaultRoadWidthMeters: options.defaultRoadWidthMeters ?? 4.0,
      pavedRoadWidthMeters: options.pavedRoadWidthMeters ?? 6.0,
      villageRoadWidthMeters: options.villageRoadWidthMeters ?? 4.0,
      pathWidthMeters: options.pathWidthMeters ?? 2.5,
      verticalElevationMeters: options.verticalElevationMeters ?? 0.00,
      enableCurbs: options.enableCurbs ?? false,
      curbElevationOffsetMeters: options.curbElevationOffsetMeters ?? 0.035,
      maxMiterRatio: options.maxMiterRatio ?? 2.5,
      roundCaps: options.roundCaps ?? true,
    };
    this.materialSystem = materialSystem || BuildingMaterialSystem.getInstance();
  }

  /**
   * Generates a 3D road surface mesh or group from a loaded geospatial feature.
   */
  public generateRoad(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedRoadObject {
    const roadGroup = new THREE.Group();
    roadGroup.name = `Road_${feature.featureId}`;

    const widthResult = this.estimateRoadWidth(feature);
    const material = this.resolveRoadMaterial(feature);
    const elevY =
      typeof feature.plinthElevationM === 'number'
        ? feature.plinthElevationM
        : this.options.verticalElevationMeters;

    const geomType = feature.geometryType;

    if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
      // Direct polygon surface triangulation (e.g. surveyed Abadi road corridors)
      const polyParts: Coordinate[][][] =
        geomType === 'Polygon'
          ? [(feature.geometry as GeoJSONPolygon).coordinates]
          : (feature.geometry as GeoJSONMultiPolygon).coordinates;

      for (const rings of polyParts) {
        if (!rings || rings.length === 0 || rings[0].length < 3) continue;
        const exterior2D = this.coordsToLocal2D(rings[0], converter);
        const holes2D = rings.slice(1).map((h) => this.coordsToLocal2D(h, converter));

        const shape = this.createShapeWithHoles(exterior2D, holes2D);
        const geom = new THREE.ShapeGeometry(shape);
        // Align on ground plane: X=East, Y=Up, Z=South
        geom.rotateX(-Math.PI / 2);
        geom.translate(0, elevY, 0);
        geom.computeVertexNormals();

        const mesh = new THREE.Mesh(geom, material);
        mesh.receiveShadow = true;
        roadGroup.add(mesh);

        // Raised stone curb outline for visual demarcation
        if (this.options.enableCurbs) {
          const curbGeom = this.createCurbLineSegments(
            exterior2D,
            holes2D,
            elevY + this.options.curbElevationOffsetMeters
          );
          if (curbGeom) {
            const curbLine = new THREE.LineSegments(curbGeom, this.materialSystem.roadCurbMaterial);
            curbLine.name = `RoadCurb_${feature.featureId}`;
            roadGroup.add(curbLine);
          }
        }
      }
    } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
      // Centerline ribbon extrusion
      const lineParts: Coordinate[][] =
        geomType === 'LineString'
          ? [(feature.geometry as GeoJSONLineString).coordinates]
          : (feature.geometry as GeoJSONMultiLineString).coordinates;

      for (const coords of lineParts) {
        if (!coords || coords.length < 2) continue;
        const points2D = this.coordsToLocal2D(coords, converter);
        const ribbonGeom = this.generateRibbonGeometry(points2D, widthResult.widthMeters, elevY);

        if (ribbonGeom) {
          const mesh = new THREE.Mesh(ribbonGeom, material);
          mesh.receiveShadow = true;
          roadGroup.add(mesh);
        }

        // Raised curb lines along outer ribbon edges
        if (this.options.enableCurbs) {
          const ribbonCurbGeom = this.createRibbonCurbLineSegments(
            points2D,
            widthResult.widthMeters,
            elevY + this.options.curbElevationOffsetMeters
          );
          if (ribbonCurbGeom) {
            const ribbonCurbLine = new THREE.LineSegments(
              ribbonCurbGeom,
              this.materialSystem.roadCurbMaterial
            );
            ribbonCurbLine.name = `RoadRibbonCurb_${feature.featureId}`;
            roadGroup.add(ribbonCurbLine);
          }
        }
      }
    } else {
      throw new RoadGeneratorError(
        `Feature '${feature.featureId}' has unsupported geometry type '${geomType}' for roads.`
      );
    }

    const metadata: Road3DMetadata = {
      featureId: feature.featureId,
      sourceId: feature.sourceId,
      sourceName: feature.sourceName,
      sourceLayer: feature.sourceLayer,
      category: feature.category,
      subcategory: feature.subcategory,
      widthMeters: widthResult.widthMeters,
      isWidthEstimated: widthResult.isWidthEstimated,
      widthEstimationMethod: widthResult.widthEstimationMethod,
      verticalTier: feature.verticalTier,
      plinthElevationM: elevY,
      lengthMeters:
        typeof feature.properties['st_length(shape)'] === 'number'
          ? feature.properties['st_length(shape)']
          : undefined,
      rawAttributes: feature.rawAttributes,
    };

    roadGroup.userData = metadata;

    return {
      mesh: roadGroup,
      metadata,
    };
  }

  /**
   * Determines road width based on available attributes or subcategory defaults.
   */
  public estimateRoadWidth(feature: LoadedGeospatialFeature): RoadWidthResult {
    const props = feature.properties || {};

    const explicitW =
      typeof props.width === 'number' && props.width > 0
        ? props.width
        : typeof props.road_width === 'number' && props.road_width > 0
        ? props.road_width
        : typeof props.width_m === 'number' && props.width_m > 0
        ? props.width_m
        : typeof props.carriageway === 'number' && props.carriageway > 0
        ? props.carriageway
        : null;

    if (explicitW !== null) {
      return {
        widthMeters: explicitW,
        isWidthEstimated: false,
        widthEstimationMethod: 'explicit_attribute',
      };
    }

    const sub = (feature.subcategory || '').toLowerCase();
    if (sub.includes('paved') || sub.includes('highway') || sub.includes('major')) {
      return {
        widthMeters: this.options.pavedRoadWidthMeters,
        isWidthEstimated: true,
        widthEstimationMethod: 'subcategory_default',
      };
    }
    if (sub.includes('village') || sub.includes('rural') || sub.includes('residential')) {
      return {
        widthMeters: this.options.villageRoadWidthMeters,
        isWidthEstimated: true,
        widthEstimationMethod: 'subcategory_default',
      };
    }
    if (sub.includes('path') || sub.includes('track') || sub.includes('pedestrian')) {
      return {
        widthMeters: this.options.pathWidthMeters,
        isWidthEstimated: true,
        widthEstimationMethod: 'subcategory_default',
      };
    }

    return {
      widthMeters: this.options.defaultRoadWidthMeters,
      isWidthEstimated: true,
      widthEstimationMethod: 'default_fallback',
    };
  }

  /**
   * Generates a 2D ribbon strip along a centerline with miter joins at vertices.
   */
  private generateRibbonGeometry(
    points2D: [number, number][],
    width: number,
    elevationY: number
  ): THREE.BufferGeometry | null {
    // Remove consecutive duplicate points
    const cleanPoints: [number, number][] = [];
    for (let i = 0; i < points2D.length; i++) {
      if (i === 0 || !this.arePointsEqual(points2D[i], points2D[i - 1])) {
        cleanPoints.push(points2D[i]);
      }
    }

    if (cleanPoints.length < 2) return null;

    const halfWidth = width / 2.0;
    const n = cleanPoints.length;

    // Calculate segment vectors and segment normals
    const segVectors: [number, number][] = [];
    const segNormals: [number, number][] = [];

    for (let i = 0; i < n - 1; i++) {
      const dx = cleanPoints[i + 1][0] - cleanPoints[i][0];
      const dy = cleanPoints[i + 1][1] - cleanPoints[i][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1e-6) {
        segVectors.push([dx / len, dy / len]);
        // Normal rotated 90 degrees CCW: (-dy, dx)
        segNormals.push([-dy / len, dx / len]);
      } else {
        segVectors.push([1, 0]);
        segNormals.push([0, 1]);
      }
    }

    // Compute vertex offsets (left and right) using miter joins
    const leftVertices: [number, number][] = [];
    const rightVertices: [number, number][] = [];

    for (let i = 0; i < n; i++) {
      const p = cleanPoints[i];
      let nx: number;
      let ny: number;
      let miterLength = 1.0;

      if (i === 0) {
        // Start vertex
        nx = segNormals[0][0];
        ny = segNormals[0][1];
      } else if (i === n - 1) {
        // End vertex
        nx = segNormals[n - 2][0];
        ny = segNormals[n - 2][1];
      } else {
        // Intermediate vertex: average neighboring segment normals
        const n1 = segNormals[i - 1];
        const n2 = segNormals[i];
        const mx = (n1[0] + n2[0]) / 2.0;
        const my = (n1[1] + n2[1]) / 2.0;
        const mLen = Math.sqrt(mx * mx + my * my);

        if (mLen > 1e-4) {
          nx = mx / mLen;
          ny = my / mLen;
          // Miter ratio = 1 / dot(miterNormal, n1)
          const dot = nx * n1[0] + ny * n1[1];
          miterLength = dot > 0.1 ? Math.min(this.options.maxMiterRatio, 1.0 / dot) : 1.0;
        } else {
          nx = n1[0];
          ny = n1[1];
        }
      }

      const offsetDist = halfWidth * miterLength;
      leftVertices.push([p[0] + nx * offsetDist, p[1] + ny * offsetDist]);
      rightVertices.push([p[0] - nx * offsetDist, p[1] - ny * offsetDist]);
    }

    // Build triangle mesh positions
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    for (let i = 0; i < n - 1; i++) {
      // Quad between segment i and i+1
      // Remember local 2D: (u, v) -> Three.js (x = u, y = elevationY, z = -v)
      const pL0 = leftVertices[i];
      const pR0 = rightVertices[i];
      const pL1 = leftVertices[i + 1];
      const pR1 = rightVertices[i + 1];

      const vL0 = new THREE.Vector3(pL0[0], elevationY, -pL0[1]);
      const vR0 = new THREE.Vector3(pR0[0], elevationY, -pR0[1]);
      const vL1 = new THREE.Vector3(pL1[0], elevationY, -pL1[1]);
      const vR1 = new THREE.Vector3(pR1[0], elevationY, -pR1[1]);

      // Triangle 1: (vL0, vR0, vR1)
      this.addTriangle(positions, normals, uvs, vL0, vR0, vR1);
      // Triangle 2: (vL0, vR1, vL1)
      this.addTriangle(positions, normals, uvs, vL0, vR1, vL1);
    }

    // Optional End Caps
    if (this.options.roundCaps) {
      this.addSemiCircleCap(positions, normals, uvs, cleanPoints[0], -segVectors[0][0], -segVectors[0][1], halfWidth, elevationY);
      const last = n - 1;
      this.addSemiCircleCap(positions, normals, uvs, cleanPoints[last], segVectors[last - 1][0], segVectors[last - 1][1], halfWidth, elevationY);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    return geom;
  }

  private addSemiCircleCap(
    positions: number[],
    normals: number[],
    uvs: number[],
    center: [number, number],
    dirX: number,
    dirY: number,
    radius: number,
    elevationY: number
  ) {
    const segments = 6;
    const centerV = new THREE.Vector3(center[0], elevationY, -center[1]);
    const baseAngle = Math.atan2(dirY, dirX);

    for (let i = 0; i < segments; i++) {
      const a1 = baseAngle - Math.PI / 2 + (i * Math.PI) / segments;
      const a2 = baseAngle - Math.PI / 2 + ((i + 1) * Math.PI) / segments;

      const p1X = center[0] + Math.cos(a1) * radius;
      const p1Y = center[1] + Math.sin(a1) * radius;
      const p2X = center[0] + Math.cos(a2) * radius;
      const p2Y = center[1] + Math.sin(a2) * radius;

      const v1 = new THREE.Vector3(p1X, elevationY, -p1Y);
      const v2 = new THREE.Vector3(p2X, elevationY, -p2Y);

      this.addTriangle(positions, normals, uvs, centerV, v1, v2);
    }
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
    // Upward-facing normals for road surface
    for (let i = 0; i < 3; i++) {
      normals.push(0, 1, 0);
    }
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }

  private resolveRoadMaterial(feature: LoadedGeospatialFeature): THREE.MeshStandardMaterial {
    const sub = (feature.subcategory || '').toLowerCase();
    if (sub.includes('shoulder')) {
      return this.materialSystem.roadShoulderMaterial;
    }
    if (sub.includes('paved') || sub.includes('highway') || sub.includes('major') || sub.includes('asphalt')) {
      return this.materialSystem.asphaltRoadMaterial;
    }
    return this.materialSystem.earthenRoadMaterial;
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

  /**
   * Constructs raised line segments along polygon exterior boundaries and interior holes.
   */
  private createCurbLineSegments(
    exterior: [number, number][],
    holes: [number, number][][],
    elevationY: number
  ): THREE.BufferGeometry | null {
    const positions: number[] = [];

    const addRingLines = (ring: [number, number][]) => {
      const n = ring.length;
      if (n < 2) return;
      for (let i = 0; i < n - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        positions.push(p1[0], elevationY, -p1[1]);
        positions.push(p2[0], elevationY, -p2[1]);
      }
    };

    addRingLines(exterior);
    for (const h of holes) {
      addRingLines(h);
    }

    if (positions.length === 0) return null;

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }

  /**
   * Constructs raised curb line segments along the left and right edges of a ribbon road.
   */
  private createRibbonCurbLineSegments(
    points2D: [number, number][],
    width: number,
    elevationY: number
  ): THREE.BufferGeometry | null {
    const cleanPoints: [number, number][] = [];
    for (let i = 0; i < points2D.length; i++) {
      if (i === 0 || !this.arePointsEqual(points2D[i], points2D[i - 1])) {
        cleanPoints.push(points2D[i]);
      }
    }
    if (cleanPoints.length < 2) return null;

    const halfWidth = width / 2.0;
    const n = cleanPoints.length;
    const segNormals: [number, number][] = [];

    for (let i = 0; i < n - 1; i++) {
      const dx = cleanPoints[i + 1][0] - cleanPoints[i][0];
      const dy = cleanPoints[i + 1][1] - cleanPoints[i][1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 1e-6) {
        segNormals.push([-dy / len, dx / len]);
      } else {
        segNormals.push([0, 1]);
      }
    }

    const leftVertices: [number, number][] = [];
    const rightVertices: [number, number][] = [];

    for (let i = 0; i < n; i++) {
      const p = cleanPoints[i];
      let nx: number;
      let ny: number;
      let miterLength = 1.0;

      if (i === 0) {
        nx = segNormals[0][0];
        ny = segNormals[0][1];
      } else if (i === n - 1) {
        nx = segNormals[n - 2][0];
        ny = segNormals[n - 2][1];
      } else {
        const n1 = segNormals[i - 1];
        const n2 = segNormals[i];
        const mx = (n1[0] + n2[0]) / 2.0;
        const my = (n1[1] + n2[1]) / 2.0;
        const mLen = Math.sqrt(mx * mx + my * my);
        if (mLen > 1e-4) {
          nx = mx / mLen;
          ny = my / mLen;
          const dot = nx * n1[0] + ny * n1[1];
          miterLength = dot > 0.1 ? Math.min(this.options.maxMiterRatio, 1.0 / dot) : 1.0;
        } else {
          nx = n1[0];
          ny = n1[1];
        }
      }

      const offsetDist = halfWidth * miterLength;
      leftVertices.push([p[0] + nx * offsetDist, p[1] + ny * offsetDist]);
      rightVertices.push([p[0] - nx * offsetDist, p[1] - ny * offsetDist]);
    }

    const positions: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      // Left edge line
      positions.push(leftVertices[i][0], elevationY, -leftVertices[i][1]);
      positions.push(leftVertices[i + 1][0], elevationY, -leftVertices[i + 1][1]);
      // Right edge line
      positions.push(rightVertices[i][0], elevationY, -rightVertices[i][1]);
      positions.push(rightVertices[i + 1][0], elevationY, -rightVertices[i + 1][1]);
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return geom;
  }

  private arePointsEqual(p1: [number, number], p2: [number, number]): boolean {
    return Math.abs(p1[0] - p2[0]) < 1e-4 && Math.abs(p1[1] - p2[1]) < 1e-4;
  }
}
