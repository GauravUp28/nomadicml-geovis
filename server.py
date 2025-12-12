import os
import requests
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from nomadicml import NomadicML
from dotenv import load_dotenv
from typing import Optional
from datetime import datetime, timedelta

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

# --- Models ---
class BatchRequest(BaseModel):
    batchId: str
    filter: Optional[str] = "all"

# --- Helpers ---
VIDEO_CACHE = {}

def get_signed_video_url(video_id: str) -> str:
    if video_id in VIDEO_CACHE: return VIDEO_CACHE[video_id]
    
    url = f"https://api-prod.nomadicml.com/api/video/{video_id}/signed-url"
    headers = {"x-api-key": API_KEY}
    try:
        response = requests.post(url, json={"method": "GET"}, headers=headers)
        response.raise_for_status()
        data = response.json()
        if data.get("url"):
            VIDEO_CACHE[video_id] = data["url"]
            return data["url"]
    except:
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
        if not API_KEY: raise HTTPException(500, "API Key missing")
        
        client = NomadicML(api_key=API_KEY)
        
        # 1. Fetch from SDK
        print(f"Fetching batch {request.batchId} (Filter: {request.filter})")
        if request.filter and request.filter.lower() != "all":
            raw_data = client.get_batch_analysis(request.batchId, filter=request.filter.lower())
        else:
            raw_data = client.get_batch_analysis(request.batchId)
        
        # 2. Transform to GeoJSON
        features = []
        
        for result in raw_data.get('results', []):
            vid_id = result.get('video_id')
            video_url = get_signed_video_url(vid_id)
            
            for event in result.get('events', []):
                overlay = event.get('overlay', {})
                try:
                    lat_start = float(overlay['frame_gps_lat']['start'])
                    lon_start = float(overlay['frame_gps_lon']['start'])
                    lat_end = float(overlay['frame_gps_lat']['end'])
                    lon_end = float(overlay['frame_gps_lon']['end'])
                except:
                    continue

                # Time Logic
                t_start_str = event.get('t_start')
                t_end_str = event.get('t_end')

                ts_start = convert_to_iso_time(t_start_str)
                if t_end_str and t_end_str != t_start_str:
                    ts_end = convert_to_iso_time(t_end_str)
                else:
                    ts_end = convert_to_iso_time(t_start_str, default_duration_sec=5)

                props = {
                    "label": event.get('label'),
                    "severity": event.get('severity', 'low'),
                    "status": event.get('approval', 'Unknown'),
                    "time_str": t_start_str,
                    "timestamp": ts_start,
                    "timestamp_end": ts_end,
                    "description": event.get('aiAnalysis'),
                    "video_url": video_url,
                    "video_offset": timestamp_to_seconds(t_start_str),
                    "is_moving": (lat_start != lat_end)
                }

                # Create Point Feature
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [lon_start, lat_start]
                    },
                    "properties": {**props, "type": "point"}
                })

                # Create Path Feature (if moving)
                if props["is_moving"]:
                    features.append({
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[lon_start, lat_start], [lon_end, lat_end]]
                        },
                        "properties": {**props, "type": "path"}
                    })

        return { "type": "FeatureCollection", "features": features }

    except Exception as e:
        print(f"Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- Serve React Frontend ---
# This looks for the 'dist' folder inside 'nomadic-client'
client_dist_path = "nomadic-client/dist"

if os.path.exists(client_dist_path):
    app.mount("/", StaticFiles(directory=client_dist_path, html=True), name="static")
else:
    print(f"⚠️ WARNING: React build not found at '{client_dist_path}'.")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)