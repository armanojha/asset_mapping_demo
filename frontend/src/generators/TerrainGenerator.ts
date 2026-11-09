/**
 * Procedural Terrain & Diorama Pedestal Generator for the Village Asset Mapping System.
 *
 * Objectives:
 * 1. Converts verified DEM elevation rasters into 3D terrain surfaces when available.
 * 2. Uses a strictly identified flat cadastral fallback when DEM data is missing (never simulates fake hills).
 * 3. Extrudes the village boundary into a solid, stratified sandstone diorama pedestal base.
 * 4. Maintains sub-millimeter coordinate alignment with buildings, roads, and land parcels.
 */

import * as THREE from 'three';
import { CoordinateConverter } from './CoordinateConverter';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';
import {
  Coordinate,
  GeoJSONMultiPolygon,
  GeoJSONPolygon,
  LoadedGeospatialFeature,
} from '../types/geospatial';

export interface DemGridData {
  width: number;
  height: number;
  minElevationM: number;
  maxElevationM: number;
  elevations: Float32Array; // Row-major elevation values in SI meters
  bboxWgs84: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  noDataValue?: number;
}

export interface TerrainGeneratorOptions {
  verticalExaggeration?: number;         // Default: 1.2
  surfaceElevationOffsetMeters?: number; // Default: -0.05m (sits below parcels Y=-0.01 and roads Y=0.00)
  pedestalDepthMeters?: number;          // Default: 6.0m (downward diorama pedestal)
  enableDioramaPedestal?: boolean;       // Default: true
  enableBoundaryCurb?: boolean;          // Default: true
  meshResolutionSegments?: number;       // Default: 48 (grid density when DEM is active)
  useSatelliteBasemap?: boolean;         // Default: true
  satelliteUtmBounds?: [number, number, number, number]; // [minX, minY, maxX, maxY]
}

export interface Terrain3DMetadata {
  isDemAvailable: boolean;
  elevationSource: 'raster_dem' | 'flat_boundary_fallback';
  minElevationM: number;
  maxElevationM: number;
  verticalExaggeration: number;
  surfaceElevationM: number;
  pedestalDepthM: number;
  hasDioramaPedestal: boolean;
  areaSqm?: number;
  rawAttributes?: Record<string, any>;
}

export interface GeneratedTerrainObject {
  group: THREE.Group;
  surfaceMesh: THREE.Mesh;
  pedestalMesh?: THREE.Mesh;
  boundaryCurb?: THREE.LineSegments;
  metadata: Terrain3DMetadata;
}

export class TerrainGeneratorError extends Error {
  constructor(message: string) {
    super(`[TerrainGenerator] ${message}`);
    this.name = 'TerrainGeneratorError';
  }
}

export class TerrainGenerator {
  private readonly options: Required<TerrainGeneratorOptions>;
  private readonly materialSystem: BuildingMaterialSystem;

  constructor(options: TerrainGeneratorOptions = {}, materialSystem?: BuildingMaterialSystem) {
    this.options = {
      verticalExaggeration: options.verticalExaggeration ?? 1.2,
      surfaceElevationOffsetMeters: options.surfaceElevationOffsetMeters ?? -0.05,
      pedestalDepthMeters: options.pedestalDepthMeters ?? 6.0,
      enableDioramaPedestal: options.enableDioramaPedestal ?? true,
      enableBoundaryCurb: options.enableBoundaryCurb ?? true,
      meshResolutionSegments: options.meshResolutionSegments ?? 48,
      useSatelliteBasemap: options.useSatelliteBasemap ?? true,
      satelliteUtmBounds: options.satelliteUtmBounds ?? [302000, 2556400, 305100, 2559400],
    };
    this.materialSystem = materialSystem || BuildingMaterialSystem.getInstance();
  }

  /**
   * Generates the village terrain and diorama pedestal using the village boundary feature.
   * If demData is provided, heights are sampled from the DEM raster.
   * Otherwise, generates a flat cadastral terrain surface with monolithic pedestal.
   */
  public generateTerrain(
    boundaryFeature: LoadedGeospatialFeature,
    converter: CoordinateConverter,
    demData?: DemGridData | null
  ): GeneratedTerrainObject {
    if (
      boundaryFeature.geometryType !== 'Polygon' &&
      boundaryFeature.geometryType !== 'MultiPolygon'
    ) {
      throw new TerrainGeneratorError(
        `Boundary feature '${boundaryFeature.featureId}' has unsupported geometry type '${boundaryFeature.geometryType}'. Expected Polygon or MultiPolygon.`
      );
    }

    const terrainGroup = new THREE.Group();
    terrainGroup.name = `Terrain_${boundaryFeature.featureId}`;

    const polyParts: Coordinate[][][] =
      boundaryFeature.geometryType === 'Polygon'
        ? [(boundaryFeature.geometry as GeoJSONPolygon).coordinates]
        : (boundaryFeature.geometry as GeoJSONMultiPolygon).coordinates;

    if (polyParts.length === 0 || polyParts[0].length === 0 || polyParts[0][0].length < 3) {
      throw new TerrainGeneratorError('Village boundary has insufficient polygon vertices');
    }

    const exteriorRing = polyParts[0][0];
    const interiorRings = polyParts[0].slice(1);

    const exterior2D = this.coordsToLocal2D(exteriorRing, converter);
    const interior2DList = interiorRings.map((h) => this.coordsToLocal2D(h, converter));

    // 1. Surface Mesh Construction (DEM-based or flat fallback)
    let surfaceMesh: THREE.Mesh;
    let isDemUsed = false;
    let minElev = 0;
    let maxElev = 0;

    if (demData && demData.elevations && demData.elevations.length > 0) {
      // Build DEM-interpolated grid surface
      surfaceMesh = this.buildDemSurfaceMesh(demData, exterior2D, converter);
      isDemUsed = true;
      minElev = demData.minElevationM;
      maxElev = demData.maxElevationM;
    } else {
      // Build Flat Cadastral Surface Mesh (honest fallback - never invent fake hills)
      surfaceMesh = this.buildFlatSurfaceMesh(exterior2D, interior2DList, converter);
    }

    surfaceMesh.name = `TerrainSurface_${boundaryFeature.featureId}`;
    surfaceMesh.receiveShadow = true;
    terrainGroup.add(surfaceMesh);

    // 2. Monolithic Diorama Pedestal Extrusion (downward -Y)
    let pedestalMesh: THREE.Mesh | undefined;
    if (this.options.enableDioramaPedestal) {
      pedestalMesh = this.buildDioramaPedestal(exterior2D, interior2DList);
      pedestalMesh.name = `DioramaPedestal_${boundaryFeature.featureId}`;
      terrainGroup.add(pedestalMesh);
    }

    // 3. Perimeter Boundary Curb Line
    let boundaryCurb: THREE.LineSegments | undefined;
    if (this.options.enableBoundaryCurb) {
      boundaryCurb = this.buildBoundaryCurbLine(exterior2D);
      boundaryCurb.name = `DioramaCurb_${boundaryFeature.featureId}`;
      terrainGroup.add(boundaryCurb);
    }

    const areaSqm = this.computePolygonArea(exterior2D);

    const metadata: Terrain3DMetadata = {
      isDemAvailable: isDemUsed,
      elevationSource: isDemUsed ? 'raster_dem' : 'flat_boundary_fallback',
      minElevationM: minElev,
      maxElevationM: maxElev,
      verticalExaggeration: this.options.verticalExaggeration,
      surfaceElevationM: this.options.surfaceElevationOffsetMeters,
      pedestalDepthM: this.options.pedestalDepthMeters,
      hasDioramaPedestal: Boolean(pedestalMesh),
      areaSqm: Math.round(areaSqm * 100) / 100,
      rawAttributes: boundaryFeature.rawAttributes,
    };

    return {
      group: terrainGroup,
      surfaceMesh,
      pedestalMesh,
      boundaryCurb,
      metadata,
    };
  }

  /**
   * Builds flat cadastral terrain surface mesh bounded by the village perimeter.
   * Maps conformal UTM UV coordinates for exact satellite basemap alignment.
   */
  private buildFlatSurfaceMesh(
    exterior: [number, number][],
    holes: [number, number][][],
    converter: CoordinateConverter
  ): THREE.Mesh {
    const shape = this.createShapeWithHoles(exterior, holes);
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2); // Map 2D shape (X, Y) to 3D horizontal (X, Z)
    geom.translate(0, this.options.surfaceElevationOffsetMeters, 0);
    geom.computeVertexNormals();

    // Map exact conformal UTM-anchored UV coordinates
    const [minUtmX, minUtmY, maxUtmX, maxUtmY] = this.options.satelliteUtmBounds;
    const origin = converter.getAnchor();
    const localMinX = minUtmX - origin.originXUtm;
    const localMaxX = maxUtmX - origin.originXUtm;
    const localMinZ = -(maxUtmY - origin.originYUtm); // North = top of image
    const localMaxZ = -(minUtmY - origin.originYUtm); // South = bottom of image

    const posAttr = geom.getAttribute('position');
    const uvs: number[] = [];
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const z = posAttr.getZ(i);

      const u = (x - localMinX) / (localMaxX - localMinX);
      const v = (localMaxZ - z) / (localMaxZ - localMinZ);
      uvs.push(Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
    }

    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

    const material = this.options.useSatelliteBasemap
      ? this.materialSystem.satelliteBasemapMaterial
      : this.materialSystem.terrainMaterial;

    return new THREE.Mesh(geom, material);
  }

  /**
   * Builds a monolithic diorama pedestal by extruding the boundary polygon downward.
   */
  private buildDioramaPedestal(
    exterior: [number, number][],
    holes: [number, number][][]
  ): THREE.Mesh {
    const shape = this.createShapeWithHoles(exterior, holes);

    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: this.options.pedestalDepthMeters,
      bevelEnabled: false,
    };

    const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // In Three.js, extrude is along +Z. Rotate by -PI/2 so (X, Y) maps to (X, -Z)
    // exactly matching Three.js world coordinates (+X = East, -Z = North).
    geom.rotateX(-Math.PI / 2);
    // Translate downwards so top surface sits at surfaceElevationOffsetMeters
    // and bottom base extends downward to -pedestalDepthMeters.
    geom.translate(
      0,
      this.options.surfaceElevationOffsetMeters - this.options.pedestalDepthMeters,
      0
    );
    geom.computeVertexNormals();

    const mesh = new THREE.Mesh(geom, this.materialSystem.dioramaPedestalMaterial);
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Builds a subtle raised curb stroke along the boundary perimeter.
   */
  private buildBoundaryCurbLine(exterior: [number, number][]): THREE.LineSegments {
    const points: THREE.Vector3[] = [];
    const n = exterior.length;
    const y = this.options.surfaceElevationOffsetMeters + 0.01;

    for (let i = 0; i < n - 1; i++) {
      points.push(
        new THREE.Vector3(exterior[i][0], y, -exterior[i][1]),
        new THREE.Vector3(exterior[i + 1][0], y, -exterior[i + 1][1])
      );
    }

    const geom = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineSegments(geom, this.materialSystem.villageBoundaryLineMaterial);
  }

  /**
   * Constructs an interpolated DEM terrain surface mesh when actual DEM raster is provided.
   */
  private buildDemSurfaceMesh(
    dem: DemGridData,
    _exterior: [number, number][],
    converter: CoordinateConverter
  ): THREE.Mesh {
    const [minLon, minLat, maxLon, maxLat] = dem.bboxWgs84;
    const pMin = converter.toLocal(minLon, minLat);
    const pMax = converter.toLocal(maxLon, maxLat);

    const widthM = Math.abs(pMax.x - pMin.x);
    const depthM = Math.abs(pMax.z - pMin.z);

    const segments = Math.max(16, Math.min(128, this.options.meshResolutionSegments));
    const geom = new THREE.PlaneGeometry(widthM, depthM, segments, segments);
    geom.rotateX(-Math.PI / 2);

    const posAttr = geom.attributes.position as THREE.BufferAttribute;
    const vertexCount = posAttr.count;

    for (let i = 0; i < vertexCount; i++) {
      const u = (posAttr.getX(i) + widthM / 2) / widthM;
      const v = (posAttr.getZ(i) + depthM / 2) / depthM;

      const col = Math.min(dem.width - 1, Math.max(0, Math.floor(u * dem.width)));
      const row = Math.min(dem.height - 1, Math.max(0, Math.floor(v * dem.height)));

      const idx = row * dem.width + col;
      const rawElev = dem.elevations[idx] || 0;
      const finalY =
        this.options.surfaceElevationOffsetMeters +
        (rawElev - dem.minElevationM) * this.options.verticalExaggeration;

      posAttr.setY(i, finalY);
    }

    geom.computeVertexNormals();
    return new THREE.Mesh(geom, this.materialSystem.terrainMaterial);
  }

  private coordsToLocal2D(coords: Coordinate[], converter: CoordinateConverter): [number, number][] {
    const points2D: [number, number][] = [];
    for (const c of coords) {
      const p = converter.toLocal(c[0], c[1]);
      // In Three.js coordinate mapping: x = localX, z = -localY
      // So local 2D is [x, -z] = [localX, localY]
      points2D.push([p.x, -p.z]);
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
      const path = new THREE.Path();
      path.moveTo(h[0][0], h[0][1]);
      for (let i = 1; i < h.length; i++) {
        path.lineTo(h[i][0], h[i][1]);
      }
      path.closePath();
      shape.holes.push(path);
    }

    return shape;
  }

  private computePolygonArea(ring: [number, number][]): number {
    let area = 0;
    const n = ring.length;
    for (let i = 0; i < n - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(area) / 2.0;
  }
}
