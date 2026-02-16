# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GuZhu is an AI-powered image segmentation platform: React/TypeScript frontend + FastAPI/Python backend running SAM (Segment Anything Model). Uses Mapbox GL for interactive map visualization. Supports point-based (SAM 1.0), text-based (SAM3), and automatic (SAM3) segmentation modes. Outputs GeoJSON polygons, supports GeoTIFF input and Shapefile export.

## Development Commands

### Frontend
```bash
cd frontend
npm install              # Install dependencies
npm run dev              # Dev server at http://localhost:3000
npm run build            # TypeScript check + Vite production build
npm run preview          # Preview production build
```

### Backend
```bash
cd backend
source venv/bin/activate                       # Activate venv
pip install -r requirements.txt                # Install dependencies
uvicorn app.main:app --reload --port 8000      # Dev server with auto-reload
curl http://localhost:8000/health               # Verify backend health
```

### Docker
```bash
./build.sh --gpu          # or --cpu
cd docker-images/deploy
./start.sh --gpu up       # or --cpu; also: status, logs, down, restart
```

### Model Setup
- **SAM1**: Download `sam_vit_h_4b8939.pth` from `dl.fbaipublicfiles.com/segment_anything/` to `backend/models/checkpoints/sam_vit_h.pth`
- **SAM3**: Auto-downloads from Hugging Face on first use (~5GB). Requires `HUGGINGFACE_TOKEN` in `backend/.env` and Meta model access approval.

## Architecture

### Data Flow
1. User uploads image (JPEG/PNG or GeoTIFF) → displayed on Mapbox map
2. User triggers segmentation (points, text prompt, or auto) → API call with image + prompts + geographic bounds
3. Backend runs SAM model → binary masks → OpenCV contour detection → polygons
4. `CoordinateConverter` transforms pixel coordinates to geographic (lng/lat) using image bounds
5. GeoJSON FeatureCollection returned → rendered as color-coded Mapbox layers

### Frontend (`frontend/src/`)
- **State management**: All state lifted to `App.tsx`, passed via props (no Redux/Context)
- **Key state**: `detectedObjects`, `selectedObjectId`, `addObjectMode`, `loadingState`, `tiffLayer`
- **Map layers** (bottom to top): base map → GeoTIFF overlay → segmentation polygons → selected glow → point markers
- **API client**: All backend calls in `services/api.ts` using FormData for file uploads
- **Types**: All interfaces in `types/index.ts` (`DetectedObject`, `AddObjectMode`, `LoadingState`, etc.)
- **Styling**: Co-located CSS files per component (not CSS modules), no CSS-in-JS
- **TypeScript**: Strict mode with `noUnusedLocals` and `noUnusedParameters` enabled

### Backend (`backend/`)
- **`app/main.py`**: All FastAPI endpoints (~1200 lines). CORS configured via `CORS_ORIGINS` env var.
- **SAM1** (`models/sam_model.py`): `SAMSegmenter` class with singleton via `get_sam_instance()`. Lazy-loaded on first API call.
- **SAM3** (three backends, tried in priority order):
  1. `models/sam3_transformers.py` - Local Transformers (preferred, fastest)
  2. `models/sam3_hf_api.py` - Hugging Face API (network fallback)
  3. `models/sam3_model.py` - samgeo wrapper (optional)
- **`models/coordinate_converter.py`**: Linear pixel↔geo mapping. Y-axis inverted. Assumes small-area projection. GeoJSON polygon closure handled at line ~72.

### API Endpoints
All segmentation endpoints accept `file`, `bounds` (optional JSON), and `bearing` (float, default 0.0) as FormData:
- `POST /api/segment` - Point-based (SAM1). Additional: `points` (JSON), `min_confidence`, `min_size`, `max_size`
- `POST /api/segment-text` - Text-based (SAM3). Additional: `text_prompt`
- `POST /api/segment-auto` - Automatic (SAM3). Additional: `min_confidence` (default 0.8), `min_size`, `max_size`
- `POST /api/segment-single` - Add one object. Additional: `prompt_type`, `prompt_data` (JSON)
- `POST /api/segment-batch` - Batch points. Additional: `points_list` (JSON array)
- `POST /api/export-shapefile` - Takes JSON body (not FormData), returns ZIP
- `POST /api/upload-tiff` - GeoTIFF → base64 PNG + geographic bounds
- `GET /health` - Returns `{status, sam_loaded, sam3_available}`

All segmentation responses return `{success: bool, geojson: FeatureCollection}` where each Feature has properties: `class`, `segmentation_mode`, `confidence`, `pixel_area`, `bbox`, `thumbnail` (base64).

## Key Technical Details

- **SAM point labels**: 1 = foreground (include), 0 = background (exclude). Returns 3 masks, code selects highest-scoring.
- **Image encoding**: `set_image()` is slow (~2-5s, precomputes embeddings). Subsequent `predict()` calls are fast. Batch operations reuse embeddings.
- **Coordinate systems**: Frontend uses WGS84 geographic coords; SAM operates on pixel coords (0,0 = top-left). Conversion requires bounds from frontend.
- **No test suite or linting** configured for either frontend or backend.
- **Chinese documentation**: README.md, SETUP_SAM3.md, and some code comments are in Chinese.

## Environment Variables
- **Frontend**: `VITE_MAPBOX_TOKEN` in `frontend/.env` (required for map display)
- **Backend**: `HUGGINGFACE_TOKEN` in `backend/.env` (required for SAM3)

## Common Modification Patterns

### Adding a new segmentation mode
1. Add mode to `AddObjectMode` enum in `frontend/src/types/index.ts`
2. Add UI controls in `ControlPanel.tsx`
3. Add map interaction handlers in `MapView.tsx`
4. Create endpoint in `backend/app/main.py` following existing FormData patterns
5. Add API call in `frontend/src/services/api.ts`

### Adding a new export format
Follow `/api/export-shapefile` pattern in `main.py`. Use geopandas for format conversion. Return as `StreamingResponse`.

### Adding object properties
Update `DetectedObject` in `types/index.ts` → update backend response in `main.py` → update `ObjectList.tsx` display.
