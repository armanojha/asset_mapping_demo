/**
 * Centralized Reusable Material System for 3D Isometric Village Procedural Geometry.
 * Implements the Central Indian Rural Palette (Narmada Valley, MP vernacular):
 * - Chuna lime-washes and earthen plasters for walls with deterministic tone variation.
 * - Terracotta clay tiles (Khaprail) and weathered concrete terrace slabs for roofs.
 * - Soft slate asphalt and warm earthen pathways for road networks.
 * - Sandstone-clay tones for cadastral parcels with soft boundary demarcation.
 * - Mineral teal for water surfaces and stratified bedrock for diorama pedestals.
 * - Interactive hover, selection, and road encroachment warning states.
 */

import * as THREE from 'three';

export interface MaterialPaletteConfig {
  wallColorDefault?: string;
  wallColorStraw?: string;
  wallColorEarthen?: string;
  wallColorSelected?: string;
  wallColorHovered?: string;
  wallColorEncroaching?: string;
  plinthColor?: string;
  roofFlatColor?: string;
  roofGableColor?: string;
  roofHipColor?: string;
  roofRidgeColor?: string;
  asphaltRoadColor?: string;
  earthenRoadColor?: string;
  waterColor?: string;
  waterBedColor?: string;
  parcelColor?: string;
  parcelBorderColor?: string;
  foliageColor?: string;
  treeTrunkColor?: string;
  vegetationAreaColor?: string;
  vegetationBorderColor?: string;
  terrainColor?: string;
  dioramaPedestalColor?: string;
  dioramaBevelColor?: string;
  wireframe?: boolean;
}

export class BuildingMaterialSystem {
  private static instance: BuildingMaterialSystem | null = null;

  // Reusable Material Singletons - Building Walls
  public readonly defaultWallMaterial: THREE.MeshStandardMaterial;
  public readonly strawWallMaterial: THREE.MeshStandardMaterial;
  public readonly earthenWallMaterial: THREE.MeshStandardMaterial;
  public readonly selectedWallMaterial: THREE.MeshStandardMaterial;
  public readonly hoveredWallMaterial: THREE.MeshStandardMaterial;
  public readonly encroachingWallMaterial: THREE.MeshStandardMaterial;
  public readonly plinthMaterial: THREE.MeshStandardMaterial;

  // Roof Materials
  public readonly flatRoofMaterial: THREE.MeshStandardMaterial;
  public readonly gableRoofMaterial: THREE.MeshStandardMaterial;
  public readonly hipRoofMaterial: THREE.MeshStandardMaterial;
  public readonly roofRidgeMaterial: THREE.MeshStandardMaterial;

  // Road Materials
  public readonly asphaltRoadMaterial: THREE.MeshStandardMaterial;
  public readonly earthenRoadMaterial: THREE.MeshStandardMaterial;

  // Water Materials
  public readonly waterSurfaceMaterial: THREE.MeshStandardMaterial;
  public readonly waterBedMaterial: THREE.MeshStandardMaterial;

  // Land Parcel Materials
  public readonly parcelMaterial: THREE.MeshStandardMaterial;
  public readonly parcelBorderMaterial: THREE.LineBasicMaterial;
  public readonly villageBoundaryLineMaterial: THREE.LineBasicMaterial;

  // Vegetation Materials
  public readonly foliageTreeMaterial: THREE.MeshStandardMaterial;
  public readonly treeTrunkMaterial: THREE.MeshStandardMaterial;
  public readonly vegetationAreaMaterial: THREE.MeshStandardMaterial;
  public readonly vegetationBorderMaterial: THREE.LineBasicMaterial;

  // Terrain & Diorama Pedestal Materials
  public readonly terrainMaterial: THREE.MeshStandardMaterial;
  public readonly dioramaPedestalMaterial: THREE.MeshStandardMaterial;
  public readonly dioramaBevelMaterial: THREE.LineBasicMaterial;

  // Edge / Border Material
  public readonly edgeLineMaterial: THREE.LineBasicMaterial;

  constructor(config: MaterialPaletteConfig = {}) {
    // 1. Color Defaults - Central Indian Vernacular Palette
    const wallDefault = config.wallColorDefault || '#f5efe6';    // Pure lime plaster (Chuna)
    const wallStraw = config.wallColorStraw || '#efe6d8';        // Warm straw plaster
    const wallEarthen = config.wallColorEarthen || '#e5dac8';    // Muted earthen wash
    const wallSelected = config.wallColorSelected || '#38bdf8';  // Radiant Cyan highlight
    const wallHovered = config.wallColorHovered || '#fde047';    // Warm Solar Amber hover
    const wallEncroach = config.wallColorEncroaching || '#f97316'; // Warning orange for road overlap
    const plinthCol = config.plinthColor || '#5a6472';           // Slate/basalt foundation
    const roofFlat = config.roofFlatColor || '#b8b0a2';          // Weathered concrete terrace (Chhat)
    const roofGable = config.roofGableColor || '#c25e36';        // Terracotta clay tile (Khaprail)
    const roofHip = config.roofHipColor || '#b85d32';            // Earthen clay tile
    const roofRidge = config.roofRidgeColor || '#8c381e';        // Deep burnt terracotta trim
    const asphaltCol = config.asphaltRoadColor || '#3f4854';     // Soft slate asphalt (Pucca sadak)
    const earthenCol = config.earthenRoadColor || '#b89f7d';     // Sun-baked earth (Kutcha rasta)
    const waterCol = config.waterColor || '#2b7a78';             // Mineral turquoise teal
    const waterBedCol = config.waterBedColor || '#1a3338';       // Dark silt bed
    const parcelCol = config.parcelColor || '#ddd5c1';           // Sandstone-clay courtyard ground
    const parcelBorderCol = config.parcelBorderColor || '#8a7d6b'; // Soft cadastral stroke
    const foliageCol = config.foliageColor || '#3e7b42';         // Natural Neem/Peepal leaf green
    const trunkCol = config.treeTrunkColor || '#5d4037';         // Tree bark brown
    const vegAreaCol = config.vegetationAreaColor || '#529956';   // Green open space / meadow
    const vegBorderCol = config.vegetationBorderColor || '#1e5f24';
    const terrainCol = config.terrainColor || '#dcd3be';         // Natural terrain sandstone ground
    const dioramaPedestalCol = config.dioramaPedestalColor || '#5a4634'; // Stratified bedrock pedestal
    const dioramaBevelCol = config.dioramaBevelColor || '#7c6351';
    const wireframe = Boolean(config.wireframe);

    // 2. Wall Materials
    this.defaultWallMaterial = new THREE.MeshStandardMaterial({
      color: wallDefault,
      roughness: 0.88,
      metalness: 0.02,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.strawWallMaterial = new THREE.MeshStandardMaterial({
      color: wallStraw,
      roughness: 0.90,
      metalness: 0.01,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.earthenWallMaterial = new THREE.MeshStandardMaterial({
      color: wallEarthen,
      roughness: 0.92,
      metalness: 0.01,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.selectedWallMaterial = new THREE.MeshStandardMaterial({
      color: wallSelected,
      roughness: 0.35,
      metalness: 0.20,
      emissive: '#0284c7',
      emissiveIntensity: 0.45,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.hoveredWallMaterial = new THREE.MeshStandardMaterial({
      color: wallHovered,
      roughness: 0.50,
      metalness: 0.10,
      emissive: '#eab308',
      emissiveIntensity: 0.30,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.encroachingWallMaterial = new THREE.MeshStandardMaterial({
      color: wallEncroach,
      roughness: 0.60,
      metalness: 0.10,
      emissive: '#ea580c',
      emissiveIntensity: 0.35,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.plinthMaterial = new THREE.MeshStandardMaterial({
      color: plinthCol,
      roughness: 0.92,
      metalness: 0.08,
      wireframe,
    });

    // 3. Roof Materials
    this.flatRoofMaterial = new THREE.MeshStandardMaterial({
      color: roofFlat,
      roughness: 0.82,
      metalness: 0.05,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.gableRoofMaterial = new THREE.MeshStandardMaterial({
      color: roofGable,
      roughness: 0.70,
      metalness: 0.04,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.hipRoofMaterial = new THREE.MeshStandardMaterial({
      color: roofHip,
      roughness: 0.72,
      metalness: 0.04,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.roofRidgeMaterial = new THREE.MeshStandardMaterial({
      color: roofRidge,
      roughness: 0.75,
      metalness: 0.05,
      wireframe,
      side: THREE.DoubleSide,
    });

    // 4. Road Materials
    this.asphaltRoadMaterial = new THREE.MeshStandardMaterial({
      color: asphaltCol,
      roughness: 0.85,
      metalness: 0.05,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.earthenRoadMaterial = new THREE.MeshStandardMaterial({
      color: earthenCol,
      roughness: 0.95,
      metalness: 0.00,
      wireframe,
      side: THREE.DoubleSide,
    });

    // 5. Water Materials
    this.waterSurfaceMaterial = new THREE.MeshStandardMaterial({
      color: waterCol,
      roughness: 0.12,
      metalness: 0.15,
      transparent: true,
      opacity: 0.88,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.waterBedMaterial = new THREE.MeshStandardMaterial({
      color: waterBedCol,
      roughness: 0.95,
      metalness: 0.02,
      wireframe,
    });

    // 6. Land Parcels & Boundary Materials
    this.parcelMaterial = new THREE.MeshStandardMaterial({
      color: parcelCol,
      roughness: 0.90,
      metalness: 0.02,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.parcelBorderMaterial = new THREE.LineBasicMaterial({
      color: parcelBorderCol,
      linewidth: 1.5,
      transparent: true,
      opacity: 0.75,
    });

    this.villageBoundaryLineMaterial = new THREE.LineBasicMaterial({
      color: '#ef4444',
      linewidth: 2.0,
    });

    // 7. Vegetation Materials
    this.foliageTreeMaterial = new THREE.MeshStandardMaterial({
      color: foliageCol,
      roughness: 0.75,
      metalness: 0.04,
      wireframe,
    });

    this.treeTrunkMaterial = new THREE.MeshStandardMaterial({
      color: trunkCol,
      roughness: 0.92,
      metalness: 0.02,
      wireframe,
    });

    this.vegetationAreaMaterial = new THREE.MeshStandardMaterial({
      color: vegAreaCol,
      roughness: 0.85,
      metalness: 0.02,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.vegetationBorderMaterial = new THREE.LineBasicMaterial({
      color: vegBorderCol,
      linewidth: 1.5,
    });

    // 8. Terrain & Diorama Pedestal Materials
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      color: terrainCol,
      roughness: 0.92,
      metalness: 0.02,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.dioramaPedestalMaterial = new THREE.MeshStandardMaterial({
      color: dioramaPedestalCol,
      roughness: 0.96,
      metalness: 0.02,
      wireframe,
    });

    this.dioramaBevelMaterial = new THREE.LineBasicMaterial({
      color: dioramaBevelCol,
      linewidth: 1.5,
    });

    // 9. Edge Line Material
    this.edgeLineMaterial = new THREE.LineBasicMaterial({
      color: '#334155',
      linewidth: 1.0,
    });
  }

  public static getInstance(config?: MaterialPaletteConfig): BuildingMaterialSystem {
    if (!BuildingMaterialSystem.instance) {
      BuildingMaterialSystem.instance = new BuildingMaterialSystem(config);
    }
    return BuildingMaterialSystem.instance;
  }

  /**
   * Deterministically assigns a harmonized vernacular wall material based on feature ID hash.
   * Produces a natural 60% / 25% / 15% distribution of lime-wash and earthen tones across village houses.
   */
  public getWallMaterialForFeature(
    featureId: string,
    isEncroaching: boolean = false,
    highlightEncroachments: boolean = false
  ): THREE.MeshStandardMaterial {
    if (isEncroaching && highlightEncroachments) {
      return this.encroachingWallMaterial;
    }

    let hash = 0;
    for (let i = 0; i < featureId.length; i++) {
      hash = (hash << 5) - hash + featureId.charCodeAt(i);
      hash |= 0;
    }
    const bucket = Math.abs(hash) % 100;

    if (bucket < 60) {
      return this.defaultWallMaterial; // 60% Chuna lime plaster
    } else if (bucket < 85) {
      return this.strawWallMaterial;   // 25% Warm straw plaster
    } else {
      return this.earthenWallMaterial; // 15% Muted earthen wash
    }
  }

  public getRoofMaterialByType(roofType: string): THREE.MeshStandardMaterial {
    switch (roofType.toLowerCase()) {
      case 'gabled_tile':
      case 'gable':
        return this.gableRoofMaterial;
      case 'hipped':
      case 'hip':
        return this.hipRoofMaterial;
      case 'flat_terrace':
      case 'flat':
      default:
        return this.flatRoofMaterial;
    }
  }

  public dispose(): void {
    this.defaultWallMaterial.dispose();
    this.strawWallMaterial.dispose();
    this.earthenWallMaterial.dispose();
    this.selectedWallMaterial.dispose();
    this.hoveredWallMaterial.dispose();
    this.encroachingWallMaterial.dispose();
    this.plinthMaterial.dispose();
    this.flatRoofMaterial.dispose();
    this.gableRoofMaterial.dispose();
    this.hipRoofMaterial.dispose();
    this.roofRidgeMaterial.dispose();
    this.asphaltRoadMaterial.dispose();
    this.earthenRoadMaterial.dispose();
    this.waterSurfaceMaterial.dispose();
    this.waterBedMaterial.dispose();
    this.parcelMaterial.dispose();
    this.parcelBorderMaterial.dispose();
    this.villageBoundaryLineMaterial.dispose();
    this.foliageTreeMaterial.dispose();
    this.treeTrunkMaterial.dispose();
    this.vegetationAreaMaterial.dispose();
    this.vegetationBorderMaterial.dispose();
    this.terrainMaterial.dispose();
    this.dioramaPedestalMaterial.dispose();
    this.dioramaBevelMaterial.dispose();
    this.edgeLineMaterial.dispose();
    BuildingMaterialSystem.instance = null;
  }
}
