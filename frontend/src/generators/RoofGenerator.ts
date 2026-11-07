/**
 * Modular Procedural Roof Generator for the Village Asset Mapping System.
 * Generates Flat Terrace, Gabled Tile, and Hipped roof geometries aligned with building walls.
 * Handles irregular footprints with graceful fallback to flat roofs to prevent gaps or visual artifacts.
 */

import * as THREE from 'three';
import { BuildingMaterialSystem } from '../materials/BuildingMaterials';

export type RoofType = 'flat_terrace' | 'gabled_tile' | 'hipped' | 'flat' | 'gable' | 'hip';

export interface RoofGeneratorOptions {
  defaultRoofType?: RoofType;
  terraceSlabThickness?: number;  // Default: 0.15m
  parapetHeight?: number;         // Default: 0.35m
  parapetEnabled?: boolean;       // Default: true
  gablePitchAngleDeg?: number;    // Default: 25 degrees
  eaveOverhangMeters?: number;    // Default: 0.20m
  hipRidgeRatio?: number;         // Default: 0.5
}

export interface GeneratedRoofResult {
  mesh: THREE.Mesh | THREE.Group;
  roofType: RoofType;
  isRoofEstimated: boolean;
  roofEstimationMethod: string;
  roofHeightMeters: number;
  fallbackApplied: boolean;
  fallbackReason?: string;
}

export class RoofGenerator {
  private readonly options: Required<RoofGeneratorOptions>;
  private readonly materialSystem: BuildingMaterialSystem;

  constructor(options: RoofGeneratorOptions = {}, materialSystem?: BuildingMaterialSystem) {
    this.options = {
      defaultRoofType: options.defaultRoofType || 'flat_terrace',
      terraceSlabThickness: options.terraceSlabThickness ?? 0.15,
      parapetHeight: options.parapetHeight ?? 0.35,
      parapetEnabled: options.parapetEnabled ?? true,
      gablePitchAngleDeg: options.gablePitchAngleDeg ?? 25,
      eaveOverhangMeters: options.eaveOverhangMeters ?? 0.20,
      hipRidgeRatio: options.hipRidgeRatio ?? 0.5,
    };
    this.materialSystem = materialSystem || BuildingMaterialSystem.getInstance();
  }

  /**
   * Generates roof geometry atop building walls at wallTopY.
   */
  public generateRoof(
    shape: THREE.Shape,
    exteriorPoints2D: [number, number][], // [x, -z] coordinates in local space
    wallTopY: number,
    requestedRoofType?: string,
    featureAttributes?: Record<string, any>
  ): GeneratedRoofResult {
    const { resolvedType, isEstimated, method } = this.resolveRoofType(
      requestedRoofType,
      featureAttributes,
      exteriorPoints2D
    );

    let result: GeneratedRoofResult;

    switch (resolvedType) {
      case 'gabled_tile':
      case 'gable':
        result = this.generateGableRoof(exteriorPoints2D, wallTopY, isEstimated, method);
        break;
      case 'hipped':
      case 'hip':
        result = this.generateHipRoof(exteriorPoints2D, wallTopY, isEstimated, method);
        break;
      case 'flat_terrace':
      case 'flat':
      default:
        result = this.generateFlatTerraceRoof(shape, exteriorPoints2D, wallTopY, isEstimated, method);
        break;
    }

    return result;
  }

  /**
   * Resolves the roof type from attributes or aspect ratio heuristics.
   */
  private resolveRoofType(
    explicitType?: string,
    props?: Record<string, any>,
    points2D?: [number, number][]
  ): { resolvedType: RoofType; isEstimated: boolean; method: string } {
    const raw =
      explicitType ||
      props?._procedural_roof_type ||
      props?.roof_type ||
      props?.roof_shape ||
      props?.['roof:shape'];

    if (raw && typeof raw === 'string') {
      const lower = raw.toLowerCase().trim();
      if (lower.includes('gable')) {
        return { resolvedType: 'gabled_tile', isEstimated: false, method: 'source_attribute' };
      }
      if (lower.includes('hip')) {
        return { resolvedType: 'hipped', isEstimated: false, method: 'source_attribute' };
      }
      if (lower.includes('flat') || lower.includes('terrace')) {
        return { resolvedType: 'flat_terrace', isEstimated: false, method: 'source_attribute' };
      }
    }

    // Aspect ratio heuristic if points available
    if (points2D && points2D.length >= 3) {
      const bbox = this.compute2DBBox(points2D);
      const width = bbox.maxX - bbox.minX;
      const height = bbox.maxY - bbox.minY;
      const aspectRatio = Math.max(width, height) / Math.max(0.1, Math.min(width, height));

      if (aspectRatio >= 1.6) {
        return { resolvedType: 'gabled_tile', isEstimated: true, method: 'aspect_ratio_heuristic' };
      } else if (aspectRatio <= 1.25) {
        return { resolvedType: 'hipped', isEstimated: true, method: 'aspect_ratio_heuristic' };
      }
    }

    return {
      resolvedType: this.options.defaultRoofType,
      isEstimated: true,
      method: 'default_fallback',
    };
  }

  // =========================================================================
  // 1. FLAT TERRACE ROOF GENERATION
  // =========================================================================

  private generateFlatTerraceRoof(
    shape: THREE.Shape,
    exteriorPoints2D: [number, number][],
    wallTopY: number,
    isEstimated: boolean,
    method: string,
    fallbackReason?: string
  ): GeneratedRoofResult {
    const roofGroup = new THREE.Group();
    roofGroup.name = 'FlatTerraceRoof';

    const slabThickness = this.options.terraceSlabThickness;
    const extrudeSettings: THREE.ExtrudeGeometryOptions = {
      depth: slabThickness,
      bevelEnabled: false,
    };

    // Extrude slab
    const slabGeom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    // Align with ground plane (X=East, Y=Up, Z=South)
    slabGeom.rotateX(-Math.PI / 2);
    slabGeom.translate(0, wallTopY, 0);
    slabGeom.computeVertexNormals();

    const slabMesh = new THREE.Mesh(slabGeom, this.materialSystem.flatRoofMaterial);
    slabMesh.castShadow = true;
    slabMesh.receiveShadow = true;
    roofGroup.add(slabMesh);

    // Optional Parapet Rim along perimeter
    if (this.options.parapetEnabled && exteriorPoints2D.length >= 3) {
      const parapetGeom = this.generateParapetWallGeometry(
        exteriorPoints2D,
        wallTopY + slabThickness,
        this.options.parapetHeight
      );
      if (parapetGeom) {
        const parapetMesh = new THREE.Mesh(parapetGeom, this.materialSystem.defaultWallMaterial);
        roofGroup.add(parapetMesh);
      }
    }

    const totalHeight = slabThickness + (this.options.parapetEnabled ? this.options.parapetHeight : 0);

    return {
      mesh: roofGroup,
      roofType: 'flat_terrace',
      isRoofEstimated: isEstimated,
      roofEstimationMethod: method,
      roofHeightMeters: totalHeight,
      fallbackApplied: Boolean(fallbackReason),
      fallbackReason,
    };
  }

  // =========================================================================
  // 2. GABLED TILE ROOF GENERATION
  // =========================================================================

  private generateGableRoof(
    points2D: [number, number][],
    wallTopY: number,
    isEstimated: boolean,
    method: string
  ): GeneratedRoofResult {
    // If footprint is too complex / irregular, fall back to flat terrace
    if (points2D.length < 4 || !this.isPitchedRoofCandidate(points2D)) {
      const fallbackShape = this.createShapeFromPoints(points2D);
      return this.generateFlatTerraceRoof(
        fallbackShape,
        points2D,
        wallTopY,
        true,
        method,
        'Irregular footprint shape unsuitable for symmetrical dual-slope gable.'
      );
    }

    const bbox = this.compute2DBBox(points2D);
    const spanX = bbox.maxX - bbox.minX;
    const spanZ = bbox.maxY - bbox.minY;
    const isLongAlongX = spanX >= spanZ;

    // Calculate ridge parameters
    const halfWidth = (isLongAlongX ? spanZ : spanX) / 2.0;
    const pitchRad = (this.options.gablePitchAngleDeg * Math.PI) / 180;
    const ridgeHeight = Math.max(1.2, Math.min(3.5, halfWidth * Math.tan(pitchRad)));
    const ridgeY = wallTopY + ridgeHeight;
    const overhang = this.options.eaveOverhangMeters;

    const roofGroup = new THREE.Group();
    roofGroup.name = 'GabledTileRoof';

    const roofGeom = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    // Construct sloped rectangular panels and triangular gable end walls
    if (isLongAlongX) {
      const zMid = (bbox.minY + bbox.maxY) / 2.0;
      const x0 = bbox.minX - overhang;
      const x1 = bbox.maxX + overhang;
      const z0 = bbox.minY - overhang;
      const z1 = bbox.maxY + overhang;

      // Ridge points: R0 = (x0, ridgeY, -zMid), R1 = (x1, ridgeY, -zMid)
      // Eave points:
      // Side A (North): E0 = (x0, wallTopY, -z1), E1 = (x1, wallTopY, -z1)
      // Side B (South): E2 = (x0, wallTopY, -z0), E3 = (x1, wallTopY, -z0)
      // Note: In Three.js, z_three = -v, so v = -z_three

      // Slope A (Side 1)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z1),
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(x1, ridgeY, -zMid),
        new THREE.Vector3(x0, ridgeY, -zMid)
      );

      // Slope B (Side 2)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(x0, ridgeY, -zMid),
        new THREE.Vector3(x1, ridgeY, -zMid),
        new THREE.Vector3(x1, wallTopY, -z0),
        new THREE.Vector3(x0, wallTopY, -z0)
      );

      // Gable End Wall 1 (West: at x0)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z0),
        new THREE.Vector3(x0, ridgeY, -zMid),
        new THREE.Vector3(x0, wallTopY, -z1)
      );

      // Gable End Wall 2 (East: at x1)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(x1, ridgeY, -zMid),
        new THREE.Vector3(x1, wallTopY, -z0)
      );
    } else {
      // Long along Z axis
      const xMid = (bbox.minX + bbox.maxX) / 2.0;
      const z0 = bbox.minY - overhang;
      const z1 = bbox.maxY + overhang;
      const x0 = bbox.minX - overhang;
      const x1 = bbox.maxX + overhang;

      // Slope A (West)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z0),
        new THREE.Vector3(x0, wallTopY, -z1),
        new THREE.Vector3(xMid, ridgeY, -z1),
        new THREE.Vector3(xMid, ridgeY, -z0)
      );

      // Slope B (East)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(xMid, ridgeY, -z0),
        new THREE.Vector3(xMid, ridgeY, -z1),
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(x1, wallTopY, -z0)
      );

      // Gable End Wall 1 (South: at z0)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z0),
        new THREE.Vector3(xMid, ridgeY, -z0),
        new THREE.Vector3(x1, wallTopY, -z0)
      );

      // Gable End Wall 2 (North: at z1)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(xMid, ridgeY, -z1),
        new THREE.Vector3(x0, wallTopY, -z1)
      );
    }

    roofGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roofGeom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    roofGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roofGeom.computeVertexNormals();

    const roofMesh = new THREE.Mesh(roofGeom, this.materialSystem.gableRoofMaterial);
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    roofGroup.add(roofMesh);

    return {
      mesh: roofGroup,
      roofType: 'gabled_tile',
      isRoofEstimated: isEstimated,
      roofEstimationMethod: method,
      roofHeightMeters: ridgeHeight,
      fallbackApplied: false,
    };
  }

  // =========================================================================
  // 3. HIPPED ROOF GENERATION
  // =========================================================================

  private generateHipRoof(
    points2D: [number, number][],
    wallTopY: number,
    isEstimated: boolean,
    method: string
  ): GeneratedRoofResult {
    if (points2D.length < 4 || !this.isPitchedRoofCandidate(points2D)) {
      const fallbackShape = this.createShapeFromPoints(points2D);
      return this.generateFlatTerraceRoof(
        fallbackShape,
        points2D,
        wallTopY,
        true,
        method,
        'Irregular footprint shape unsuitable for hipped geometry.'
      );
    }

    const bbox = this.compute2DBBox(points2D);
    const spanX = bbox.maxX - bbox.minX;
    const spanZ = bbox.maxY - bbox.minY;
    const overhang = this.options.eaveOverhangMeters;

    const x0 = bbox.minX - overhang;
    const x1 = bbox.maxX + overhang;
    const z0 = bbox.minY - overhang;
    const z1 = bbox.maxY + overhang;

    const isLongAlongX = spanX >= spanZ;
    const halfNarrow = (isLongAlongX ? spanZ : spanX) / 2.0;
    const pitchRad = (this.options.gablePitchAngleDeg * Math.PI) / 180;
    const peakHeight = Math.max(1.2, Math.min(3.2, halfNarrow * Math.tan(pitchRad)));
    const peakY = wallTopY + peakHeight;

    const roofGroup = new THREE.Group();
    roofGroup.name = 'HippedRoof';

    const roofGeom = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    if (isLongAlongX) {
      const zMid = (z0 + z1) / 2.0;
      const inset = halfNarrow * this.options.hipRidgeRatio;
      const rx0 = x0 + inset;
      const rx1 = x1 - inset;

      // Ridge points R0=(rx0, peakY, -zMid), R1=(rx1, peakY, -zMid)
      // Long Side 1 (North trapezoid)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z1),
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(rx1, peakY, -zMid),
        new THREE.Vector3(rx0, peakY, -zMid)
      );

      // Long Side 2 (South trapezoid)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(rx0, peakY, -zMid),
        new THREE.Vector3(rx1, peakY, -zMid),
        new THREE.Vector3(x1, wallTopY, -z0),
        new THREE.Vector3(x0, wallTopY, -z0)
      );

      // Hip End 1 (West triangle)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z0),
        new THREE.Vector3(rx0, peakY, -zMid),
        new THREE.Vector3(x0, wallTopY, -z1)
      );

      // Hip End 2 (East triangle)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(rx1, peakY, -zMid),
        new THREE.Vector3(x1, wallTopY, -z0)
      );
    } else {
      const xMid = (x0 + x1) / 2.0;
      const inset = halfNarrow * this.options.hipRidgeRatio;
      const rz0 = z0 + inset;
      const rz1 = z1 - inset;

      // Long Side 1 (West trapezoid)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z0),
        new THREE.Vector3(x0, wallTopY, -z1),
        new THREE.Vector3(xMid, peakY, -rz1),
        new THREE.Vector3(xMid, peakY, -rz0)
      );

      // Long Side 2 (East trapezoid)
      this.addQuad(
        positions, normals, uvs,
        new THREE.Vector3(xMid, peakY, -rz0),
        new THREE.Vector3(xMid, peakY, -rz1),
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(x1, wallTopY, -z0)
      );

      // Hip End 1 (South triangle)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x0, wallTopY, -z0),
        new THREE.Vector3(xMid, peakY, -rz0),
        new THREE.Vector3(x1, wallTopY, -z0)
      );

      // Hip End 2 (North triangle)
      this.addTriangle(
        positions, normals, uvs,
        new THREE.Vector3(x1, wallTopY, -z1),
        new THREE.Vector3(xMid, peakY, -rz1),
        new THREE.Vector3(x0, wallTopY, -z1)
      );
    }

    roofGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    roofGeom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    roofGeom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    roofGeom.computeVertexNormals();

    const roofMesh = new THREE.Mesh(roofGeom, this.materialSystem.hipRoofMaterial);
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    roofGroup.add(roofMesh);

    return {
      mesh: roofGroup,
      roofType: 'hipped',
      isRoofEstimated: isEstimated,
      roofEstimationMethod: method,
      roofHeightMeters: peakHeight,
      fallbackApplied: false,
    };
  }

  // =========================================================================
  // HELPER GEOMETRY & TRIANGULATION UTILITIES
  // =========================================================================

  private generateParapetWallGeometry(
    ring: [number, number][],
    baseY: number,
    height: number
  ): THREE.BufferGeometry | null {
    if (ring.length < 3) return null;

    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];

    const n = ring.length - (this.arePointsEqual(ring[0], ring[ring.length - 1]) ? 1 : 0);

    for (let i = 0; i < n; i++) {
      const nextIdx = (i + 1) % n;
      const p1 = ring[i];
      const p2 = ring[nextIdx];

      // Outer wall quad:
      const v0 = new THREE.Vector3(p1[0], baseY, -p1[1]);
      const v1 = new THREE.Vector3(p2[0], baseY, -p2[1]);
      const v2 = new THREE.Vector3(p2[0], baseY + height, -p2[1]);
      const v3 = new THREE.Vector3(p1[0], baseY + height, -p1[1]);

      this.addQuad(positions, normals, uvs, v0, v1, v2, v3);
    }

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
    const cb = new THREE.Vector3().subVectors(v2, v1);
    const ab = new THREE.Vector3().subVectors(v0, v1);
    const normal = cb.cross(ab).normalize();

    positions.push(v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
    for (let i = 0; i < 3; i++) {
      normals.push(normal.x, normal.y, normal.z);
    }
    uvs.push(0, 0, 1, 0, 0.5, 1);
  }

  private addQuad(
    positions: number[],
    normals: number[],
    uvs: number[],
    v0: THREE.Vector3,
    v1: THREE.Vector3,
    v2: THREE.Vector3,
    v3: THREE.Vector3
  ) {
    // Two triangles: (v0, v1, v2) and (v0, v2, v3)
    this.addTriangle(positions, normals, uvs, v0, v1, v2);
    this.addTriangle(positions, normals, uvs, v0, v2, v3);
  }

  private isPitchedRoofCandidate(points: [number, number][]): boolean {
    const n = points.length - (this.arePointsEqual(points[0], points[points.length - 1]) ? 1 : 0);
    // 4 to 6 vertices usually form rectangles / L-shapes suitable for pitched roofs
    return n >= 4 && n <= 8;
  }

  private compute2DBBox(points: [number, number][]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return { minX, minY, maxX, maxY };
  }

  private createShapeFromPoints(points: [number, number][]): THREE.Shape {
    const shape = new THREE.Shape();
    if (points.length === 0) return shape;
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      shape.lineTo(points[i][0], points[i][1]);
    }
    shape.closePath();
    return shape;
  }

  private arePointsEqual(p1: [number, number], p2: [number, number]): boolean {
    return Math.abs(p1[0] - p2[0]) < 1e-6 && Math.abs(p1[1] - p2[1]) < 1e-6;
  }
}
