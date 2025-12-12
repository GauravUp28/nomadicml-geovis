import os
import pandas as pd
import folium
import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from folium.plugins import MarkerCluster
from dataclasses import dataclass
from nomadicml import NomadicML
from dotenv import load_dotenv

# --- Configuration ---
load_dotenv()

API_KEY = os.getenv("NOMADIC_API_KEY")
if not API_KEY:
    # Fallback or error warning for local testing if env is missing
    print("WARNING: NOMADIC_API_KEY not found in .env file.")

app = FastAPI()

# Enable CORS for local development/testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Data Structures ---
class BatchRequest(BaseModel):
    batchId: str

@dataclass
class GeovisualizerEvent:
    video_id: str
    timestamp_start: str
    latitude_start: float
    longitude_start: float
    latitude_end: float
    longitude_end: float
    description: str
    severity: str
    label: str

# --- Helper Functions ---
VIDEO_CACHE = {}

def get_signed_video_url(video_id: str) -> str:
    """Fetches a temporary signed URL for the video file."""
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
    except Exception as e:
        print(f"Error fetching video URL for {video_id}: {e}")
    return None

def timestamp_to_seconds(time_str: str) -> int:
    """Converts 'MM:SS' format to total seconds."""
    try:
        minutes, seconds = map(int, time_str.split(':'))
        return minutes * 60 + seconds
    except ValueError:
        return 0

def create_base_map(lat=39.8283, lon=-98.5795, zoom=4):
    """Initializes the map with custom tiles, satellite view, and styled controls."""
    
    # 1. Initialize Map with tiles=None to disable default "cartodbpositron"
    m = folium.Map(location=[lat, lon], zoom_start=zoom, tiles=None)

    # 2. Add Base Layers
    # Light Map (Default)
    folium.TileLayer(
        'CartoDB positron',
        name='Light Map',
        control=True
    ).add_to(m)

    # Dark Map
    folium.TileLayer(
        'CartoDB dark_matter',
        name='Dark Map',
        control=True
    ).add_to(m)

    # Satellite Map (Explicitly set overlay=False to act as a base layer radio button)
    folium.TileLayer(
        tiles='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attr='Esri',
        name='Satellite',
        overlay=False,
        control=True
    ).add_to(m)

    # 3. Inject Custom CSS for Larger Control Buttons
    custom_css = """
    <style>
        .leaflet-control-layers {
            border-radius: 8px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3) !important;
            padding: 10px !important;
        }
        .leaflet-control-layers-base label, 
        .leaflet-control-layers-overlays label {
            font-size: 16px !important;
            font-family: sans-serif;
            margin-bottom: 8px !important;
            padding: 5px 0;
            cursor: pointer;
            display: flex;
            align-items: center;
        }
        .leaflet-control-layers-selector {
            width: 20px !important;
            height: 20px !important;
            margin-right: 12px !important;
            cursor: pointer;
        }
        .leaflet-control-layers label:hover {
            background-color: #f0f0f0;
            border-radius: 4px;
        }
    </style>
    """
    m.get_root().html.add_child(folium.Element(custom_css))

    return m

# --- Routes ---

@app.get("/")
async def read_index():
    """Serves the frontend HTML file."""
    return FileResponse('index.html')

@app.get("/api/base-map")
def get_base_map_endpoint():
    """Returns a blank base map for initial load."""
    m = create_base_map()
    folium.LayerControl(collapsed=False).add_to(m)
    return m.get_root().render()

@app.post("/visualize")
async def generate_map(request: BatchRequest):
    """Fetches data from NomadicML and generates the interactive map."""
    try:
        if not request.batchId:
             raise HTTPException(status_code=400, detail="Batch ID is required")

        # 1. Fetch Data
        client = NomadicML(api_key=API_KEY)
        raw_data = client.get_batch_analysis(request.batchId)
        
        # 2. Parse Data
        clean_events = []
        for result in raw_data.get('results', []):
            vid_id = result.get('video_id')
            for event in result.get('events', []):
                overlay = event.get('overlay', {})
                lat_start = overlay.get('frame_gps_lat', {}).get('start')
                lat_end = overlay.get('frame_gps_lat', {}).get('end')
                lon_start = overlay.get('frame_gps_lon', {}).get('start')
                lon_end = overlay.get('frame_gps_lon', {}).get('end')
                
                if all([lat_start, lat_end, lon_start, lon_end]):
                    clean_events.append(GeovisualizerEvent(
                        video_id=vid_id,
                        timestamp_start=event.get('t_start'),
                        latitude_start=float(lat_start),
                        longitude_start=float(lon_start),
                        latitude_end=float(lat_end),
                        longitude_end=float(lon_end),
                        description=event.get('aiAnalysis'),
                        severity=event.get('severity', 'low'),
                        label=event.get('label')
                    ))
        
        df = pd.DataFrame([e.__dict__ for e in clean_events])
        if df.empty:
            raise HTTPException(status_code=404, detail="No GPS events found in batch")

        # 3. Generate Map
        center_lat = df['latitude_start'].mean()
        center_lon = df['longitude_start'].mean()
        
        # Initialize map with custom controls
        m = create_base_map(center_lat, center_lon, zoom=13)
        
        # Named cluster for better UI
        marker_cluster = MarkerCluster(name="Traffic Events").add_to(m)
        
        color_map = {'low': 'blue', 'medium': 'orange', 'high': 'red'}
        all_coords = []

        print(f"Processing {len(df)} events...")

        for _, row in df.iterrows():
            color = color_map.get(row['severity'], 'blue')
            start = [row['latitude_start'], row['longitude_start']]
            end = [row['latitude_end'], row['longitude_end']]
            all_coords.extend([start, end])
            is_moving = start != end

            # Construct HTML Parts
            header = f"""
            <div style="width:340px; font-family:sans-serif;">
                <h4 style="margin-bottom:5px;">{row['label']}</h4>
                <div style="font-size:12px; color:#666; margin-bottom:10px;">
                    <b>Time:</b> {row['timestamp_start']} &bull; 
                    <b>Severity:</b> <span style="color:{color}; font-weight:bold;">{row['severity'].upper()}</span>
                </div>
            """
            
            footer = f"""
                <div style="background:#f9f9f9; padding:8px; border-radius:4px; font-size:12px; border-left: 3px solid {color};">
                    {row['description']}
                </div>
            </div>
            """
            
            video_html = ""
            url = get_signed_video_url(row['video_id'])
            if url:
                sec = timestamp_to_seconds(row['timestamp_start'])
                video_html = f"""
                <div style="margin-top:10px; margin-bottom:10px;">
                    <video width="100%" height="auto" controls style="border-radius:4px; box-shadow:0 2px 4px rgba(0,0,0,0.2);">
                        <source src="{url}#t={sec}" type="video/mp4">
                    </video>
                </div>
                """

            # Combine parts
            popup_with_video = header + video_html + footer
            popup_meta_only = header + footer

            if not is_moving:
                # Stationary: Show Single Marker with Video
                folium.Marker(
                    start, 
                    popup=folium.Popup(popup_with_video, max_width=360), 
                    icon=folium.Icon(color=color, icon='map-marker', prefix='fa')
                ).add_to(marker_cluster)
            else:
                # Moving: Path + Start(Video) + End(Meta)
                folium.PolyLine([start, end], color=color, weight=4, opacity=0.7).add_to(m)
                
                folium.Marker(
                    start, 
                    popup=folium.Popup(popup_with_video, max_width=360), 
                    icon=folium.Icon(color=color, icon='play', prefix='fa')
                ).add_to(marker_cluster)
                
                folium.Marker(
                    end, 
                    popup=folium.Popup(popup_meta_only, max_width=360), 
                    icon=folium.Icon(color='gray', icon='stop', prefix='fa')
                ).add_to(marker_cluster)

        if all_coords: m.fit_bounds(all_coords)
        
        # Add Control Panel at the end so it picks up all layers
        folium.LayerControl(collapsed=False).add_to(m)
        
        return m.get_root().render()

    except Exception as e:
        print(f"Server Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Use the PORT environment variable for Render deployment, default to 8000 locally
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)