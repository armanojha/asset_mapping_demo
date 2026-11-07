# Village Asset Mapping System (Living Digital Village)

A GIS-powered application that converts real-world village geographical data into an interactive, procedurally generated **isometric 2.5D village environment**.

---

## 1. Project Overview

Traditional village mapping systems (such as Gram Manchitra or Bhuvan Yuktdhara) present infrastructure assets as static pins on flat 2D maps. While functional, they lack immersive context, intuitive visualization, and community engagement.

The **Village Asset Mapping System (Living Digital Village)** bridges this gap with a dual-layer approach:
- **Component A — Village Asset Intelligence**: Data collection, GPS positioning, photo verification, infrastructure condition tracking, and asset records.
- **Component B — Interactive Digital Village**: Procedurally generated isometric digital twin of the village where assets (schools, health centers, water tanks, roads) are represented as explorable 3D structures linked to real-world coordinates and records.

---

## 2. Architecture Overview

The system follows a decoupled, modular client-server architecture:

```text
┌────────────────────────────────────────────────────────┐
│               Frontend (Client-side)                   │
│   React + Vite + TypeScript                            │
│   ├── UI Layer: Components & HUD Overlays              │
│   ├── Scene Engine: Three.js / React Three Fiber /     │
│   │                 Drei (Isometric Camera)            │
│   ├── Data Layer: Services, Loaders & Type Contracts   │
│   └── Generators: Procedural Geometry & Tile Pipelines │
└───────────────────────────▲────────────────────────────┘
                            │ REST JSON APIs
                            │ (CORS Enabled)
┌───────────────────────────▼────────────────────────────┐
│               Backend (API Layer)                      │
│   FastAPI + Uvicorn + Pydantic                         │
│   ├── Application Factory (CORS, Error Handlers)       │
│   ├── API Versioning (/api/v1)                         │
│   └── Pydantic Schema Contracts                        │
└───────────────────────────▲────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│          Future Processing & Storage Layers            │
│   - GIS Engine: GeoPandas, Shapely, PyProj, GDAL       │
│   - Database: PostgreSQL + PostGIS                     │
└────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### Backend
- **Framework**: [FastAPI](https://fastapi.tiangolo.com/) (>=0.110.0)
- **ASGI Server**: [Uvicorn](https://www.uvicorn.org/) (>=0.29.0) with standard event loop
- **Data Validation & Settings**: [Pydantic v2](https://docs.pydantic.dev/) and `pydantic-settings`
- **Environment Management**: `python-dotenv`
- **Testing**: [Pytest](https://pytest.org/) & [HTTPX](https://www.python-httpx.org/) (Async ASGI client)

### Frontend
- **Framework**: [React 18](https://react.dev/)
- **Build Tool**: [Vite 5](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (Strict mode)
- **3D Graphics**: [Three.js](https://threejs.org/)
- **3D React Bindings**: [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber) & [@react-three/drei](https://github.com/pmndrs/drei)

### Future GIS & Storage (Phases 1+)
- **GIS Libraries**: GeoPandas, Shapely, PyProj, Rasterio, GDAL/OGR
- **Spatial Database**: PostgreSQL + PostGIS

---

## 4. Project Directory Structure

```text
village-asset-mapping/
│
├── .env.example              # Root environment template
├── .gitignore                # Root gitignore (Python, Node, Data, OS)
├── README.md                 # Project documentation
│
├── assets/                   # Static 3D/2D graphical assets
│   ├── models/               # 3D GLTF/GLB models
│   ├── sprites/              # 2D icons and sprites
│   └── textures/             # Terrain and material textures
│
├── backend/                  # FastAPI backend
│   ├── .env                  # Backend active environment
│   ├── .env.example          # Backend environment template
│   ├── requirements.txt      # Python dependencies
│   ├── app/
│   │   ├── __init__.py
│   │   ├── config.py         # Pydantic Settings configuration
│   │   ├── main.py           # FastAPI application factory
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── v1/
│   │   │       ├── __init__.py
│   │   │       ├── api.py    # Router aggregation
│   │   │       └── endpoints/
│   │   │           ├── __init__.py
│   │   │           └── health.py # Health check route
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   └── health.py     # Health response schema
│   │   └── services/         # Business logic layer
│   │       └── __init__.py
│   └── tests/
│       ├── __init__.py
│       └── test_health.py    # Backend pytest test suite
│
├── data/                     # Geospatial datasets
│   ├── generated/            # Procedural meshes and tile cache
│   ├── processed/            # Cleaned/reprojected geo data
│   └── raw/                  # Original raw survey datasets
│
├── docs/                     # Architectural specs and guides
│
└── frontend/                 # React + Vite + TypeScript frontend
    ├── .env                  # Frontend active environment
    ├── .env.example          # Frontend environment template
    ├── index.html            # Vite entrypoint
    ├── package.json          # Node dependencies and scripts
    ├── tsconfig.json         # TypeScript compiler configuration
    ├── vite.config.ts        # Vite configuration (port 5173)
    ├── public/               # Public static web assets
    └── src/
        ├── App.tsx           # Root application component
        ├── main.tsx          # React DOM entrypoint
        ├── vite-env.d.ts     # Vite environment types
        ├── components/       # Reusable UI components
        │   ├── Header.tsx
        │   └── BackendStatus.tsx
        ├── generators/       # Future procedural world generators
        ├── loaders/          # Future GIS and 3D asset loaders
        ├── scene/            # Future 3D scene & isometric camera
        ├── services/         # API communication services
        │   └── api.ts        # Backend health & REST client
        └── types/            # Shared TypeScript type definitions
            ├── index.ts
            └── health.ts
```

---

## 5. Prerequisites

- **Python**: Version 3.11+ (Python 3.11.9 or 3.14)
- **Node.js**: Version 18+ (Node.js v22.20.0+)
- **npm**: Version 9+ (npm 10.9.3+)
- **PowerShell** or Bash terminal

---

## 6. Backend Installation

```powershell
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows PowerShell:
.\venv\Scripts\activate
# On Linux/macOS:
# source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create local environment file
cp .env.example .env
```

---

## 7. Frontend Installation

```powershell
cd frontend

# Install Node dependencies
npm install

# Create local environment file
cp .env.example .env
```

---

## 8. How to Run Both Applications

### Start Backend (Port 8000)
In terminal 1:
```powershell
cd backend
.\venv\Scripts\activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```
API Health Check: [http://127.0.0.1:8000/api/v1/health](http://127.0.0.1:8000/api/v1/health)
Interactive OpenAPI Docs: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)

### Start Frontend (Port 5173)
In terminal 2:
```powershell
cd frontend
npm run dev
```
Web App: [http://localhost:5173](http://localhost:5173)

---

## 9. How to Run Tests

### Run Backend Tests
```powershell
cd backend
.\venv\Scripts\activate
pytest tests -v
```

### Run Frontend Type Check & Production Build
```powershell
cd frontend
npx tsc --noEmit
npm run build
```

---

## 10. Current Development Phase

**Phase 0: Architecture & Foundation (COMPLETED)**
- [x] Initial workspace scaffold and directory structure.
- [x] Clean modular FastAPI backend with CORS, environment configuration, and `/api/v1` routing.
- [x] Strict Pydantic schema validation for endpoints.
- [x] Pytest suite with HTTPX ASGI client.
- [x] React + Vite + TypeScript frontend scaffold.
- [x] Three.js, React Three Fiber, and Drei integration.
- [x] Dynamic API communication service with graceful error handling and retry mechanism.
- [x] Complete integration verification between Port 8000 and Port 5173.

---

## 11. Upcoming Phases

- **Phase 1: GIS Data Ingestion & Spatial Preprocessing**
  - Parsing GeoJSON / Shapefiles of village boundaries, roads, and structures.
  - Coordinate system projections (WGS84 / EPSG:4326 to UTM / Cartesian local space).
  - Spatial indexing and asset attribute normalization.
- **Phase 2: Procedural 2.5D Isometric World Generation**
  - Ground grid generation and terrain elevation mesh.
  - Procedural road ribbon generation from linestrings.
  - Procedural / instanced 3D building placement (schools, clinics, tanks).
  - Isometric camera controls (pan, zoom, rotate).
- **Phase 3: Interactive Asset Intelligence & Inspection**
  - Raycasting and selection of village structures.
  - Asset information cards (condition, photo, verification status).
  - Search, filter, and asset layer toggles.
- **Phase 4: Persistence, Verification & Community Governance**
  - PostgreSQL + PostGIS integration.
  - Verification workflow for field surveyors and community members.
  - Infrastructure gap analysis and historical progress tracking.
