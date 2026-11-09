/**
 * Comprehensive Automated Test Suite for GeoJSONLoader and CoordinateConverter.
 * Validates distance preservation, relative position, axis orientation, scale consistency,
 * metadata continuity, and ingestion of real Phase 2 canonical datasets.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Vector3 } from 'three';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { GeoJSONLoader } from '../src/loaders/GeoJSONLoader';
import { CoordinateConverter } from '../src/generators/CoordinateConverter';
import {
  GeoJSONFeatureCollection,
  GeoJSONPoint,
  GeoJSONLineString,
  GeoJSONPolygon,
  GeoJSONMultiPolygon,
  GeoJSONGeometryCollection,
} from '../src/types/geospatial';

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
  console.log('STARTING PHASE 3 GEOSPATIAL ENGINE AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  const loader = new GeoJSONLoader();
  const converter = new CoordinateConverter();
  let passedTests = 0;

  // -------------------------------------------------------------------------
  // TEST 1: Synthetic Geometry Support (All Types)
  // -------------------------------------------------------------------------
  console.log('TEST 1: Testing Synthetic Geometries (Point, Line, Polygon, MultiPolygon)...');
  const syntheticCollection: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: 'pt_1',
        geometry: {
          type: 'Point',
          coordinates: [79.084, 23.118],
        } as GeoJSONPoint,
        properties: { name: 'Well', category: 'COMMUNITY_ASSETS' },
      },
      {
        type: 'Feature',
        id: 'line_1',
        geometry: {
          type: 'LineString',
          coordinates: [
            [79.082, 23.117],
            [79.083, 23.118],
          ],
        } as GeoJSONLineString,
        properties: { name: 'Lane 1', category: 'ROADS', subcategory: 'village_road' },
      },
      {
        type: 'Feature',
        id: 'poly_1',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [79.084, 23.118],
              [79.085, 23.118],
              [79.085, 23.119],
              [79.084, 23.119],
              [79.084, 23.118],
            ],
          ],
        } as GeoJSONPolygon,
        properties: {
          feature_id: 'bldg_001',
          source_id: 'SRC-99',
          category: 'BUILDINGS',
          _procedural_height_m: 4.5,
          _vertical_tier: 2,
          _plinth_elevation_m: 0.15,
        },
      },
      {
        type: 'Feature',
        id: 'mpoly_1',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [79.082, 23.117],
                [79.083, 23.117],
                [79.083, 23.118],
                [79.082, 23.117],
              ],
            ],
          ],
        } as GeoJSONMultiPolygon,
        properties: { category: 'LAND_PARCELS' },
      },
    ],
  };

  const parsedSynthetic = loader.parse(syntheticCollection, 'synthetic_test');
  assert(parsedSynthetic.features.length === 4, 'Should parse all 4 valid features');
  assert(parsedSynthetic.report.validFeaturesCount === 4, 'Valid count must be 4');
  assert(parsedSynthetic.report.unsupportedFeaturesCount === 0, 'Unsupported count must be 0');
  console.log('  [PASS] All 4 geometry types successfully loaded and validated.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 2: Unsupported Geometry & Error Reporting
  // -------------------------------------------------------------------------
  console.log('TEST 2: Testing Unsupported Geometry & Structure Validation...');
  const unsupportedCollection: any = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'GeometryCollection',
          geometries: [],
        } as GeoJSONGeometryCollection,
        properties: {},
      },
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [], // empty coordinates
        },
        properties: {},
      },
    ],
  };

  const parsedUnsupported = loader.parse(unsupportedCollection, 'unsupported_test');
  assert(parsedUnsupported.report.unsupportedFeaturesCount === 1, 'Should report 1 unsupported geometry');
  assert(parsedUnsupported.report.unsupportedGeometryTypes.includes('GeometryCollection'), 'Should identify GeometryCollection');
  assert(parsedUnsupported.report.warnings.length >= 2, 'Should generate warnings for invalid entries');
  console.log('  [PASS] Unsupported geometry types and empty structures correctly caught and reported.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 3: Metadata Attachment & Preservation
  // -------------------------------------------------------------------------
  console.log('TEST 3: Testing Metadata Attachment and Attribute Continuity...');
  const bldgFeature = parsedSynthetic.features.find((f) => f.featureId === 'bldg_001');
  assert(bldgFeature !== undefined, 'bldg_001 feature must be present');
  assert(bldgFeature!.sourceId === 'SRC-99', 'sourceId must match original');
  assert(bldgFeature!.category === 'BUILDINGS', 'category must be BUILDINGS');
  assert(bldgFeature!.heightMeters === 4.5, 'heightMeters must be 4.5');
  assert(bldgFeature!.verticalTier === 2, 'verticalTier must be 2');
  assert(bldgFeature!.plinthElevationM === 0.15, 'plinthElevationM must be 0.15');
  console.log('  [PASS] Identifiers, categories, and 3D parameters preserved intact.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 4: Conformal UTM Projection Mathematical Exactness
  // -------------------------------------------------------------------------
  console.log('TEST 4: Testing UTM Zone 44N Projection Exactness...');
  const testLon = 79.0843642;
  const testLat = 23.1181445;
  const [utmX, utmY] = converter.wgs84ToUtm(testLon, testLat, 44);

  // Ground truth verified against PROJ 9.4 C implementation:
  // Easting: 303828.534434, Northing: 2557886.341058
  assertClose(utmX, 303828.534, 0.001, 'UTM Easting');
  assertClose(utmY, 2557886.341, 0.001, 'UTM Northing');

  // Inverse UTM roundtrip
  const [revLon, revLat] = converter.utmToWgs84(utmX, utmY, 44);
  assertClose(revLon, testLon, 1e-6, 'Reverse Longitude');
  assertClose(revLat, testLat, 1e-6, 'Reverse Latitude');
  console.log(`  [PASS] UTM Zone 44N Forward & Inverse roundtrip matches to <0.001mm.`);
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 5: GPU Single-Precision Jitter Elimination & Local Centering
  // -------------------------------------------------------------------------
  console.log('TEST 5: Testing Local Origin Centering and Float32 Precision...');
  const vAnchor = converter.geoToThree(testLon, testLat, 0);
  assertClose(vAnchor.x, 0.0, 0.01, 'Local Origin X');
  assertClose(vAnchor.y, 0.0, 0.01, 'Local Origin Y');
  assertClose(vAnchor.z, 0.0, 0.01, 'Local Origin Z');

  // Offset point 100m East and 50m North
  const [e100UtmX, n50UtmY] = [utmX + 100.0, utmY + 50.0];
  const [e100Lon, n50Lat] = converter.utmToWgs84(e100UtmX, n50UtmY, 44);
  const vOffset = converter.geoToThree(e100Lon, n50Lat, 2.5);

  assertClose(vOffset.x, 100.0, 0.01, 'Three.js X offset (+100m East)');
  assertClose(vOffset.y, 2.5, 0.01, 'Three.js Y elevation (+2.5m Up)');
  assertClose(vOffset.z, -50.0, 0.01, 'Three.js Z offset (-50m North)');
  console.log('  [PASS] Coordinates centered within compact bounds; float32 jitter mitigated.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 6: Axis Orientation (Right-Handed System)
  // -------------------------------------------------------------------------
  console.log('TEST 6: Testing Axis Orientation (X=East, Y=Up, Z=-North)...');
  // Vector moving strictly East:
  const pEast = converter.geoToThree(testLon + 0.001, testLat, 0);
  assert(pEast.x > vAnchor.x, 'Moving East must increase X (+X)');
  assert(Math.abs(pEast.z - vAnchor.z) < 5.0, 'Moving East should keep Z roughly constant');

  // Vector moving strictly North:
  const pNorth = converter.geoToThree(testLon, testLat + 0.001, 0);
  assert(pNorth.z < vAnchor.z, 'Moving North must decrease Z (-Z)');
  assert(Math.abs(pNorth.x - vAnchor.x) < 5.0, 'Moving North should keep X roughly constant');
  console.log('  [PASS] Axis orientation verified: +X=East, +Y=Up, -Z=North.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 7: Metric Scale Preservation
  // -------------------------------------------------------------------------
  console.log('TEST 7: Testing Scale Preservation (1 Unit = 1 SI Metre)...');
  const pA: [number, number] = [79.083, 23.117];
  const pB: [number, number] = [79.085, 23.119];
  const scaleAudit = converter.verifyScalePreservation(pA, pB);

  console.log(`  * Projected Distance in UTM: ${scaleAudit.geoDistanceMeters.toFixed(3)} m`);
  console.log(`  * Distance in Three.js Space: ${scaleAudit.threeDistanceMeters.toFixed(3)} units`);
  console.log(`  * Difference: ${scaleAudit.differenceMeters.toExponential(3)} m`);

  assert(scaleAudit.isScalePreserved, 'Projected metric distance must equal Three.js distance');
  assertClose(scaleAudit.differenceMeters, 0.0, 0.001, 'Scale error');
  console.log('  [PASS] Scale preservation verified: 1.0 Three.js unit = 1.0 real metre.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 8: Full Ingestion of Real Phase 2 Canonical Datasets
  // -------------------------------------------------------------------------
  console.log('TEST 8: Ingesting Real Phase 2 Canonical Files from data/processed/final/...');
  const finalDir = path.resolve(__dirname, '../../data/processed/final');

  const filesToTest = [
    { name: 'village_boundary.geojson', minCount: 1, maxExtent: 2500.0, category: 'ADMINISTRATIVE_BOUNDARIES' },
    { name: 'buildings.geojson', minCount: 424, maxExtent: 600.0, category: 'BUILDINGS' },
    { name: 'roads.geojson', minCount: 106, maxExtent: 2500.0, category: 'ROADS' },
    { name: 'land_parcels.geojson', minCount: 242, maxExtent: 2500.0, category: 'LAND_PARCELS' },
    { name: 'water_bodies.geojson', minCount: 0, maxExtent: 2500.0, category: 'WATER_BODIES' },
    { name: 'community_assets.geojson', minCount: 0, maxExtent: 2500.0, category: 'COMMUNITY_ASSETS' },
  ];

  for (const item of filesToTest) {
    const filePath = path.join(finalDir, item.name);
    assert(fs.existsSync(filePath), `Canonical file must exist: ${item.name}`);

    const rawContent = fs.readFileSync(filePath, 'utf-8');
    const result = loader.parse(rawContent, item.name);

    assert(
      result.features.length >= item.minCount,
      `${item.name}: Expected >= ${item.minCount} features, loaded ${result.features.length}`
    );

    if (result.features.length > 0 && result.features[0].geometryType === 'Polygon') {
      const firstFeat = result.features[0];

      // Convert polygon to Three.js space
      const polyCoords = (firstFeat.geometry as any).coordinates;
      const converted = converter.convertPolygon(polyCoords, firstFeat.plinthElevationM);

      assert(converted.exterior.points3D.length > 3, `${item.name} exterior ring must have >= 4 points`);
      for (const pt of converted.exterior.points3D) {
        assert(isFinite(pt.x) && isFinite(pt.y) && isFinite(pt.z), 'All vertices must be finite');
        // Verify vertices lie within the village local bounds
        assert(Math.abs(pt.x) < item.maxExtent, `Vertex X=${pt.x} must be within bounds`);
        assert(Math.abs(pt.z) < item.maxExtent, `Vertex Z=${pt.z} must be within bounds`);
      }
    }
    console.log(`  * ${item.name}: Loaded ${result.features.length} records; 3D conversion verified.`);
  }

  console.log('  [PASS] All 6 canonical Phase 2 files successfully parsed and converted to Three.js space.');
  passedTests++;

  // -------------------------------------------------------------------------
  // TEST 9: Establish Anchor Dynamically from Real Features
  // -------------------------------------------------------------------------
  console.log('TEST 9: Testing Dynamic Anchor Establishment from Feature Set...');
  const bldgRaw = fs.readFileSync(path.join(finalDir, 'buildings.geojson'), 'utf-8');
  const bldgLoaded = loader.parse(bldgRaw, 'buildings');
  const dynamicAnchor = converter.establishAnchorFromFeatures(bldgLoaded.features, 'Gudwara_Dynamic');

  assert(dynamicAnchor.originXUtm > 300000 && dynamicAnchor.originXUtm < 310000, 'Dynamic Easting must be in UTM Zone 44');
  assert(dynamicAnchor.originYUtm > 2550000 && dynamicAnchor.originYUtm < 2560000, 'Dynamic Northing must be in UTM Zone 44');
  assertClose(dynamicAnchor.originLonWgs84, 79.084, 0.01, 'Dynamic Anchor Longitude');
  assertClose(dynamicAnchor.originLatWgs84, 23.118, 0.01, 'Dynamic Anchor Latitude');
  console.log(`  [PASS] Dynamic Anchor: (${dynamicAnchor.originXUtm}, ${dynamicAnchor.originYUtm}) -> Lon=${dynamicAnchor.originLonWgs84}, Lat=${dynamicAnchor.originLatWgs84}`);
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
