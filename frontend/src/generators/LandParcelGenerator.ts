/**
 * Procedural Land Parcel Geometry Generator for the Village Asset Mapping System.
 * Converts cadastral land parcel polygons and multipolygons into visible 3D terrain slabs
 * with distinct cadastral boundary demarcation stroke lines.
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

export interface LandParcelGeneratorOptions {
  surfaceElevationMeters?: number; // Default: -0.01m (Tier 0)
  enableBorderOutlines?: boolean;  // Default: true
  borderElevationOffsetMeters?: number; // Default: 0.005m above surface to avoid Z-fighting
}

export interface GeneratedParcelObject {
  group: THREE.Group;
  surfaceMesh: THREE.Mesh;
  borderLines?: THREE.LineSegments;
  metadata: Parcel3DMetadata;
}

export interface Parcel3DMetadata {
  featureId: string;
  sourceId: string;
  sourceName: string;
  sourceLayer: string;
  category: string;
  subcategory: string;
  propertyId?: string;
  areaSqm?: number;
  verticalTier: number;
  plinthElevationM: number;
  rawAttributes: Record<string, any>;
}

export class LandParcelGeneratorError extends Error {
  constructor(message: string) {
    super(`[LandParcelGenerator] ${message}`);
    this.name = 'LandParcelGeneratorError';
  }
}

export class LandParcelGenerator {
  private readonly options: Required<LandParcelGeneratorOptions>;
  private readonly materialSystem: BuildingMaterialSystem;

  constructor(options: LandParcelGeneratorOptions = {}, materialSystem?: BuildingMaterialSystem) {
    this.options = {
      surfaceElevationMeters: options.surfaceElevationMeters ?? -0.01,
      enableBorderOutlines: options.enableBorderOutlines ?? true,
      borderElevationOffsetMeters: options.borderElevationOffsetMeters ?? 0.005,
    };
    this.materialSystem = materialSystem || BuildingMaterialSystem.getInstance();
  }

  /**
   * Generates a 3D parcel group containing surface mesh and perimeter demarcation lines.
   */
  public generateParcel(
    feature: LoadedGeospatialFeature,
    converter: CoordinateConverter
  ): GeneratedParcelObject {
    if (feature.geometryType !== 'Polygon' && feature.geometryType !== 'MultiPolygon') {
      throw new LandParcelGeneratorError(
        `Feature '${feature.featureId}' has unsupported geometry type '${feature.geometryType}' for land parcels.`
      );
    }

    const parcelGroup = new THREE.Group();
    parcelGroup.name = `Parcel_${feature.featureId}`;

    const surfY =
      typeof feature.plinthElevationM === 'number'
        ? feature.plinthElevationM
        : this.options.surfaceElevationMeters;

    const borderY = surfY + this.options.borderElevationOffsetMeters;

    const polyParts: Coordinate[][][] =
      feature.geometryType === 'Polygon'
        ? [(feature.geometry as GeoJSONPolygon).coordinates]
        : (feature.geometry as GeoJSONMultiPolygon).coordinates;

    const surfaceMeshes: THREE.Mesh[] = [];
    const borderLinesList: THREE.LineSegments[] = [];

    for (let partIdx = 0; partIdx < polyParts.length; partIdx++) {
      const rings = polyParts[partIdx];
      if (!rings || rings.length === 0 || rings[0].length < 3) continue;

      const exterior2D = this.coordsToLocal2D(rings[0], converter);
      const holes2D = rings.slice(1).map((h) => this.coordsToLocal2D(h, converter));

      // 1. Planar Surface Mesh
      const shape = this.createShapeWithHoles(exterior2D, holes2D);
      const geom = new THREE.ShapeGeometry(shape);
      geom.rotateX(-Math.PI / 2);
      geom.translate(0, surfY, 0);
      geom.computeVertexNormals();

      const mesh = new THREE.Mesh(geom, this.materialSystem.parcelMaterial);
      mesh.name = `ParcelSurface_${feature.featureId}_part${partIdx}`;
      mesh.receiveShadow = true;
      parcelGroup.add(mesh);
      surfaceMeshes.push(mesh);

      // 2. Cadastral Boundary Stroke Lines (LineSegments)
      if (this.options.enableBorderOutlines) {
        const borderGeom = this.createBoundaryLineSegments(exterior2D, holes2D, borderY);
        if (borderGeom) {
          const lineSegments = new THREE.LineSegments(borderGeom, this.materialSystem.parcelBorderMaterial);
          lineSegments.name = `ParcelBorder_${feature.featureId}_part${partIdx}`;
          parcelGroup.add(lineSegments);
          borderLinesList.push(lineSegments);
        }
      }
    }

    const primaryMesh = surfaceMeshes[0] || parcelGroup;
    const metadata: Parcel3DMetadata = {
      featureId: feature.featureId,
      sourceId: feature.sourceId,
      sourceName: feature.sourceName,
      sourceLayer: feature.sourceLayer,
      category: feature.category,
      subcategory: feature.subcategory,
      propertyId: feature.properties.property_id || feature.properties.plot_no,
      areaSqm:
        typeof feature.properties['st_area(shape)'] === 'number'
          ? feature.properties['st_area(shape)']
          : undefined,
      verticalTier: feature.verticalTier,
      plinthElevationM: surfY,
      rawAttributes: feature.rawAttributes,
    };

    parcelGroup.userData = metadata;
    primaryMesh.userData = metadata;

    return {
      group: parcelGroup,
      surfaceMesh: primaryMesh,
      borderLines: borderLinesList[0],
      metadata,
    };
  }

  private createBoundaryLineSegments(
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
