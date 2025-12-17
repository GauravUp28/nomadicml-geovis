import os
import asyncio
import requests
import uuid
import torch
import pandas as pd
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from nomadicml import NomadicML
from dotenv import load_dotenv
from typing import Optional
from datetime import datetime, timedelta
from sentence_transformers import SentenceTransformer, util

# --- Configuration ---
load_dotenv()
API_KEY = os.getenv("NOMADIC_API_KEY")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Loading AI Model...")
model = SentenceTransformer('all-MiniLM-L6-v2') 

BATCH_EMBEDDINGS = {}
BATCH_IDS = {}
BATCH_DATA = {} 

class BatchRequest(BaseModel):
    batchId: Optional[str] = ""
    filter: Optional[str] = "all"
    source: Optional[str] = "live"  # "live" (NomadicML) | "mock" (local CSV)

class VideoRequest(BaseModel):
    videoId: str

class SearchRequest(BaseModel):
    batchId: str
    query: str

VIDEO_CACHE = {}
MOCK_CSV_PATH = Path(__file__).parent / "nomadic_data_5_csv.csv"
MOCK_DF = None

def get_signed_video_url(video_id: str, force_refresh: bool = False) -> str:
    if not force_refresh and video_id in VIDEO_CACHE: 
        return VIDEO_CACHE[video_id]
    
    url = f"https://api-prod.nomadicml.com/api/video/{video_id}/signed-url"
    headers = {"x-api-key": API_KEY}
    try:
        response = requests.post(url, json={"method": "GET"}, headers=headers)
        response.raise_for_status()
        data = response.json()
        if data.get("url"):
            VIDEO_CACHE[video_id] = data["url"]
            return data["url"]
    except Exception as e:
        print(f"Error fetching video URL: {e}")
        return None

def timestamp_to_seconds(time_str: str) -> int:
    try:
        minutes, seconds = map(int, time_str.split(':'))
        return minutes * 60 + seconds
    except:
        return 0

def convert_to_iso_time(time_str: str, default_duration_sec: int = 0) -> int:
    try:
        if not time_str: return 0
        seconds = timestamp_to_seconds(time_str)
        base_time = datetime(2025, 1, 1, 12, 0, 0)
        event_time = base_time + timedelta(seconds=seconds + default_duration_sec)
        return int(event_time.timestamp() * 1000)
    except:
        return 0

# Helper task (Must be defined before use or globally accessible)
def compute_embeddings_task(batch_id, features):
    print(f"Background: Computing embeddings for batch {batch_id}...")
    texts = [
        f"{f['properties']['label']} {f['properties']['description']} {f['properties']['severity']}"
        for f in features
    ]
    embeddings = model.encode(texts, convert_to_tensor=True)
    BATCH_EMBEDDINGS[batch_id] = embeddings
    BATCH_IDS[batch_id] = [f['properties']['id'] for f in features]
    BATCH_DATA[batch_id] = { "features": features }

def _get_mock_df() -> pd.DataFrame:
    global MOCK_DF
    if MOCK_DF is not None:
        return MOCK_DF
    if not MOCK_CSV_PATH.exists():
        raise FileNotFoundError(f"Mock CSV not found at {MOCK_CSV_PATH}")
    MOCK_DF = pd.read_csv(MOCK_CSV_PATH)
    return MOCK_DF

def _parse_mock_timestamp_range(value: str) -> tuple[int, int]:
    if not value:
        return 0, 0
    parts = str(value).replace("-", "–").split("–", 1)
    start_str = parts[0].strip()
    end_str = parts[1].strip() if len(parts) > 1 else start_str
    return timestamp_to_seconds(start_str), timestamp_to_seconds(end_str)

def _mock_features(filter_text: Optional[str]) -> list[dict]:
    df = _get_mock_df()
    if filter_text and filter_text.lower() != "all":
        needle = filter_text.lower()
        mask = (
            df["Label"].astype(str).str.lower().str.contains(needle, na=False)
            | df["Category"].astype(str).str.lower().str.contains(needle, na=False)
            | df["Query"].astype(str).str.lower().str.contains(needle, na=False)
        )
        df = df[mask]

    features: list[dict] = []
    for row in df.to_dict(orient="records"):
        try:
            lat_start = float(row.get("Frame Gps Lat Start"))
            lon_start = float(row.get("Frame Gps Lon Start"))
        except (TypeError, ValueError):
            continue

        try:
            lat_end = float(row.get("Frame Gps Lat End"))
            lon_end = float(row.get("Frame Gps Lon End"))
        except (TypeError, ValueError):
            lat_end, lon_end = lat_start, lon_start

        ts_start = int(float(row.get("unix_timestamp_start", 0)) * 1000)
        ts_end = int(float(row.get("unix_timestamp_end", 0)) * 1000) or ts_start
        if ts_end < ts_start:
            ts_end = ts_start

        ts_range = row.get("Timestamp")
        offset_start, _offset_end = _parse_mock_timestamp_range(ts_range)

        props = {
            "id": str(row.get("Analysis ID") or uuid.uuid4()),
            "label": row.get("Label"),
            "severity": str(row.get("Severity") or "low").lower(),
            "status": row.get("Approval Status", "Unknown"),
            "time_str": ts_range,
            "timestamp": ts_start,
            "timestamp_end": ts_end,
            "description": f"{row.get('Query', '')} ({row.get('Category', '')})".strip(),
            "category": row.get("Category"),
            "video_id": None,
            "video_url": None,
            "video_offset": offset_start,
            "is_moving": (lat_start != lat_end) or (lon_start != lon_end),
            "share_link": row.get("Share Link"),
        }

        features.append({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [lon_start, lat_start] },
            "properties": {**props, "type": "point"}
        })

        if props["is_moving"]:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": [[lon_start, lat_start], [lon_end, lat_end]]
                },
                "properties": {**props, "type": "path"}
            })

    return features

@app.post("/api/visualize")
async def get_geojson_data(request: BatchRequest, background_tasks: BackgroundTasks):
    try:
        source = (request.source or "live").lower()
        batch_id = request.batchId or ("mock" if source == "mock" else "")

        if source == "mock":
            features = _mock_features(request.filter)
            if features:
                background_tasks.add_task(compute_embeddings_task, batch_id, features)
            return { "type": "FeatureCollection", "features": features }

        if not request.batchId:
            raise HTTPException(status_code=400, detail="batchId is required for live source")

        if not API_KEY:
            raise HTTPException(500, "API Key missing")
        client = NomadicML(api_key=API_KEY)
        
        # 1. Fetch Raw Data (Blocking I/O offloaded to thread)
        loop = asyncio.get_event_loop()
        print(f"Fetching batch {request.batchId}...")
        
        raw_data = await loop.run_in_executor(
            None, 
            lambda: client.get_batch_analysis(
                request.batchId, 
                filter=request.filter.lower() if request.filter and request.filter.lower() != "all" else None
            )
        )

        features = []
        unique_video_ids = {r.get('video_id') for r in raw_data.get('results', []) if r.get('video_id')}

        # 2. Parallel Fetch of Signed URLs
        # We wrap the synchronous 'get_signed_video_url' in run_in_executor so it doesn't block
        async def fetch_url_safe(vid):
            url = await loop.run_in_executor(None, lambda: get_signed_video_url(vid))
            return vid, url

        if unique_video_ids:
            # Run all fetches in parallel
            url_results = await asyncio.gather(*(fetch_url_safe(vid) for vid in unique_video_ids))
            url_cache = dict(url_results)
        else:
            url_cache = {}

        # 3. Process Results (CPU work)
        for result in raw_data.get('results', []):
            vid_id = result.get('video_id')
            video_url = url_cache.get(vid_id)
            
            for event in result.get('events', []):
                overlay = event.get('overlay', {})
                try:
                    lat_start = float(overlay['frame_gps_lat']['start'])
                    lon_start = float(overlay['frame_gps_lon']['start'])
                    lat_end = float(overlay['frame_gps_lat']['end'])
                    lon_end = float(overlay['frame_gps_lon']['end'])
                except (KeyError, ValueError, TypeError):
                    continue 

                t_start_str = event.get('t_start')
                t_end_str = event.get('t_end')
                ts_start = convert_to_iso_time(t_start_str)
                
                if t_end_str and t_end_str != t_start_str:
                    ts_end = convert_to_iso_time(t_end_str)
                else:
                    ts_end = convert_to_iso_time(t_start_str, default_duration_sec=5)

                props = {
                    "id": str(uuid.uuid4()),
                    "label": event.get('label'),
                    "severity": event.get('severity', 'low'),
                    "status": event.get('approval', 'Unknown'),
                    "time_str": t_start_str,
                    "timestamp": ts_start,
                    "timestamp_end": ts_end,
                    "description": event.get('aiAnalysis'),
                    "video_id": vid_id, 
                    "video_url": video_url,
                    "video_offset": timestamp_to_seconds(t_start_str),
                    "is_moving": (lat_start != lat_end)
                }

                features.append({
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [lon_start, lat_start] },
                    "properties": {**props, "type": "point"}
                })

                if props["is_moving"]:
                    features.append({
                        "type": "Feature",
                        "geometry": { 
                            "type": "LineString", 
                            "coordinates": [[lon_start, lat_start], [lon_end, lat_end]] 
                        },
                        "properties": {**props, "type": "path"}
                    })

        # 4. Offload Embeddings to Background Task
        if features:
            background_tasks.add_task(compute_embeddings_task, request.batchId, features)

        return { "type": "FeatureCollection", "features": features }

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai-search")
async def ai_search(request: SearchRequest):
    try:
        if request.batchId not in BATCH_EMBEDDINGS:
            raise HTTPException(status_code=404, detail="Batch data not loaded.")

        query_embedding = model.encode(request.query, convert_to_tensor=True)
        cos_scores = util.cos_sim(query_embedding, BATCH_EMBEDDINGS[request.batchId])[0]
        
        top_results = torch.where(cos_scores > 0.50)[0]

        matching_ids = []
        seen_ids = set()

        for i in top_results.tolist():
            vid = BATCH_IDS[request.batchId][i]
            if vid not in seen_ids:
                matching_ids.append(vid)
                seen_ids.add(vid)
        
        return { "matching_ids": matching_ids }

    except Exception as e:
        print(f"Search Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/video-url")
async def refresh_video_url(request: VideoRequest):
    try:
        url = get_signed_video_url(request.videoId, force_refresh=True)
        if not url:
            raise HTTPException(status_code=404, detail="Video not found")
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- Serve React Frontend ---
client_dist_path = "nomadic-client/dist"

if os.path.exists(client_dist_path):
    app.mount("/", StaticFiles(directory=client_dist_path, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
