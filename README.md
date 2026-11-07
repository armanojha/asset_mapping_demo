# Village Asset Mapping System (Living Digital Village)

A GIS-powered application that converts real-world village geographical data into an interactive, procedurally generated isometric 2.5D village environment.

## Architecture

- **Backend**: Python, FastAPI, Pydantic, Uvicorn, Pytest
- **Frontend**: React, Vite, TypeScript, Three.js, React Three Fiber (@react-three/fiber), Drei (@react-three/drei)
- **GIS Processing (Planned)**: GeoPandas, Shapely, PyProj, Rasterio, GDAL/OGR
- **Data Storage (Planned)**: PostgreSQL + PostGIS

## Current Status: Phase 0

Phase 0 sets up the foundational directory skeleton, configuration templates, baseline types, and verification test suites. No functional GIS processing, map rendering, 3D world generation, or database models are implemented in this phase.

## Quickstart

### Backend Setup
```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
# source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env
pytest
uvicorn app.main:app --reload --port 8000
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
