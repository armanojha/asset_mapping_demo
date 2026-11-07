# Raw GIS Dataset Inventory & Audit

**Project:** Village Asset Mapping System (Living Digital Village)
**Phase:** Phase 2 — GIS Preprocessing Pipeline
**Target Village:** Gudwara (Gurwara), Kareli Tahsil, Narsinghpur District, Madhya Pradesh
**Acquisition ID:** `acq_1fa4312f8f87`
**Inspection Date:** 2026-11-07

---

## 1. Executive Summary

A comprehensive forensic inspection was performed across all files in `data/raw/`.
All raw datasets were downloaded via live REST queries from official government GIS services (Survey of India / Ministry of Panchayati Raj) and are preserved unaltered on disk.

Across all layers, exactly **772 real-world cadastral geometries** exist. Geometry validity is **100% valid** across all layers. However, enterprise geodatabase duplication was discovered: every spatial feature exists as two distinct database rows sharing the same `uniq_id` and geometry, one having populated attributes and the other having nulls.

---

## 2. Dataset Inventory Table

| Dataset | Source | Format | Geometry | CRS | Feature Count | Issues Detected |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **grammanchitra_layer_0** | Gram Manchitra (SOI SVAMITVA) | GeoJSON + Raw JSON | Polygon | EPSG:4326 | 106 | Exact 50% duplicate geometries (53 unique spatial road corridors; 53 duplicate pairs with shared `uniq_id`); 15/27 columns 100% null (civil registry fields unpopulated); 181 building overlap points. |
| **grammanchitra_layer_1** | Gram Manchitra (SOI SVAMITVA) | GeoJSON + Raw JSON | Polygon | EPSG:4326 | 424 | Exact 50% duplicate geometries (212 unique building footprints; 212 duplicate pairs with shared `uniq_id`); 10/22 columns 100% null (`owner_name`, `no_floors`, `property_id`); 401 shared-wall / eave polygon overlaps. |
| **grammanchitra_layer_2** | Gram Manchitra (SOI SVAMITVA) | GeoJSON + Raw JSON | Polygon | EPSG:4326 | 242 | Exact 50% duplicate geometries (121 unique land parcels; 121 duplicate pairs with shared `uniq_id`); 17/31 columns 100% null (ownership records redacted by government portal); non-convex outer boundary. |
| **svamitva_layer_1** | SVAMITVA Panchayat Vehicle POC | GeoJSON + Raw JSON | Polygon | EPSG:4326 | 0 | Coverage gap: Pilot dataset did not contain road polygons for Narsinghpur district; query succeeded with empty feature array. |

---

## 3. Deep-Dive Inspection by Dataset

### A. Dataset: `grammanchitra_layer_0` (Village Roads)
- **File Paths**:
  - Normalized: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_0_20261107_095850.geojson` (357.6 kB)
  - Raw Server Response: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_0_20261107_095850.raw.json` (170.7 kB)
  - Metadata Sidecar: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_0_20261107_095850.meta.json` (717 B)
- **Feature Count**: 106 records.
- **Unique Spatial Geometries**: 53 unique road polygons.
- **Geometry Type**: 100% `Polygon`. Zero invalid geometries, zero empty geometries.
- **Bounding Box**:
  - `min_lon`: `79.082290`
  - `min_lat`: `23.116955`
  - `max_lon`: `79.086447`
  - `max_lat`: `23.119356`
- **Total Columns**: 27 attribute columns + geometry.
- **Attribute Completeness**:
  - 100% Populated: `objectid`, `uniq_id`, `old_uniq_id`, `state_code` (23), `district_code` (34), `tehsil_code` (02), `village_code` (010), `lgd_code` (491275), `village_name` (GUDWARA), `road_type` (9), `st_area(shape)`, `st_length(shape)`.
  - 50% Populated: `name`, `pavement`, `property_id` (populated in the master reconciliation record, null in the initial digitizing duplicate).
  - 100% Null: `clr_plot_no`, `soi_perimeter_mtr`, `soi_plot_area_sqr`, `clr_village_lgd`, `ror_id`, `block_code`, `width`, `status`, `built_on`, `carriageway`, `remarks`, `adl_info`.

---

### B. Dataset: `grammanchitra_layer_1` (Built-Up Area / Building Footprints)
- **File Paths**:
  - Normalized: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_1_20261107_095851.geojson` (864.0 kB)
  - Raw Server Response: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_1_20261107_095851.raw.json` (442.3 kB)
  - Metadata Sidecar: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_1_20261107_095851.meta.json` (717 B)
- **Feature Count**: 424 records.
- **Unique Spatial Geometries**: 212 unique building footprint polygons.
- **Geometry Type**: 100% `Polygon`. Zero invalid geometries, zero empty geometries.
- **Bounding Box**:
  - `min_lon`: `79.082331`
  - `min_lat`: `23.117005`
  - `max_lon`: `79.086298`
  - `max_lat`: `23.119205`
- **Total Columns**: 22 attribute columns + geometry.
- **Attribute Completeness**:
  - 100% Populated: `objectid`, `uniq_id`, `old_uniq_id`, `state_code` (23), `district_code` (34), `tehsil_code` (02), `village_code` (010), `lgd_code` (491275), `village_name` (GUDWARA), `built_up_area_type` (19 = residential/village settlement structure), `st_area(shape)`, `st_length(shape)`.
  - 50% Populated: `name` (e.g. "GUDWARA" in master table; `null` in initial digitizing row).
  - 100% Null: `block_code`, `area_desc`, `owner_name`, `property_id`, `property_card_no`, `area_sqm`, `no_floors`, `remarks`, `adl_info`.

---

### C. Dataset: `grammanchitra_layer_2` (Parcel Area / Cadastral Plots)
- **File Paths**:
  - Normalized: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_2_20261107_095852.geojson` (652.7 kB)
  - Raw Server Response: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_2_20261107_095852.raw.json` (333.0 kB)
  - Metadata Sidecar: `data/raw/grammanchitra/acq_1fa4312f8f87/grammanchitra_layer_2_20261107_095852.meta.json` (717 B)
- **Feature Count**: 242 records.
- **Unique Spatial Geometries**: 121 unique land parcel polygons.
- **Geometry Type**: 100% `Polygon`. Zero invalid geometries, zero empty geometries.
- **Bounding Box**:
  - `min_lon`: `79.082305`
  - `min_lat`: `23.117188`
  - `max_lon`: `79.085587`
  - `max_lat`: `23.119227`
- **Total Columns**: 31 attribute columns + geometry.
- **Attribute Completeness**:
  - 100% Populated: `objectid`, `uniq_id`, `old_uniq_id`, `state_code` (23), `district_code` (34), `tehsil_code` (02), `village_code` (010), `lgd_code` (491275), `village_name` (GUDWARA), `parcel_type` ("Property Parcel"), `property_type` (3), `st_area(shape)`, `st_length(shape)`.
  - 100% Null: `clr_plot_no`, `soi_perimeter_mtr`, `soi_plot_area_sqr`, `clr_village_lgd`, `ror_id`, `ca`, `load`, `block_code`, `owner_name`, `father_name`, `survey_no`, `property_card_no`, `built_up_area`, `open_area`, `area_sqm`, `remarks`, `adl_info`.

---

### D. Dataset: `svamitva_layer_1` (SVAMITVA Vehicle Road Polygons)
- **File Paths**:
  - Normalized: `data/raw/svamitva/acq_1fa4312f8f87/svamitva_layer_1_20261107_095852.geojson` (168 B)
  - Raw Server Response: `data/raw/svamitva/acq_1fa4312f8f87/svamitva_layer_1_20261107_095852.raw.json` (42 B)
  - Metadata Sidecar: `data/raw/svamitva/acq_1fa4312f8f87/svamitva_layer_1_20261107_095852.meta.json` (693 B)
- **Feature Count**: 0 records (empty FeatureCollection).
- **Issue**: SVAMITVA vehicle centerline/polygon pilot was only deployed in selected districts of Haryana and pilot corridors; Narsinghpur district currently has zero road features in this experimental service.
