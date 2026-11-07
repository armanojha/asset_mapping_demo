/**
 * Geospatial and GeoJSON TypeScript type definitions for the Village Asset Mapping System.
 */

export type Position2D = [number, number]; // [lon, lat] or [x, y]
export type Position3D = [number, number, number]; // [lon, lat, elev] or [x, y, z]
export type Coordinate = Position2D | Position3D;

export type GeoJSONGeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'
  | 'GeometryCollection';

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: Coordinate;
}

export interface GeoJSONMultiPoint {
  type: 'MultiPoint';
  coordinates: Coordinate[];
}

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: Coordinate[];
}

export interface GeoJSONMultiLineString {
  type: 'MultiLineString';
  coordinates: Coordinate[][];
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: Coordinate[][]; // [exteriorRing, ...interiorHoles]
}

export interface GeoJSONMultiPolygon {
  type: 'MultiPolygon';
  coordinates: Coordinate[][][];
}

export interface GeoJSONGeometryCollection {
  type: 'GeometryCollection';
  geometries: GeoJSONGeometry[];
}

export type GeoJSONGeometry =
  | GeoJSONPoint
  | GeoJSONMultiPoint
  | GeoJSONLineString
  | GeoJSONMultiLineString
  | GeoJSONPolygon
  | GeoJSONMultiPolygon
  | GeoJSONGeometryCollection;

export interface GeoJSONFeature<G extends GeoJSONGeometry = GeoJSONGeometry, P = Record<string, any>> {
  type: 'Feature';
  id?: string | number;
  geometry: G;
  properties: P;
  bbox?: number[];
}

export interface GeoJSONFeatureCollection<G extends GeoJSONGeometry = GeoJSONGeometry, P = Record<string, any>> {
  type: 'FeatureCollection';
  name?: string;
  crs?: {
    type: string;
    properties: {
      name: string;
    };
  };
  features: GeoJSONFeature<G, P>[];
  bbox?: number[];
}

export type RawGeoJSONInput =
  | GeoJSONFeatureCollection
  | GeoJSONFeature
  | GeoJSONGeometry
  | string;

/**
 * Normalized loaded feature carrying original attributes, classification, and 3D staging parameters.
 */
export interface LoadedGeospatialFeature {
  featureId: string;
  sourceId: string;
  sourceName: string;
  sourceLayer: string;
  category: string;
  subcategory: string;
  geometryType: GeoJSONGeometryType;
  geometry: GeoJSONGeometry;
  properties: Record<string, any>;
  rawAttributes: Record<string, any>;

  // 3D vertical staging and procedural synthesis parameters
  verticalTier: number;
  plinthElevationM: number;
  heightMeters: number;
  roofType: string;
  stories: number;
  hasRoadOverlap: boolean;
  roadOverlapAreaSqm: number;
  batchLayer: string;

  // Spatial metadata
  originalBBox?: [number, number, number, number];
  centroid?: Position2D;
}

/**
 * Village Anchor Origin definition for Three.js coordinate centering.
 */
export interface VillageAnchorOrigin {
  villageName: string;
  projectedCrs: string; // e.g. "EPSG:32644"
  originXUtm: number;   // Projected Easting in meters
  originYUtm: number;   // Projected Northing in meters
  originLonWgs84: number; // Geodetic Longitude
  originLatWgs84: number; // Geodetic Latitude
  boundsLocalM: [number, number, number, number]; // [minX, minY, maxX, maxY] relative to anchor
}
