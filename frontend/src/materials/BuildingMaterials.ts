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
  wireframe?: boolean;
}

export class BuildingMaterialSystem {
  private static instance: BuildingMaterialSystem | null = null;

  // Reusable Material Singletons
  public readonly defaultWallMaterial: THREE.MeshStandardMaterial;
  public readonly selectedWallMaterial: THREE.MeshStandardMaterial;
  public readonly hoveredWallMaterial: THREE.MeshStandardMaterial;
  public readonly plinthMaterial: THREE.MeshStandardMaterial;

  // Roof Materials
  public readonly flatRoofMaterial: THREE.MeshStandardMaterial;
  public readonly gableRoofMaterial: THREE.MeshStandardMaterial;
  public readonly hipRoofMaterial: THREE.MeshStandardMaterial;

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
    this.edgeLineMaterial.dispose();
    BuildingMaterialSystem.instance = null;
  }
}
