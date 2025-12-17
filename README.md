# NomadicML Geovisualizer

NomadicML Geovisualizer is a small FastAPI + React/Leaflet app for exploring **NomadicML batch analysis events** on an interactive map.

It turns a batch into a “mini geoguessr”-style workflow: click an event marker, inspect its metadata, and jump straight into the relevant video timestamp.

Live demo (if deployed): https://nomadicml-geovis.onrender.com/

## What You Get

- Map-based browsing of event locations (points) + movement (paths)
- Severity/status styling, basemap switching (light/dark/satellite)
- Timeline playback to “scrub” through events over time
- Heatmap mode for density exploration
- Spatial filtering (draw a polygon/circle to filter events to a region)
- AI text search across loaded events (SentenceTransformers embeddings)
- Video previews inside marker popups (signed URL refresh when needed)
- Mock mode (local CSV) for offline-ish UI testing

## Repo Layout

- `server.py`: FastAPI backend (API + serves `nomadic-client/dist` when present)
- `requirements.txt`: Python dependencies
- `nomadic-client/`: React + Vite frontend
  - `nomadic-client/src/App.jsx`: main UI + data loading/search/filtering
  - `nomadic-client/src/components/*`: map layer, heatmap, timeline, event grid
- `nomadic_data_5_csv.csv`: mock dataset used when the UI is set to “Mock (CSV)”

## Tech Stack

- Backend: Python, FastAPI, Uvicorn
- NomadicML integration: `nomadicml` SDK + `NOMADIC_API_KEY`
- AI search: `sentence-transformers` (`all-MiniLM-L6-v2`) + cosine similarity
- Frontend: React + Vite, TailwindCSS
- Mapping: Leaflet, react-leaflet, leaflet-draw, leaflet.heat

## Prerequisites

- Python 3.10+ (recommended)
- Node.js 18+ (for `nomadic-client/`)

## Configuration

- Backend:
  - `NOMADIC_API_KEY`: required for `source="live"` (read from repo-root `.env`)
  - `PORT`: optional (defaults to `8000`)
- Frontend:
  - `VITE_API_URL`: optional (defaults to `http://localhost:8000`); set in `nomadic-client/.env` for local dev

## Quick Start (Production-Style: One Server)

This is the simplest way to run locally: build the frontend once, then let FastAPI serve the static `dist/` bundle.

1) Install backend dependencies

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2) Configure environment (live mode only)

Create `.env` at the repo root:

```env
NOMADIC_API_KEY=your_api_key_here
```

3) Build the frontend

```bash
cd nomadic-client
npm install
npm run build
cd ..
```

4) Run the server

```bash
python server.py
```

Open: http://localhost:8000

## Dev Workflow (Two Terminals: Vite + API)

Use this if you want hot reload on the frontend.

Terminal A (backend):

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --port 8000
```

Terminal B (frontend):

```bash
cd nomadic-client
npm install
npm run dev
```

The frontend reads the backend base URL from `nomadic-client/.env`:

```env
VITE_API_URL=http://localhost:8000
```

Open the Vite dev URL printed in the terminal (usually http://localhost:5173).

## Using The App

1) Choose a data source:
   - `Live`: loads from NomadicML using `batchId` + `NOMADIC_API_KEY`
   - `Mock (CSV)`: loads from `nomadic_data_5_csv.csv` (no API key required)
2) Click “Visualize” to load events.
3) Optional: draw a polygon/circle on the map to filter to a region.
4) Optional: use “AI Search” to filter events by natural language.
5) Click markers or events in the log to jump the timeline and open video.

## Backend API

Base URL (local): `http://localhost:8000`

### `POST /api/visualize`

Loads a batch (live) or the CSV (mock) and returns a GeoJSON FeatureCollection.

Request body:

```json
{
  "batchId": "…",
  "filter": "all",
  "source": "live"
}
```

Notes:

- `source` is `"live"` or `"mock"`.
- `filter` is `"all"` or a case-insensitive substring match (label/category/query in mock; passed through to the NomadicML SDK in live mode).
- For `"live"` you must pass a real `batchId`.
- For `"mock"` the backend reads `nomadic_data_5_csv.csv` and ignores NomadicML.
- The server computes embeddings in a background task after returning data; AI search becomes available once embeddings finish.

### `POST /api/ai-search`

Returns IDs of events that match a text query using cosine similarity against precomputed embeddings.

Request body:

```json
{ "batchId": "…", "query": "red car near intersection" }
```

Response:

```json
{ "matching_ids": ["…", "…"] }
```

Notes:

- You must call `/api/visualize` first for the same `batchId` (that’s what populates the in-memory embedding cache).
- Similarity threshold is currently hardcoded in `server.py` (search for `cos_scores > 0.50`).

### `POST /api/video-url`

Fetches a fresh signed URL for a NomadicML `videoId`.

Request body:

```json
{ "videoId": "…" }
```

Response:

```json
{ "url": "https://…" }
```

## GeoJSON Schema (What The Frontend Expects)

`/api/visualize` returns a `FeatureCollection` with a mix of:

- `Point`: event start marker
- `LineString`: optional movement path (start → end)

Common `properties` fields used by the UI:

- `id`: event identifier (string)
- `label`: event label (string)
- `severity`: `low | medium | high`
- `status`: `approved | rejected | pending | invalid | unknown`
- `timestamp`: event start time (ms since epoch)
- `timestamp_end`: event end time (ms since epoch)
- `time_str`: original `t_start` value (displayed)
- `description`: AI analysis / description text
- `video_id`: NomadicML video id (live mode)
- `video_url`: signed URL (live mode, may be `null`)
- `video_offset`: start offset in seconds (used for `#t=...` playback)
- `share_link`: (mock mode) link back to NomadicML when no video is available
- `type`: `"point"` or `"path"`

## Mock Data

Mock mode is designed for UI testing without NomadicML access:

- Source: `nomadic_data_5_csv.csv`
- Features are built from the “Frame Gps *” columns and timestamps in the CSV.
- No video is embedded; the UI shows “Open in NomadicML” if a share link exists.

## Caching & State

- Signed video URLs are cached in-memory on the backend (`VIDEO_CACHE`).
- Embeddings are cached in-memory per batch (`BATCH_EMBEDDINGS`, `BATCH_IDS`).
- Restarting the server clears caches; you’ll need to re-run “Visualize”.

## Troubleshooting

- Model download stalls on first run: `sentence-transformers` downloads `all-MiniLM-L6-v2` the first time you start the backend (network required).
- AI search says “Batch data not loaded”: run “Visualize” first (embeddings are computed after load).
- `NOMADIC_API_KEY` missing: live mode requires `.env` with `NOMADIC_API_KEY=...` at repo root.
- Video doesn’t load: signed URLs can expire; clicking the marker triggers `/api/video-url` refresh.

## Deployment Notes

- The backend serves `nomadic-client/dist` when it exists; most deployments build the frontend during CI and ship the built `dist/`.
- Set `NOMADIC_API_KEY` in your hosting provider’s environment variables (don’t commit it).
- Set `PORT` if your host requires it (e.g., Render/Heroku-style platforms).
