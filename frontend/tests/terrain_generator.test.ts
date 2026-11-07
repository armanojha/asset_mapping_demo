/**
 * Unit Test Suite for Procedural Terrain & Diorama Pedestal Generator.
 * Verifies DEM raster ingestion, honest flat cadastral fallback when DEM is missing,
 * monolithic diorama pedestal extrusion, and coordinate alignment.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { CoordinateConverter } from '../src/generators/CoordinateConverter.js';
import {
  DemGridData,
  TerrainGenerator,
  TerrainGeneratorError,
} from '../src/generators/TerrainGenerator.js';
import { LoadedGeospatialFeature } from '../src/types/geospatial.js';
import { GeoJSONLoader } from '../src/loaders/GeoJSONLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Procedural Terrain & Diorama Generator Test Suite', () => {
  const converter = new CoordinateConverter();
  const generator = new TerrainGenerator({
    verticalExaggeration: 1.2,
    pedestalDepthMeters: 6.0,
    surfaceElevationOffsetMeters: -0.05,
  });

  const sampleBoundaryFeat: LoadedGeospatialFeature = {
    featureId: 'boundary_test_01',
    sourceId: 'bnd_src_01',
    sourceName: 'grammanchitra',
    sourceLayer: 'boundary',
    category: 'ADMINISTRATIVE_BOUNDARIES',
    subcategory: 'village_boundary',
    geometryType: 'Polygon',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [77.060, 23.117],
          [77.065, 23.117],
          [77.065, 23.121],
          [77.060, 23.121],
          [77.060, 23.117],
        ],
      ],
    },
    properties: {},
    rawAttributes: { village_name: 'Test Village' },
    verticalTier: 0,
    plinthElevationM: -0.05,
    heightMeters: 0,
    roofType: 'none',
    stories: 0,
    hasRoadOverlap: false,
    roadOverlapAreaSqm: 0,
    batchLayer: 'terrain',
  };

  it('1. Generates flat cadastral surface and diorama pedestal fallback when DEM is missing (Task 4)', () => {
    const terrainObj = generator.generateTerrain(sampleBoundaryFeat, converter, null);

    assert.ok(terrainObj.group instanceof THREE.Group);
    assert.strictEqual(terrainObj.metadata.isDemAvailable, false);
    assert.strictEqual(terrainObj.metadata.elevationSource, 'flat_boundary_fallback');
    assert.strictEqual(terrainObj.metadata.pedestalDepthM, 6.0);
    assert.strictEqual(terrainObj.metadata.hasDioramaPedestal, true);
    assert.ok(terrainObj.metadata.areaSqm && terrainObj.metadata.areaSqm > 1000);

    // Verify children in group: surface mesh, pedestal mesh, and perimeter curb line
    assert.ok(terrainObj.surfaceMesh instanceof THREE.Mesh);
    assert.ok(terrainObj.pedestalMesh instanceof THREE.Mesh);
    assert.ok(terrainObj.boundaryCurb instanceof THREE.LineSegments);
  });

  it('2. Correctly samples heights from DEM raster when DEM data is supplied (Task 2)', () => {
    const mockDem: DemGridData = {
      width: 4,
      height: 4,
      minElevationM: 320.0,
      maxElevationM: 345.0,
      elevations: new Float32Array([
        320, 322, 325, 328,
        323, 326, 330, 335,
        328, 332, 338, 342,
        330, 335, 340, 345,
      ]),
      bboxWgs84: [77.059, 23.116, 77.066, 23.122],
    };

    const terrainObj = generator.generateTerrain(sampleBoundaryFeat, converter, mockDem);

    assert.strictEqual(terrainObj.metadata.isDemAvailable, true);
    assert.strictEqual(terrainObj.metadata.elevationSource, 'raster_dem');
    assert.strictEqual(terrainObj.metadata.minElevationM, 320.0);
    assert.strictEqual(terrainObj.metadata.maxElevationM, 345.0);
    assert.strictEqual(terrainObj.metadata.verticalExaggeration, 1.2);

    // Verify surface mesh geometry is PlaneGeometry with sampled elevations
    const geom = terrainObj.surfaceMesh.geometry;
    assert.ok(geom instanceof THREE.PlaneGeometry);
    const posAttr = geom.attributes.position;
    assert.ok(posAttr.count > 0);
  });

  it('3. Throws controlled error for unsupported geometry types', () => {
    const invalidFeat: LoadedGeospatialFeature = {
      ...sampleBoundaryFeat,
      geometryType: 'LineString',
      geometry: {
        type: 'LineString',
        coordinates: [
          [77.06, 23.11],
          [77.07, 23.12],
        ],
      },
    };

    assert.throws(() => {
      generator.generateTerrain(invalidFeat, converter);
    }, TerrainGeneratorError);
  });

  it('4. Ingests real Gudwara village boundary and builds valid 3D diorama pedestal', () => {
    const bndPath = path.resolve(__dirname, '../../data/processed/final/village_boundary.geojson');
    assert.ok(fs.existsSync(bndPath), `File not found: ${bndPath}`);

    const loader = new GeoJSONLoader();
    const bndRaw = fs.readFileSync(bndPath, 'utf-8');
    const result = loader.parse(bndRaw, 'Gudwara_Boundary');
    assert.strictEqual(result.features.length, 1);

    const gudwaraBnd = result.features[0];
    const terrainObj = generator.generateTerrain(gudwaraBnd, converter, null);

    assert.ok(terrainObj.group instanceof THREE.Group);
    assert.strictEqual(terrainObj.metadata.isDemAvailable, false); // Real Gudwara Abadi has no raster DEM
    assert.strictEqual(terrainObj.metadata.elevationSource, 'flat_boundary_fallback');
    assert.strictEqual(terrainObj.metadata.hasDioramaPedestal, true);
    assert.ok(terrainObj.metadata.areaSqm && terrainObj.metadata.areaSqm > 10000);

    // Verify diorama pedestal bounding box
    const box = new THREE.Box3().setFromObject(terrainObj.group);
    assert.ok(box.min.y <= -6.0, `Expected pedestal base Y <= -6.0, got ${box.min.y}`);
    assert.ok(box.max.y <= 0.15, `Expected surface Y <= 0.15, got ${box.max.y}`);
  });
});
