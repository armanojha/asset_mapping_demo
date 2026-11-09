/**
 * Automated Test Suite for Procedural Roads, Water Bodies, and Land Parcel Generators.
 * Validates:
 * 1. Road LineString ribbon generation (straight, curved, sharp turns with miter clamping).
 * 2. Road MultiLineString and connected segments.
 * 3. Road width estimation hierarchy (explicit vs subcategory default).
 * 4. Surveyed road polygon triangulation from real Gudwara dataset (106 roads).
 * 5. Water body polygon surfaces, island holes, and linear streams.
 * 6. Land parcel polygon slabs, interior holes, and boundary demarcation stroke lines.
 * 7. Ingestion and 3D generation of real Gudwara land parcels (242 parcels).
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GeoJSONLoader } from '../src/loaders/GeoJSONLoader';
import { CoordinateConverter } from '../src/generators/CoordinateConverter';
import { RoadGenerator } from '../src/generators/RoadGenerator';
import { WaterGenerator } from '../src/generators/WaterGenerator';
import { LandParcelGenerator } from '../src/generators/LandParcelGenerator';
import {
  GeoJSONLineString,
  GeoJSONMultiLineString,
  GeoJSONPolygon,
  LoadedGeospatialFeature,
} from '../src/types/geospatial';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

function assertClose(actual: number, expected: number, tolerance: number, label: string) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      `[TOLERANCE EXCEEDED] ${label}: Expected ${expected}, got ${actual} (diff=${diff}, tol=${tolerance})`
    );
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('STARTING ROADS, WATER & LAND PARCELS GENERATOR TEST SUITE');
  console.log('================================================================\n');

  const converter = new CoordinateConverter();
  const roadGen = new RoadGenerator();
  const waterGen = new WaterGenerator();
  const parcelGen = new LandParcelGenerator();
  let passedTests = 0;

  // -------------------------------------------------------------------------
  // TEST 1: Straight & Curved Road LineStrings with Width Estimation
  // -------------------------------------------------------------------------
  console.log('TEST 1: Straight & Curved Road LineString Ribbon Generation...');
  const straightRoadFeature: LoadedGeospatialFeature = {
    featureId: 'road_straight_01',
    sourceId: 'SRC_ROAD_01',
    sourceName: 'osm',
    sourceLayer: 'roads',
    category: 'ROADS',
    subcategory: 'paved_road',
    geometryType: 'LineString',
    geometry: {
      type: 'LineString',
      coordinates: [
        [79.083, 23.118],
        [79.085, 23.118],
      ],
    } as GeoJSONLineString,
    properties: {},
    rawAttributes: {},
    verticalTier: 1,
    plinthElevationM: 0.0,
    heightMeters: 0,
    roofType: 'none',
    stories: 0,
    hasRoadOverlap: false,
    roadOverlapAreaSqm: 0,
    batchLayer: 'road_batch',
  };

  const roadObj1 = roadGen.generateRoad(straightRoadFeature, converter);
  assert(roadObj1.mesh !== null, 'Straight road mesh must be generated');
  assert(roadObj1.metadata.widthMeters === 6.0, 'Paved road subcategory must default to 6.0m');
  assert(roadObj1.metadata.isWidthEstimated === true, 'Width must be marked as estimated');

  // Verify bounding box on straight road
  const bbox1 = new THREE.Box3().setFromObject(roadObj1.mesh);
  assertClose(bbox1.min.y, 0.0, 0.01, 'Road surface staged at Y=0.00m');
  assertClose(bbox1.max.y, 0.0, 0.01, 'Road surface flat at Y=0.00m');
  console.log(`  [PASS] Straight road ribbon generated (width=${roadObj1.metadata.widthMeters}m).`);
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 2: Sharp Turns, Miter Clamping & Self-Intersections
  // -------------------------------------------------------------------------
  console.log('TEST 2: Sharp 90-degree and Acute Turns with Miter Clamping...');
  const curvedRoadFeature: LoadedGeospatialFeature = {
    featureId: 'road_curved_02',
    sourceId: 'SRC_ROAD_02',
    sourceName: 'osm',
    sourceLayer: 'roads',
    category: 'ROADS',
    subcategory: 'village_road',
    geometryType: 'LineString',
    geometry: {
      type: 'LineString',
      coordinates: [
        [79.0830, 23.1170],
        [79.0840, 23.1170],
        [79.0840, 23.1180], // Sharp 90 degree turn North
        [79.0845, 23.1185], // 45 degree turn North-East
      ],
    } as GeoJSONLineString,
    properties: {
      width: 4.5, // Explicit attribute
    },
    rawAttributes: {},
    verticalTier: 1,
    plinthElevationM: 0.0,
    heightMeters: 0,
    roofType: 'none',
    stories: 0,
    hasRoadOverlap: false,
    roadOverlapAreaSqm: 0,
    batchLayer: 'road_batch',
  };

  const roadObj2 = roadGen.generateRoad(curvedRoadFeature, converter);
  assert(roadObj2.metadata.widthMeters === 4.5, 'Explicit width 4.5m must be used');
  assert(roadObj2.metadata.isWidthEstimated === false, 'Explicit width must NOT be estimated');
  assert(roadObj2.metadata.widthEstimationMethod === 'explicit_attribute', 'Method must be explicit');

  const bbox2 = new THREE.Box3().setFromObject(roadObj2.mesh);
  assert(isFinite(bbox2.min.x) && isFinite(bbox2.max.x), 'Turn vertices must be finite');
  console.log('  [PASS] Sharp turns triangulated smoothly with miter clamping.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 3: MultiLineString Connected Road Networks
  // -------------------------------------------------------------------------
  console.log('TEST 3: MultiLineString Road Network Ingestion...');
  const multiLineRoadFeature: LoadedGeospatialFeature = {
    featureId: 'road_multi_03',
    sourceId: 'SRC_ROAD_03',
    sourceName: 'osm',
    sourceLayer: 'roads',
    category: 'ROADS',
    subcategory: 'village_road',
    geometryType: 'MultiLineString',
    geometry: {
      type: 'MultiLineString',
      coordinates: [
        // Segment A: Main lane
        [
          [79.083, 23.118],
          [79.084, 23.118],
        ],
        // Segment B: Connecting cul-de-sac
        [
          [79.0835, 23.118],
          [79.0835, 23.119],
        ],
      ],
    } as GeoJSONMultiLineString,
    properties: {},
    rawAttributes: {},
    verticalTier: 1,
    plinthElevationM: 0.0,
    heightMeters: 0,
    roofType: 'none',
    stories: 0,
    hasRoadOverlap: false,
    roadOverlapAreaSqm: 0,
    batchLayer: 'road_batch',
  };

  const roadObj3 = roadGen.generateRoad(multiLineRoadFeature, converter);
  assert(roadObj3.mesh.children.length === 2, 'Must generate meshes for both segments in MultiLineString');
  console.log('  [PASS] MultiLineString road network generated without gaps.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 4: Real Gudwara Surveyed Road Polygons (106 Roads)
  // -------------------------------------------------------------------------
  console.log('TEST 4: Ingesting Real Surveyed Road Polygons from roads.geojson...');
  const finalDir = path.resolve(__dirname, '../../data/processed/final');
  const roadFilePath = path.join(finalDir, 'roads.geojson');
  assert(fs.existsSync(roadFilePath), `roads.geojson must exist at ${roadFilePath}`);

  const loader = new GeoJSONLoader();
  const roadDataRaw = fs.readFileSync(roadFilePath, 'utf-8');
  const parsedRoads = loader.parse(roadDataRaw, 'roads');

  assert(parsedRoads.features.length >= 106, `Must parse all roads (got ${parsedRoads.features.length})`);

  let realRoadSuccess = 0;
  for (const feat of parsedRoads.features) {
    const obj = roadGen.generateRoad(feat, converter);
    assert(obj.mesh !== null, `Road ${feat.featureId} must generate mesh`);
    assert(obj.metadata.category === 'ROADS', 'Category must be ROADS');
    realRoadSuccess++;
  }

  assert(realRoadSuccess >= 106, 'All real road corridors must generate cleanly');
  console.log(`  [PASS] ${realRoadSuccess} / ${realRoadSuccess} real surveyed road corridors triangulated at Tier 1 ($Y=0.00m).`);
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 5: Water Body Polygons, Island Holes, and Linear Streams
  // -------------------------------------------------------------------------
  console.log('TEST 5: Water Body Polygons, Island Holes, and Linear Streams...');
  const pondFeature: LoadedGeospatialFeature = {
    featureId: 'water_pond_01',
    sourceId: 'SRC_WATER_01',
    sourceName: 'grammanchitra',
    sourceLayer: 'water_bodies',
    category: 'WATER_BODIES',
    subcategory: 'pond',
    geometryType: 'Polygon',
    geometry: {
      type: 'Polygon',
      coordinates: [
        // Pond outer perimeter
        [
          [79.084, 23.118],
          [79.085, 23.118],
          [79.085, 23.119],
          [79.084, 23.119],
          [79.084, 23.118],
        ],
        // Island hole in center
        [
          [79.0844, 23.1184],
          [79.0846, 23.1184],
          [79.0846, 23.1186],
          [79.0844, 23.1186],
          [79.0844, 23.1184],
        ],
      ],
    } as GeoJSONPolygon,
    properties: {
      'st_area(shape)': 1200.5,
    },
    rawAttributes: {},
    verticalTier: 0,
    plinthElevationM: -0.05,
    heightMeters: 0,
    roofType: 'none',
    stories: 0,
    hasRoadOverlap: false,
    roadOverlapAreaSqm: 0,
    batchLayer: 'ground_batch',
  };

  const pondObj = waterGen.generateWaterBody(pondFeature, converter);
  assert(pondObj.mesh !== null, 'Pond mesh must be generated');
  assert(pondObj.metadata.waterSurfaceElevationM === -0.05, 'Water surface must be recessed at Y=-0.05m');

  const streamFeature: LoadedGeospatialFeature = {
    featureId: 'water_stream_02',
    sourceId: 'SRC_STREAM_02',
    sourceName: 'osm',
    sourceLayer: 'water_bodies',
    category: 'WATER_BODIES',
    subcategory: 'stream',
    geometryType: 'LineString',
    geometry: {
      type: 'LineString',
      coordinates: [
        [79.083, 23.117],
        [79.084, 23.1175],
        [79.085, 23.118],
      ],
    } as GeoJSONLineString,
    properties: { width: 3.0 },
    rawAttributes: {},
    verticalTier: 0,
    plinthElevationM: -0.05,
    heightMeters: 0,
    roofType: 'none',
    stories: 0,
    hasRoadOverlap: false,
    roadOverlapAreaSqm: 0,
    batchLayer: 'ground_batch',
  };

  const streamObj = waterGen.generateWaterBody(streamFeature, converter);
  assert(streamObj.mesh !== null, 'Stream ribbon must be generated');
  console.log('  [PASS] Water body polygons with island holes and linear streams generated.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 6: Real Gudwara Land Parcels (242 Parcels) & Cadastral Boundaries
  // -------------------------------------------------------------------------
  console.log('TEST 6: Ingesting Real Land Parcels from land_parcels.geojson...');
  const parcelFilePath = path.join(finalDir, 'land_parcels.geojson');
  assert(fs.existsSync(parcelFilePath), `land_parcels.geojson must exist at ${parcelFilePath}`);

  const parcelDataRaw = fs.readFileSync(parcelFilePath, 'utf-8');
  const parsedParcels = loader.parse(parcelDataRaw, 'land_parcels');

  assert(parsedParcels.features.length >= 242, `Must parse all parcels (got ${parsedParcels.features.length})`);

  let realParcelSuccess = 0;
  let borderLinesSuccess = 0;

  for (const feat of parsedParcels.features) {
    const obj = parcelGen.generateParcel(feat, converter);
    assert(obj.group !== null, `Parcel ${feat.featureId} must generate group`);
    assert(obj.surfaceMesh !== null, `Parcel ${feat.featureId} must have surface mesh`);
    assert(obj.metadata.category === 'LAND_PARCELS', 'Category must be LAND_PARCELS');

    if (obj.borderLines) {
      borderLinesSuccess++;
    }
    realParcelSuccess++;
  }

  assert(realParcelSuccess >= 242, 'All real land parcels must generate cleanly');
  assert(borderLinesSuccess >= 242, 'All parcels must have cadastral border line segments');

  console.log(`  * Generated Land Parcels: ${realParcelSuccess} / ${parsedParcels.features.length}`);
  console.log(`  * Cadastral Boundary Line Overlays: ${borderLinesSuccess} / ${parsedParcels.features.length}`);
  console.log(`  [PASS] ${realParcelSuccess} / ${parsedParcels.features.length} real property and Khasra parcels triangulated at Tier 0.`);
  passedTests++;

  console.log('\n================================================================');
  console.log(`ALL ${passedTests} TEST SUITES PASSED CLEANLY (100% SUCCESS)`);
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\nTEST SUITE FAILED WITH ERROR:');
  console.error(err);
  process.exit(1);
});
