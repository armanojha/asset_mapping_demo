# GIS Preprocessing Pipeline Architecture & Specification

**Project:** Village Asset Mapping System (Living Digital Village)
**Phase:** Phase 2 — GIS Preprocessing Pipeline Design
**Date:** 2026-11-07
**Status:** **DESIGN & AUDIT COMPLETE (Awaiting Approval for Implementation)**

---

## 1. Executive Summary & Design Principles

The Phase 2 GIS Preprocessing Pipeline transforms raw, unnormalized geospatial files acquired in Phase 1 into clean, topologically consistent, and metric-projected datasets ready for procedural 2.5D isometric world generation.

### Strict Engineering Rules:
1. **Never modify raw source files**: Files in `data/raw/` remain permanently read-only and unmutated.
2. **Never invent missing geographical features**: Do not synthesize buildings, water bodies, or roads where no source data exists.
3. **Never silently discard features**: All features are preserved; duplicates are merged with audited ID mapping, and anomalies are flagged in audit logs.
4. **Preserve original source identifiers and attributes**: All original keys (`objectid`, `uniq_id`, `state_code`, `lgd_code`, `st_area`, etc.) remain accessible in `verified_attributes`.
5. **Maintain geographical accuracy**: Spatial transformations preserve sub-centimeter survey precision.
6. **Record every transformation**: An immutable audit log (`transformation_log.json`) documents all operations, deduplications, and reprojections.
7. **Distinguish verified vs inferred information**: Real survey geometry and attributes are explicitly separated from procedural inferences (e.g. estimated building heights or roof types).

---

## 2. Pipeline Architecture Flowchart

```
┌────────────────────────────────────────────────────────┐
│           Raw GIS Data (data/raw/<source>/)            │
│   - GeoJSON / Raw ArcGIS JSON / Metadata Sidecars      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  1. Format Detection (format_detector.py)              │
│     - Schema validation, FeatureCollection parser      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  2. CRS Detection & Transformation (crs_transformer.py)│
│     - Detect source CRS (EPSG:4326 / EPSG:3857)        │
│     - Project to local UTM metric (EPSG:32644)         │
│     - Compute local Cartesian scene origin (0, 0, 0)   │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  3. Geometry Validation (geometry_cleaner.py)          │
│     - Shapely validity check (is_valid, is_empty)      │
│     - Topology cleaning (make_valid, orient rings)     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  4. Deduplication & Reconciliation (deduplicator.py)   │
│     - Identify duplicate pairs sharing uniq_id/geometry│
│     - Reconcile null vs populated attribute sets       │
│     - Preserve source object IDs in audit list         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  5. Feature Classification (classifier.py)             │
│     - Categorize (building, road, parcel, amenity)     │
│     - Assign subtypes & procedural hints               │
│     - Separate verified vs inferred properties         │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  6. Spatial Validation & Gap Audit (spatial_validator) │
│     - Parcel-building intersection checks              │
│     - Road connectivity & encroachment audit           │
│     - Generate spatial audit report                    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  7. Normalized Dataset Export (exporter.py)            │
│     - data/processed/<village_id>/                     │
│       ├── buildings.geojson                            │
│       ├── roads.geojson                                │
│       ├── parcels.geojson                              │
│       ├── village_boundary.geojson                     │
│       ├── spatial_metadata.json                        │
│       └── transformation_log.json                      │
└────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Processing Modules & Responsibilities

### Module 1: Format & Source Detector (`app/preprocessing/format_detector.py`)
- **Input**: Raw file path.
- **Responsibilities**:
  - Validates valid JSON/GeoJSON syntax.
  - Detects data origin (`grammanchitra`, `svamitva`, `osm`).
  - Verifies presence of `features` array and geometry objects.
  - Rejects corrupted or truncated files with clear diagnostics.

### Module 2: CRS & Coordinate Transformer (`app/preprocessing/crs_transformer.py`)
- **Input**: Raw GeoPandas GeoDataFrame with source CRS.
- **Responsibilities**:
  - Automatically identifies UTM projection zone based on centroid longitude:
    For Gudwara (`79.0847° E`): **UTM Zone 44N (`EPSG:32644`)**.
  - Reprojects all layers from `EPSG:4326` (degrees) to `EPSG:32644` (meters).
  - Calculates the village spatial anchor/centroid:
    $$\text{Origin} = (X_{\text{anchor}}, Y_{\text{anchor}})$$
  - Converts coordinates to local Cartesian coordinates $(x, y)$ in meters relative to scene center $(0, 0)$.
  - Stores transformation matrix and offset in `spatial_metadata.json`.

### Module 3: Geometry Validation & Cleaner (`app/preprocessing/geometry_cleaner.py`)
- **Input**: Reprojected GeoDataFrame.
- **Responsibilities**:
  - Runs `shapely.is_valid` across all geometries.
  - Repairs minor self-intersections or bowtie anomalies via `shapely.make_valid`.
  - Normalizes polygon winding order (exterior rings counter-clockwise, interior holes clockwise).
  - Flags any degenerate geometries in the audit log.

### Module 4: Deduplicator & Attribute Reconciler (`app/preprocessing/deduplicator.py`)
- **Input**: Validated GeoDataFrame.
- **Responsibilities**:
  - Detects duplicate geometries and duplicate `uniq_id` GUIDs (discovered in 50% of Survey of India records).
  - Performs intelligent non-lossy reconciliation:
    - Merges attributes from the pair, keeping the non-null value for each field (e.g. preserving `name: "GUDWARA"` over `name: nan`).
    - Merges primary keys: `original_objectids: [209, 4768255]`.
    - Retains exactly one authoritative polygon geometry per physical asset.
  - Logs every merged record pair into `transformation_log.json`.

### Module 5: Feature Classifier & Semantic Tagging (`app/preprocessing/classifier.py`)
- **Input**: Cleaned, deduplicated GeoDataFrame.
- **Responsibilities**:
  - Tags features into a standardized visual ontology:
    - `category`: `"building"`, `"road"`, `"parcel"`, `"water"`, `"amenity"`.
    - `subtype`: `"residential"`, `"commercial"`, `"village_road"`, `"property_parcel"`.
  - Calculates physical geometric properties:
    - `footprint_area_sqm`: calculated directly from projected polygon in square meters.
    - `perimeter_m`: polygon perimeter in meters.
    - `bounding_dimensions`: `[width_m, length_m, orientation_deg]`.
  - Attaches inferred rendering attributes cleanly separated from verified facts:
    - `inferred`: `{ "estimated_height_m": 3.5, "floors": 1, "is_inferred": true }`.
    - `verified`: verbatim source attributes.

### Module 6: Spatial Validator & Topology Auditor (`app/preprocessing/spatial_validator.py`)
- **Input**: Classified layers across the entire village.
- **Responsibilities**:
  - Derives the village boundary from cadastral parcel boundaries:
    - Dissolves parcels and applies a buffer to establish the Abadi settlement envelope.
  - Audits containment (verifies which buildings reside within the envelope).
  - Audits road-building intersections (documents encroachments without modifying raw boundary shapes).
  - Produces a summary quality scorecard.

### Module 7: Normalized Exporter (`app/preprocessing/exporter.py`)
- **Input**: Cleaned, classified GeoDataFrames.
- **Responsibilities**:
  - Writes normalized GeoJSON files to `data/processed/<village_id>/`.
  - Emits `transformation_log.json` detailing every step, feature count before/after, and execution timing.
  - Emits `spatial_metadata.json` defining bounding box, UTM zone, local origin, and feature tallies.

---

## 4. Identified Data Gaps in Gudwara (MP) Dataset

Forensic audit of `data/raw/` revealed the following specific gaps:

| Data Gap | Observed Condition | Impact on Pipeline | Non-Invention Strategy |
| :--- | :--- | :--- | :--- |
| **Missing Water Bodies** | No ponds, wells, or tanks exist in `SOI_MP` cadastral layers. | Digital village currently lacks water features. | Do **not** invent water features. Flag in metadata; configure supplementary OSM/Bhuvan mirror for secondary acquisition. |
| **Missing Village Boundary** | `SOI_MP` provides parcels and roads but no explicit standalone boundary polygon. | Outer perimeter boundary missing. | Derive boundary geometrically via parcel envelope dissolution (`concave_hull`); label explicitly as `derived_boundary`. |
| **Connecting Arterial Roads** | `Road` layer contains 53 internal village lanes, but stops at the settlement edge. | Digital village roads terminate abruptly at village perimeter. | Do **not** draw fake highways. Document as cadastral boundary limitation; external connecting roads to be queried from state PWD / OSM. |
| **Incomplete Attributes** | Public MapServer omits `owner_name`, `no_floors`, and `property_card_no` (100% null). | Individual building heights and ownership cannot be verified from GIS alone. | Assign standardized rural architectural default heights (3.5m) strictly inside `inferred_attributes` with `is_inferred: true`. |
| **Overlapping Road/Building Polygons** | 181 buildings overlap road boundary polygons. | 3D meshes could z-fight or penetrate road ribbons. | Do **not** chop or deform building footprints. In 3D rendering (Phase 3), roads sit on ground plane $Z=0$ while building foundations extrude upward starting at $Z=0.05$. |

---

## 5. Next Steps & Approval Gate

The pipeline design and dataset inventory are fully documented.
**No raw source files have been altered, and no processing code has been executed yet.**

Awaiting user approval to proceed with Phase 2 implementation of the preprocessing modules (`format_detector.py`, `crs_transformer.py`, `geometry_cleaner.py`, `deduplicator.py`, `classifier.py`, `spatial_validator.py`, and `pipeline.py`).
