# GIS Data Sources Specification & Verification Document

**Project:** Village Asset Mapping System (Living Digital Village)
**Last Verified Date:** 2026-11-07
**Verification Environment:** Live ArcGIS REST Protocol Probes & Automated Test Suites

---

## 1. Executive Summary

The Village Asset Mapping System ingests authentic GIS infrastructure data to drive procedural 2.5D isometric digital village models.

Sources are classified into:
1. **Tier 1 (Official Government Cadastral Platforms)**:
   - **Gram Manchitra (SOI SVAMITVA)**: Land parcels, residential footprints, and village road boundaries.
   - **SVAMITVA Panchayat Vehicle POC**: Road centerlines with lane widths and buffer polygons.
2. **Tier 2 (Open Supplementary Assets)**:
   - **OpenStreetMap (Overpass API)**: Public amenities (schools, health centers, drinking water, water towers, places of worship).

---

## 2. Source 1: Gram Manchitra (Survey of India SVAMITVA)

### Service Metadata
- **Service Name**: Survey of India (SOI) SVAMITVA Madhya Pradesh MapServer
- **Endpoint**: `https://grammanchitragis.nic.in/grammanchitra/rest/services/SOI_Svamitva/SOI_MP/MapServer`
- **Supported Query Formats**: `JSON, geoJSON, PBF`
- **Native CRS**: `WKID 102100` / `latestWkid 3857` (Web Mercator); native `f=geojson` queries output in `EPSG:4326`.
- **Max Record Count**: `2,000` features per batch.
- **Pagination Support**: Supported via `resultOffset` and `resultRecordCount`, as well as `returnIdsOnly=true`. The connector queries multiple pages dynamically when `exceededTransferLimit=True` to guarantee zero silent truncation.
- **SSL / CA Configuration**: Uses internal NIC India certificate authority. Set `GRAM_MANCHITRA_SSL_VERIFY=False` (or supply custom NIC root CA).

### Layer Catalog
| Layer ID | Layer Name | Geometry Type | Key Attributes | Live Feature Count |
| :--- | :--- | :--- | :--- | :--- |
| **0** | `Road` | `esriGeometryPolygon` | `clr_plot_no`, `soi_plot_area_sqr`, `clr_village_lgd`, `village_name`, `lgd_code`, `road_type`, `st_area(shape)` | Verified |
| **1** | `Built_Up_Area` | `esriGeometryPolygon` | `objectid`, `uniq_id`, `state_code`, `district_code`, `tehsil_code`, `village_code`, `lgd_code`, `village_name`, `built_up_area_type`, `st_area(shape)` | **4,800,902** features |
| **2** | `Parcel_Area` | `esriGeometryPolygon` | `survey_no`, `parcel_type`, `property_id`, `owner_name`, `area_sqm`, `village_name`, `lgd_code`, `st_area(shape)` | Verified |

### Supported Filtering Mechanisms
- **LGD / Village Code**: `(lgd_code = '<CODE>' OR village_code = '<CODE>')`
- **Village Name**: `UPPER(village_name) = '<VILLAGE_NAME>'`
- **Spatial Envelope**: `geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`

---

## 3. Source 2: SVAMITVA Panchayat Vehicle POC Service

### Service Metadata
- **Service Name**: SVAMITVA Panchayat Vehicle POC MapServer
- **Endpoint**: `https://grammanchitragis.nic.in/grammanchitra/rest/services/panchayat/svamitva_POC_Vehicle/MapServer`
- **Supported Query Formats**: `JSON, geoJSON, PBF`
- **Layers**:
  - **Layer 0 (`Road_Centerline`)**: `esriGeometryPolyline` (Fields: `Id`, `Name`, `Type`, `Road_Width`, `Buffer`, `Shape_Length`). Feature count: **1,802** features.
  - **Layer 1 (`Road_Poly`)**: `esriGeometryPolygon` (Fields: `Road_Type`, `Name`, `Road_Width`, `State`, `District`).
- **Query Limitation**:
  - **Verified Fact**: SVAMITVA vehicle layers do not contain `village_code` or `village_name` attribute columns.
  - **Handling**: Must be queried using a spatial bounding box (either user-provided or derived from Gram Manchitra village footprints) or district filter. The API raises an explicit warning if neither is provided.

---

## 4. Source 3: OpenStreetMap (Overpass API)

- **Endpoint**: `https://overpass-api.de/api/interpreter`
- **Query Method**: POST Overpass QL with `(south, west, north, east)` bounding box.
- **Key Categories**:
  - `amenity=school|kindergarten` (Education)
  - `amenity=hospital|clinic|pharmacy` (Healthcare)
  - `man_made=water_tower`, `amenity=drinking_water`, `waterway=*` (Water resources)
  - `highway=*` (Roads, pathways)

---

## 5. Village Acquisition Endpoint (`POST /api/v1/villages/acquire`)

Enables client applications to trigger multi-source ingestion:
- Validates administrative parameters (`state`, `district`, `block`, `gram_panchayat`, `village`, `village_code`).
- Auto-derives bounding box from Gram Manchitra if not provided by user.
- Saves raw responses (`.raw.json`), normalized GeoJSON (`.geojson`), and sidecars (`.meta.json`).
- Delivers a structured `VillageAcquisitionResponse` with partial-failure tolerance.
