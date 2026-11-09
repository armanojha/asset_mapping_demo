/**
 * Layer Management TypeScript Definitions for the Village Asset Mapping System.
 */

export type LayerId =
  | 'satellite'
  | 'buildings'
  | 'roofs'
  | 'roads'
  | 'parcels'
  | 'water'
  | 'vegetation'
  | 'terrain'
  | 'landmarks';

export interface LayerState {
  id: LayerId;
  name: string;
  category: string;
  visible: boolean;
  enabled: boolean;
  opacity: number; // 0.0 to 1.0
  featureCount: number;
  status: 'ready' | 'empty' | 'loading' | 'error';
  statusDescription?: string;
  colorSwatch?: string;
}

export type LayerManagerMap = Record<LayerId, LayerState>;

export const INITIAL_LAYER_STATES: LayerManagerMap = {
  satellite: {
    id: 'satellite',
    name: 'Satellite Imagery',
    category: 'Landscape',
    visible: true,
    enabled: true,
    opacity: 1.0,
    featureCount: 1,
    status: 'ready',
    statusDescription: 'High-res sub-meter aerial satellite orthophoto',
    colorSwatch: '#15803d',
  },
  buildings: {
    id: 'buildings',
    name: 'Buildings',
    category: 'Architecture',
    visible: true,
    enabled: true,
    opacity: 1.0,
    featureCount: 0,
    status: 'loading',
    statusDescription: 'Extruded solid walls with excised courtyards',
    colorSwatch: '#f5efe6',
  },
  roofs: {
    id: 'roofs',
    name: 'Roofs',
    category: 'Architecture',
    visible: true,
    enabled: true,
    opacity: 1.0,
    featureCount: 0,
    status: 'loading',
    statusDescription: 'Terracotta tiles (khaprail) & terrace parapets',
    colorSwatch: '#c25e36',
  },
  roads: {
    id: 'roads',
    name: 'Road Corridors',
    category: 'Circulation',
    visible: true,
    enabled: true,
    opacity: 1.0,
    featureCount: 0,
    status: 'loading',
    statusDescription: 'Surveyed asphalt & earthen village pathways',
    colorSwatch: '#3f4854',
  },
  parcels: {
    id: 'parcels',
    name: 'Land Parcels',
    category: 'Cadastral',
    visible: false,
    enabled: true,
    opacity: 1.0,
    featureCount: 0,
    status: 'loading',
    statusDescription: 'Surveyed property parcels & demarcation strokes',
    colorSwatch: '#ddd5c1',
  },
  water: {
    id: 'water',
    name: 'Water Bodies',
    category: 'Hydrology',
    visible: false,
    enabled: true,
    opacity: 0.88,
    featureCount: 0,
    status: 'empty',
    statusDescription: 'Narmada River northern boundary water channel',
    colorSwatch: '#2b7a78',
  },
  vegetation: {
    id: 'vegetation',
    name: 'Vegetation',
    category: 'Environment',
    visible: true,
    enabled: true,
    opacity: 1.0,
    featureCount: 0,
    status: 'empty',
    statusDescription: 'Surveyed tree points (no tree survey in SVAMITVA)',
    colorSwatch: '#3e7b42',
  },
  terrain: {
    id: 'terrain',
    name: 'Terrain & Diorama',
    category: 'Landscape',
    visible: true,
    enabled: true,
    opacity: 1.0,
    featureCount: 1,
    status: 'ready',
    statusDescription: 'Cadastral boundary sandstone diorama pedestal',
    colorSwatch: '#5a4634',
  },
  landmarks: {
    id: 'landmarks',
    name: 'Landmarks & POIs',
    category: 'Community',
    visible: true,
    enabled: true,
    opacity: 1.0,
    featureCount: 8,
    status: 'ready',
    statusDescription: 'Key village institutions, temples & community pins',
    colorSwatch: '#f59e0b',
  },
};
