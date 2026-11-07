/**
 * Unit Test Suite for Procedural Vegetation Generator.
 * Verifies instanced tree rendering, generalized polygon coverage,
 * strict rejection of synthetic tree generation, and missing dataset reporting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as THREE from 'three';
import { CoordinateConverter } from '../src/generators/CoordinateConverter.js';
import {
  VegetationGenerator,
  VegetationGeneratorError,
} from '../src/generators/VegetationGenerator.js';
import { LoadedGeospatialFeature } from '../src/types/geospatial.js';

describe('Procedural Vegetation Generator Test Suite', () => {
  const converter = new CoordinateConverter();
  const generator = new VegetationGenerator();

  it('1. Reports missing dataset gracefully when features array is empty (Task 5 Fallback)', () => {
    const result = generator.generateVegetationLayer([], converter);

    assert.strictEqual(result.isVegetationAvailable, false);
    assert.strictEqual(result.totalFeatures, 0);
    assert.strictEqual(result.individualTreesCount, 0);
    assert.strictEqual(result.generalizedPolygonsCount, 0);
    assert.match(result.statusMessage, /No verified vegetation dataset/i);
    assert.strictEqual(result.group.children.length, 0);
  });

  it('2. Correctly renders a single surveyed Point tree with accurate metadata', () => {
    const pointFeat: LoadedGeospatialFeature = {
      featureId: 'tree_pt_001',
      sourceId: 'src_svamitva_tree_1',
      sourceName: 'svamitva',
      sourceLayer: 'trees',
      category: 'VEGETATION',
      subcategory: 'tree',
      geometryType: 'Point',
      geometry: {
        type: 'Point',
        coordinates: [77.0620, 23.1190],
      },
      properties: {},
      rawAttributes: {
        tree_height: 6.5,
        species: 'Azadirachta indica (Neem)',
      },
      verticalTier: 1,
      plinthElevationM: 0,
      heightMeters: 6.5,
      roofType: 'none',
      stories: 0,
      hasRoadOverlap: false,
      roadOverlapAreaSqm: 0,
      batchLayer: 'vegetation',
    };

    const treeObj = generator.generateVegetationFeature(pointFeat, converter);

    assert.ok(treeObj.group instanceof THREE.Group);
    assert.strictEqual(treeObj.metadata.featureId, 'tree_pt_001');
    assert.strictEqual(treeObj.metadata.representationType, 'individual_tree_point');
    assert.strictEqual(treeObj.metadata.isExactTreeInventory, true);
    assert.strictEqual(treeObj.metadata.treeCount, 1);
    assert.strictEqual(treeObj.metadata.heightMeters, 6.5);
    assert.strictEqual(treeObj.metadata.isHeightEstimated, false);
    assert.strictEqual(treeObj.meshCount, 2); // trunk + canopy
  });

  it('3. Uses InstancedMesh for batches of tree points to minimize draw calls (Task 3 Performance)', () => {
    const multiPointFeat: LoadedGeospatialFeature = {
      featureId: 'cluster_001',
      sourceId: 'src_trees_cluster',
      sourceName: 'grammanchitra',
      sourceLayer: 'plantation',
      category: 'VEGETATION',
      subcategory: 'tree_cluster',
      geometryType: 'MultiPoint',
      geometry: {
        type: 'MultiPoint',
        coordinates: [
          [77.0615, 23.1185],
          [77.0618, 23.1187],
          [77.0622, 23.1189],
          [77.0625, 23.1192],
        ],
      },
      properties: {},
      rawAttributes: {},
      verticalTier: 1,
      plinthElevationM: 0,
      heightMeters: 4.5,
      roofType: 'none',
      stories: 0,
      hasRoadOverlap: false,
      roadOverlapAreaSqm: 0,
      batchLayer: 'vegetation',
    };

    const clusterObj = generator.generateVegetationFeature(multiPointFeat, converter);

    assert.strictEqual(clusterObj.metadata.representationType, 'vegetation_cluster');
    assert.strictEqual(clusterObj.metadata.treeCount, 4);
    assert.strictEqual(clusterObj.metadata.isHeightEstimated, true); // fallback default

    // Verify instanced mesh was created
    const instancedGroup = clusterObj.group.children[0] as THREE.Group;
    assert.ok(instancedGroup);
    assert.strictEqual(instancedGroup.children.length, 2); // trunk instanced mesh + canopy instanced mesh

    const trunkMesh = instancedGroup.children[0] as THREE.InstancedMesh;
    const canopyMesh = instancedGroup.children[1] as THREE.InstancedMesh;

    assert.strictEqual(trunkMesh.isInstancedMesh, true);
    assert.strictEqual(canopyMesh.isInstancedMesh, true);
    assert.strictEqual(trunkMesh.count, 4);
    assert.strictEqual(canopyMesh.count, 4);
  });

  it('4. Distinguishes generalized vegetation coverage polygons without inventing fake tree inventory (Task 4 Accuracy)', () => {
    const forestPolyFeat: LoadedGeospatialFeature = {
      featureId: 'forest_zone_01',
      sourceId: 'src_forest_01',
      sourceName: 'grammanchitra',
      sourceLayer: 'forest',
      category: 'VEGETATION',
      subcategory: 'forest_reserve',
      geometryType: 'Polygon',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.0610, 23.1180],
            [77.0630, 23.1180],
            [77.0630, 23.1200],
            [77.0610, 23.1200],
            [77.0610, 23.1180],
          ],
        ],
      },
      properties: {},
      rawAttributes: {
        classification: 'Reserved Forest',
      },
      verticalTier: 1,
      plinthElevationM: 0,
      heightMeters: 0,
      roofType: 'none',
      stories: 0,
      hasRoadOverlap: false,
      roadOverlapAreaSqm: 0,
      batchLayer: 'vegetation',
    };

    const polyObj = generator.generateVegetationFeature(forestPolyFeat, converter);

    assert.strictEqual(polyObj.metadata.representationType, 'generalized_vegetation_coverage');
    assert.strictEqual(polyObj.metadata.isExactTreeInventory, false);
    assert.strictEqual(polyObj.metadata.treeCount, 0); // Strictly zero fabricated trees
    assert.ok(polyObj.metadata.coverageAreaSqm && polyObj.metadata.coverageAreaSqm > 1000);

    // Group contains planar surface mesh and boundary stroke line segments
    assert.strictEqual(polyObj.group.children.length, 2);
    const surfaceMesh = polyObj.group.children[0] as THREE.Mesh;
    const borderLine = polyObj.group.children[1] as THREE.LineSegments;
    assert.strictEqual(surfaceMesh.isMesh, true);
    assert.strictEqual(borderLine.isLineSegments, true);
  });

  it('5. Throws controlled error for unsupported geometry types', () => {
    const invalidFeat: LoadedGeospatialFeature = {
      featureId: 'invalid_geom',
      sourceId: 'invalid',
      sourceName: 'invalid',
      sourceLayer: 'invalid',
      category: 'VEGETATION',
      subcategory: 'unknown',
      geometryType: 'LineString',
      geometry: {
        type: 'LineString',
        coordinates: [
          [77.061, 23.118],
          [77.062, 23.119],
        ],
      },
      properties: {},
      rawAttributes: {},
      verticalTier: 1,
      plinthElevationM: 0,
      heightMeters: 0,
      roofType: 'none',
      stories: 0,
      hasRoadOverlap: false,
      roadOverlapAreaSqm: 0,
      batchLayer: 'vegetation',
    };

    assert.throws(() => {
      generator.generateVegetationFeature(invalidFeat, converter);
    }, VegetationGeneratorError);
  });

  it('6. Mixed layer generation correctly processes both surveyed trees and coverage zones', () => {
    const pointFeat: LoadedGeospatialFeature = {
      featureId: 'tree_1',
      sourceId: 'tree_1',
      sourceName: 'svamitva',
      sourceLayer: 'trees',
      category: 'VEGETATION',
      subcategory: 'tree',
      geometryType: 'Point',
      geometry: { type: 'Point', coordinates: [77.062, 23.119] },
      properties: {},
      rawAttributes: {},
      verticalTier: 1,
      plinthElevationM: 0,
      heightMeters: 4.5,
      roofType: 'none',
      stories: 0,
      hasRoadOverlap: false,
      roadOverlapAreaSqm: 0,
      batchLayer: 'vegetation',
    };

    const polyFeat: LoadedGeospatialFeature = {
      featureId: 'park_1',
      sourceId: 'park_1',
      sourceName: 'grammanchitra',
      sourceLayer: 'greens',
      category: 'VEGETATION',
      subcategory: 'green_space',
      geometryType: 'Polygon',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [77.061, 23.118],
            [77.062, 23.118],
            [77.062, 23.119],
            [77.061, 23.119],
            [77.061, 23.118],
          ],
        ],
      },
      properties: {},
      rawAttributes: {},
      verticalTier: 1,
      plinthElevationM: 0,
      heightMeters: 0,
      roofType: 'none',
      stories: 0,
      hasRoadOverlap: false,
      roadOverlapAreaSqm: 0,
      batchLayer: 'vegetation',
    };

    const layerResult = generator.generateVegetationLayer([pointFeat, polyFeat], converter);

    assert.strictEqual(layerResult.isVegetationAvailable, true);
    assert.strictEqual(layerResult.totalFeatures, 2);
    assert.strictEqual(layerResult.individualTreesCount, 1);
    assert.strictEqual(layerResult.generalizedPolygonsCount, 1);
    assert.strictEqual(layerResult.metadataList.length, 2);
  });
});
