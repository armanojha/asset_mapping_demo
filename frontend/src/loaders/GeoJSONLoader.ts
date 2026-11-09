/**
 * Universal GeoJSON Loader for the Village Asset Mapping System.
 * Loads and validates GeoJSON files, FeatureCollections, and individual geometries.
 * Normalizes features into LoadedGeospatialFeature models while preserving all administrative metadata.
 */

import {
  GeoJSONFeature,
  GeoJSONGeometry,
  GeoJSONGeometryType,
  LoadedGeospatialFeature,
  Position2D,
  RawGeoJSONInput,
} from '../types/geospatial';

export interface LoaderValidationReport {
  totalInputFeatures: number;
  validFeaturesCount: number;
  unsupportedFeaturesCount: number;
  unsupportedGeometryTypes: string[];
  warnings: string[];
  errors: string[];
}

export interface LoadedGeoJSONResult {
  datasetName: string;
  features: LoadedGeospatialFeature[];
  report: LoaderValidationReport;
  bbox?: [number, number, number, number];
}

export class GeoJSONLoaderError extends Error {
  constructor(message: string) {
    super(`[GeoJSONLoader] ${message}`);
    this.name = 'GeoJSONLoaderError';
  }
}

export class GeoJSONLoader {
  private static readonly SUPPORTED_GEOMETRIES: ReadonlySet<GeoJSONGeometryType> = new Set([
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
  ]);

  /**
   * Loads and parses GeoJSON from a remote URL or static path.
   */
  public async loadFromUrl(url: string, datasetName?: string): Promise<LoadedGeoJSONResult> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new GeoJSONLoaderError(`HTTP ${response.status} ${response.statusText} when fetching ${url}`);
      }
      const rawJson = await response.json();
      const derivedName = datasetName || url.split('/').pop()?.replace(/\.geojson$/i, '') || 'unnamed_dataset';
      return this.parse(rawJson, derivedName);
    } catch (err: any) {
      if (err instanceof GeoJSONLoaderError) {
        throw err;
      }
      throw new GeoJSONLoaderError(`Failed to load GeoJSON from ${url}: ${err?.message || err}`);
    }
  }

  /**
   * Parses raw GeoJSON input (object or JSON string).
   */
  public parse(input: RawGeoJSONInput, datasetName: string = 'dataset'): LoadedGeoJSONResult {
    let json: any = input;

    if (typeof input === 'string') {
      try {
        json = JSON.parse(input);
      } catch (err: any) {
        throw new GeoJSONLoaderError(`Invalid JSON string: ${err.message}`);
      }
    }

    if (!json || typeof json !== 'object') {
      throw new GeoJSONLoaderError('Input must be a valid GeoJSON object');
    }

    const report: LoaderValidationReport = {
      totalInputFeatures: 0,
      validFeaturesCount: 0,
      unsupportedFeaturesCount: 0,
      unsupportedGeometryTypes: [],
      warnings: [],
      errors: [],
    };

    let rawFeatures: GeoJSONFeature[] = [];

    if (json.type === 'FeatureCollection') {
      if (!Array.isArray(json.features)) {
        throw new GeoJSONLoaderError("GeoJSON 'FeatureCollection' must contain a 'features' array");
      }
      rawFeatures = json.features;
    } else if (json.type === 'Feature') {
      rawFeatures = [json as GeoJSONFeature];
    } else if (this.isGeometry(json)) {
      rawFeatures = [
        {
          type: 'Feature',
          geometry: json as GeoJSONGeometry,
          properties: {},
        },
      ];
    } else {
      throw new GeoJSONLoaderError(
        `Unsupported root GeoJSON type '${json.type}'. Expected 'FeatureCollection', 'Feature', or Geometry.`
      );
    }

    report.totalInputFeatures = rawFeatures.length;
    const loadedFeatures: LoadedGeospatialFeature[] = [];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < rawFeatures.length; i++) {
      const feat = rawFeatures[i];

      if (!feat || typeof feat !== 'object' || feat.type !== 'Feature') {
        report.warnings.push(`Record index ${i}: Invalid feature structure, skipped.`);
        continue;
      }

      if (!feat.geometry) {
        report.warnings.push(`Record index ${i}: Feature has null or missing geometry, skipped.`);
        continue;
      }

      const geomType = feat.geometry.type;

      if (!GeoJSONLoader.SUPPORTED_GEOMETRIES.has(geomType as GeoJSONGeometryType)) {
        report.unsupportedFeaturesCount++;
        if (!report.unsupportedGeometryTypes.includes(geomType)) {
          report.unsupportedGeometryTypes.push(geomType);
        }
        report.warnings.push(`Record index ${i}: Unsupported geometry type '${geomType}', skipped.`);
        continue;
      }

      if (!('coordinates' in feat.geometry)) {
        report.warnings.push(`Record index ${i}: Geometry lacks coordinate array, skipped.`);
        continue;
      }

      const coords = feat.geometry.coordinates;
      if (!coords || !Array.isArray(coords) || coords.length === 0) {
        report.warnings.push(`Record index ${i}: Geometry has empty coordinate array, skipped.`);
        continue;
      }

      try {
        const normalized = this.normalizeFeature(feat, datasetName, i);
        loadedFeatures.push(normalized);
        report.validFeaturesCount++;

        // Update global bounding box
        if (normalized.originalBBox) {
          const [bMinX, bMinY, bMaxX, bMaxY] = normalized.originalBBox;
          if (bMinX < minX) minX = bMinX;
          if (bMinY < minY) minY = bMinY;
          if (bMaxX > maxX) maxX = bMaxX;
          if (bMaxY > maxY) maxY = bMaxY;
        }
      } catch (err: any) {
        report.errors.push(`Record index ${i} (${feat.id || 'no-id'}): Normalization failed: ${err.message}`);
      }
    }

    const overallBBox: [number, number, number, number] | undefined =
      loadedFeatures.length > 0 && isFinite(minX) ? [minX, minY, maxX, maxY] : undefined;

    return {
      datasetName,
      features: loadedFeatures,
      report,
      bbox: overallBBox,
    };
  }

  /**
   * Normalizes a raw GeoJSON feature into a LoadedGeospatialFeature.
   */
  private normalizeFeature(
    feat: GeoJSONFeature,
    datasetName: string,
    index: number
  ): LoadedGeospatialFeature {
    const props = feat.properties || {};

    // Feature and Source Identifiers
    const featureId =
      props.feature_id ||
      props.featureId ||
      props.id ||
      (feat.id !== undefined ? String(feat.id) : `feat_${datasetName}_${index}`);

    const sourceId =
      props.source_id ||
      props.sourceId ||
      props.objectid ||
      props.OBJECTID ||
      props.uniq_id ||
      featureId;

    const sourceName = props.source_name || props.sourceName || 'grammanchitra';
    const sourceLayer = props.source_layer || props.sourceLayer || datasetName;

    // Classification Categories
    const category = props.category || this.inferCategoryFromLayer(datasetName);
    const subcategory = props.subcategory || 'unclassified';

    // Vertical staging and procedural parameters
    const verticalTier = typeof props._vertical_tier === 'number' ? props._vertical_tier : 0;
    const plinthElevationM =
      typeof props._plinth_elevation_m === 'number'
        ? props._plinth_elevation_m
        : typeof props.plinth_elevation_m === 'number'
        ? props.plinth_elevation_m
        : 0.0;
    const heightMeters =
      typeof props._procedural_height_m === 'number'
        ? props._procedural_height_m
        : typeof props.height === 'number'
        ? props.height
        : category === 'BUILDINGS'
        ? 4.5
        : 0.0;

    const roofType = props._procedural_roof_type || (category === 'BUILDINGS' ? 'flat_terrace' : 'none');
    const stories = typeof props._procedural_stories === 'number' ? props._procedural_stories : 1;
    const hasRoadOverlap = Boolean(props._has_road_overlap);
    const roadOverlapAreaSqm =
      typeof props._road_overlap_area_sqm === 'number' ? props._road_overlap_area_sqm : 0.0;

    const batchLayer = props._batch_layer || this.inferBatchLayer(category);
    const rawAttributes = props.raw_attributes || { ...props };

    // Compute bounding box and centroid
    const originalBBox = this.computeGeometryBBox(feat.geometry);
    const centroid = originalBBox
      ? ([(originalBBox[0] + originalBBox[2]) / 2, (originalBBox[1] + originalBBox[3]) / 2] as Position2D)
      : undefined;

    return {
      featureId,
      sourceId: String(sourceId),
      sourceName,
      sourceLayer,
      category,
      subcategory,
      geometryType: feat.geometry.type as GeoJSONGeometryType,
      geometry: feat.geometry,
      properties: props,
      rawAttributes,
      verticalTier,
      plinthElevationM,
      heightMeters,
      roofType,
      stories,
      hasRoadOverlap,
      roadOverlapAreaSqm,
      batchLayer,
      originalBBox,
      centroid,
    };
  }

  private isGeometry(obj: any): boolean {
    return (
      obj &&
      typeof obj === 'object' &&
      typeof obj.type === 'string' &&
      Array.isArray(obj.coordinates) &&
      GeoJSONLoader.SUPPORTED_GEOMETRIES.has(obj.type)
    );
  }

  private inferCategoryFromLayer(layerName: string): string {
    const l = layerName.toLowerCase();
    if (l.includes('build')) return 'BUILDINGS';
    if (l.includes('road')) return 'ROADS';
    if (l.includes('parcel')) return 'LAND_PARCELS';
    if (l.includes('water')) return 'WATER_BODIES';
    if (l.includes('bound')) return 'ADMINISTRATIVE_BOUNDARIES';
    if (l.includes('asset') || l.includes('comm')) return 'COMMUNITY_ASSETS';
    return 'OTHER';
  }

  private inferBatchLayer(category: string): string {
    switch (category) {
      case 'BUILDINGS':
        return 'building_extrusion_batch';
      case 'ROADS':
        return 'road_batch';
      case 'LAND_PARCELS':
      case 'ADMINISTRATIVE_BOUNDARIES':
      default:
        return 'ground_batch';
    }
  }

  /**
   * Computes the bounding box [minX, minY, maxX, maxY] for any GeoJSON geometry.
   */
  public computeGeometryBBox(geometry: GeoJSONGeometry): [number, number, number, number] | undefined {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const processCoord = (c: any) => {
      if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') {
        const x = c[0];
        const y = c[1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    };

    const traverse = (arr: any) => {
      if (!Array.isArray(arr)) return;
      if (arr.length >= 2 && typeof arr[0] === 'number' && typeof arr[1] === 'number') {
        processCoord(arr);
      } else {
        for (const item of arr) {
          traverse(item);
        }
      }
    };

    if (geometry.type === 'GeometryCollection') {
      for (const g of geometry.geometries) {
        const b = this.computeGeometryBBox(g);
        if (b) {
          if (b[0] < minX) minX = b[0];
          if (b[1] < minY) minY = b[1];
          if (b[2] > maxX) maxX = b[2];
          if (b[3] > maxY) maxY = b[3];
        }
      }
    } else {
      traverse(geometry.coordinates);
    }

    return isFinite(minX) ? [minX, minY, maxX, maxY] : undefined;
  }
}
