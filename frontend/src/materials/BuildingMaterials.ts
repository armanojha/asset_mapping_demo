/**
 * Reusable Material System for 3D Village Procedural Geometry.
 * Provides neutral, configurable placeholder materials for plinths, walls, and roofs,
 * along with interactive hover and selection highlight states for raycasting.
 */

import * as THREE from 'three';

export interface MaterialPaletteConfig {
  wallColorDefault?: string;
  wallColorSelected?: string;
  wallColorHovered?: string;
  plinthColor?: string;
  roofFlatColor?: string;
  roofGableColor?: string;
  roofHipColor?: string;
  asphaltRoadColor?: string;
  earthenRoadColor?: string;
  waterColor?: string;
  parcelColor?: string;
  parcelBorderColor?: string;
  foliageColor?: string;
  treeTrunkColor?: string;
  vegetationAreaColor?: string;
  vegetationBorderColor?: string;
  wireframe?: boolean;
}

export class BuildingMaterialSystem {
  private static instance: BuildingMaterialSystem | null = null;

  // Reusable Material Singletons - Buildings
  public readonly defaultWallMaterial: THREE.MeshStandardMaterial;
  public readonly selectedWallMaterial: THREE.MeshStandardMaterial;
  public readonly hoveredWallMaterial: THREE.MeshStandardMaterial;
  public readonly plinthMaterial: THREE.MeshStandardMaterial;

  // Roof Materials
  public readonly flatRoofMaterial: THREE.MeshStandardMaterial;
  public readonly gableRoofMaterial: THREE.MeshStandardMaterial;
  public readonly hipRoofMaterial: THREE.MeshStandardMaterial;

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

  // Edge / Border Material
  public readonly edgeLineMaterial: THREE.LineBasicMaterial;

  constructor(config: MaterialPaletteConfig = {}) {
    const wallDefault = config.wallColorDefault || '#e2d9cc'; // Warm rural limestone/mortar plaster
    const wallSelected = config.wallColorSelected || '#38bdf8'; // Cyan highlight
    const wallHovered = config.wallColorHovered || '#fef08a';   // Soft warm yellow hover
    const plinthCol = config.plinthColor || '#64748b';         // Foundation slate/stone
    const roofFlat = config.roofFlatColor || '#94a3b8';        // Concrete terrace slab
    const roofGable = config.roofGableColor || '#c2410c';      // Terracotta clay tile (kavelu)
    const roofHip = config.roofHipColor || '#b45309';          // Earthen clay tile
    const asphaltCol = config.asphaltRoadColor || '#334155';   // Dark paved asphalt
    const earthenCol = config.earthenRoadColor || '#8c7355';   // Earthen village pathway
    const waterCol = config.waterColor || '#0284c7';           // Deep reflective pond water
    const parcelCol = config.parcelColor || '#e2e8f0';         // Subtle parcel ground tone
    const parcelBorderCol = config.parcelBorderColor || '#64748b'; // Cadastral stroke border
    const foliageCol = config.foliageColor || '#2e7d32';       // Natural foliage green
    const trunkCol = config.treeTrunkColor || '#5d4037';       // Tree bark brown
    const vegAreaCol = config.vegetationAreaColor || '#4ade80'; // Meadow/scrub vegetation area
    const vegBorderCol = config.vegetationBorderColor || '#15803d'; // Green vegetation boundary outline
    const wireframe = Boolean(config.wireframe);

    this.defaultWallMaterial = new THREE.MeshStandardMaterial({
      color: wallDefault,
      roughness: 0.85,
      metalness: 0.05,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.selectedWallMaterial = new THREE.MeshStandardMaterial({
      color: wallSelected,
      roughness: 0.4,
      metalness: 0.2,
      emissive: '#0284c7',
      emissiveIntensity: 0.4,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.hoveredWallMaterial = new THREE.MeshStandardMaterial({
      color: wallHovered,
      roughness: 0.6,
      metalness: 0.1,
      emissive: '#eab308',
      emissiveIntensity: 0.25,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.plinthMaterial = new THREE.MeshStandardMaterial({
      color: plinthCol,
      roughness: 0.9,
      metalness: 0.1,
      wireframe,
    });

    this.flatRoofMaterial = new THREE.MeshStandardMaterial({
      color: roofFlat,
      roughness: 0.8,
      metalness: 0.1,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.gableRoofMaterial = new THREE.MeshStandardMaterial({
      color: roofGable,
      roughness: 0.75,
      metalness: 0.05,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.hipRoofMaterial = new THREE.MeshStandardMaterial({
      color: roofHip,
      roughness: 0.75,
      metalness: 0.05,
      wireframe,
      side: THREE.DoubleSide,
    });

    // Roads
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
      metalness: 0.02,
      wireframe,
      side: THREE.DoubleSide,
    });

    // Water
    this.waterSurfaceMaterial = new THREE.MeshStandardMaterial({
      color: waterCol,
      roughness: 0.15,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.waterBedMaterial = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.95,
      metalness: 0.05,
      wireframe,
    });

    // Land Parcels
    this.parcelMaterial = new THREE.MeshStandardMaterial({
      color: parcelCol,
      roughness: 0.9,
      metalness: 0.05,
      wireframe,
      side: THREE.DoubleSide,
    });

    this.parcelBorderMaterial = new THREE.LineBasicMaterial({
      color: parcelBorderCol,
      linewidth: 1.5,
    });

    this.villageBoundaryLineMaterial = new THREE.LineBasicMaterial({
      color: '#ef4444',
      linewidth: 2,
    });

    // Vegetation
    this.foliageTreeMaterial = new THREE.MeshStandardMaterial({
      color: foliageCol,
      roughness: 0.75,
      metalness: 0.05,
      wireframe,
    });

    this.treeTrunkMaterial = new THREE.MeshStandardMaterial({
      color: trunkCol,
      roughness: 0.9,
      metalness: 0.05,
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

    this.edgeLineMaterial = new THREE.LineBasicMaterial({
      color: '#334155',
      linewidth: 1,
    });
  }

  public static getInstance(config?: MaterialPaletteConfig): BuildingMaterialSystem {
    if (!BuildingMaterialSystem.instance) {
      BuildingMaterialSystem.instance = new BuildingMaterialSystem(config);
    }
    return BuildingMaterialSystem.instance;
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
    this.selectedWallMaterial.dispose();
    this.hoveredWallMaterial.dispose();
    this.plinthMaterial.dispose();
    this.flatRoofMaterial.dispose();
    this.gableRoofMaterial.dispose();
    this.hipRoofMaterial.dispose();
    this.asphaltRoadMaterial.dispose();
    this.earthenRoadMaterial.dispose();
    this.waterSurfaceMaterial.dispose();
    this.waterBedMaterial.dispose();
    this.parcelMaterial.dispose();
    this.parcelBorderMaterial.dispose();
    this.villageBoundaryLineMaterial.dispose();
    this.edgeLineMaterial.dispose();
    BuildingMaterialSystem.instance = null;
  }
}
