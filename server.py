'''
import os
import requests
import uuid
import torch
import pandas as pd
from fastapi import FastAPI, HTTPException
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

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- AI Configuration ---
print("Loading AI Model...")
model = SentenceTransformer('all-MiniLM-L6-v2') 

# --- GLOBAL STORAGE ---
BATCH_EMBEDDINGS = {}
BATCH_IDS = {}
BATCH_DATA = {} 

# --- Models ---
class BatchRequest(BaseModel):
    batchId: str
    filter: Optional[str] = "all"

class VideoRequest(BaseModel):
    videoId: str

class SearchRequest(BaseModel):
    batchId: str
    query: str

# --- Helpers ---
VIDEO_CACHE = {}

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

# --- API Endpoints ---

@app.post("/api/visualize")
async def get_geojson_data(request: BatchRequest):
    try:
        # --- MOCK DATA MODE (Using CSV) ---
        print(f"Loading mock data from CSV for batch {request.batchId}...")
        
        if not os.path.exists("mock_nomadic_data.csv"):
            raise HTTPException(404, "mock_nomadic_data.csv not found on server")

        # Read CSV
        df = pd.read_csv("mock_nomadic_data.csv")
        
        if request.filter and request.filter.lower() != "all":
            df = df[df['Label'].str.contains(request.filter, case=False, na=False)]

        features = []
        
        for _, row in df.iterrows():
            try:
                lat_start = float(row['Frame Gps Lat Start'])
                lon_start = float(row['Frame Gps Lon Start'])
                lat_end = float(row['Frame Gps Lat End'])
                lon_end = float(row['Frame Gps Lon End'])
            except ValueError:
                continue 

            raw_timestamp = str(row['Timestamp'])
            t_start_str = raw_timestamp.split('–')[0] if '–' in raw_timestamp else "0:00"
            ts_start = convert_to_iso_time(t_start_str)
            ts_end = convert_to_iso_time(t_start_str, default_duration_sec=15)

            props = {
                "id": str(uuid.uuid4()),
                "label": row['Label'],
                "severity": str(row['Severity']).lower(),
                "status": "approved",
                "time_str": t_start_str,
                "timestamp": ts_start,
                "timestamp_end": ts_end,
                "description": f"{row['Category']} - {row['Label']}",
                "video_id": row['Video ID'],
                "video_url": row['Share Link'], 
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
                    "geometry": { "type": "LineString", "coordinates": [[lon_start, lat_start], [lon_end, lat_end]] },
                    "properties": {**props, "type": "path"}
                })

        if features:
            print(f"Computing AI Embeddings for {len(features)} mock features...")
            texts = [
                f"{f['properties']['label']} {f['properties']['description']} {f['properties']['severity']}"
                for f in features
            ]
            embeddings = model.encode(texts, convert_to_tensor=True)
            
            BATCH_EMBEDDINGS[request.batchId] = embeddings
            BATCH_IDS[request.batchId] = [f['properties']['id'] for f in features]
            BATCH_DATA[request.batchId] = { "features": features }

        return { "type": "FeatureCollection", "features": features }

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ai-search")
async def ai_search(request: SearchRequest):
    try:
        if request.batchId not in BATCH_EMBEDDINGS:
            raise HTTPException(status_code=404, detail="Batch data not loaded. Please click Visualize first.")

        # 1. Convert Query to Vector
        query_embedding = model.encode(request.query, convert_to_tensor=True)
        
        # 2. Calculate Similarity Scores
        cos_scores = util.cos_sim(query_embedding, BATCH_EMBEDDINGS[request.batchId])[0]
        
        # 3. Filter by Threshold (0.20 for fuzzy matches)
        top_results = torch.where(cos_scores > 0.20)[0]
        
        # 4. Limit total candidates to 100 to prevent overload
        if len(top_results) > 100:
             top_k_values, top_k_indices = torch.topk(cos_scores, k=100)
             top_results = top_k_indices

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
else:
    print(f"⚠️ WARNING: React build not found at '{client_dist_path}'.")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
'''
import os
import requests
import uuid
import torch
import pandas as pd
from fastapi import FastAPI, HTTPException
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
    batchId: str
    filter: Optional[str] = "all"

class VideoRequest(BaseModel):
    videoId: str

class SearchRequest(BaseModel):
    batchId: str
    query: str

VIDEO_CACHE = {}

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

@app.post("/api/visualize")
async def get_geojson_data(request: BatchRequest):
    try:
        print(f"Loading mock data from CSV for batch {request.batchId}...")
        
        if not os.path.exists("nomadic_data_5_csv.csv"):
            raise HTTPException(404, "nomadic_data_5_csv.csv not found on server")

        df = pd.read_csv("nomadic_data_5_csv.csv")
        
        if request.filter and request.filter.lower() != "all":
            df = df[df['Label'].str.contains(request.filter, case=False, na=False)]

        features = []
        skipped_count = 0 # Track skipped rows
        
        for index, row in df.iterrows():
            try:
                # Basic Validation: Ensure Lat/Lon exists
                if pd.isna(row['Frame Gps Lat Start']) or pd.isna(row['Frame Gps Lon Start']):
                    skipped_count += 1
                    continue

                lat_start = float(row['Frame Gps Lat Start'])
                lon_start = float(row['Frame Gps Lon Start'])
                lat_end = float(row['Frame Gps Lat End'])
                lon_end = float(row['Frame Gps Lon End'])
            except ValueError:
                skipped_count += 1
                continue 

            raw_timestamp = str(row['Timestamp'])
            t_start_str = raw_timestamp.split('–')[0] if '–' in raw_timestamp else "0:00"
            ts_start = convert_to_iso_time(t_start_str)
            ts_end = convert_to_iso_time(t_start_str, default_duration_sec=15)

            props = {
                "id": str(uuid.uuid4()),
                "label": str(row['Label']),
                "severity": str(row['Severity']).lower(),
                "status": "approved",
                "time_str": t_start_str,
                "timestamp": ts_start,
                "timestamp_end": ts_end,
                "description": f"{row['Category']} - {row['Label']}",
                "video_id": row['Video ID'],
                "video_url": row['Share Link'], 
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
                    "geometry": { "type": "LineString", "coordinates": [[lon_start, lat_start], [lon_end, lat_end]] },
                    "properties": {**props, "type": "path"}
                })

        # REPORT: Check your terminal to see if rows were dropped
        print(f"✅ Loaded {len(features)} features.")
        print(f"⚠️ Skipped {skipped_count} rows due to invalid/missing GPS data.")

        if features:
            print(f"Computing embeddings...")
            texts = [
                f"{f['properties']['label']} {f['properties']['description']}"
                for f in features
            ]
            embeddings = model.encode(texts, convert_to_tensor=True)
            BATCH_EMBEDDINGS[request.batchId] = embeddings
            BATCH_IDS[request.batchId] = [f['properties']['id'] for f in features]
            BATCH_DATA[request.batchId] = { "features": features }

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