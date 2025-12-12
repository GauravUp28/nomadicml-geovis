import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, LayersControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapLayer from './components/MapLayer';
import TimelineControls from './components/TimelineControls';
import EventGrid from './components/EventGrid';

const AutoFitBounds = ({ data }) => {
  const map = useMap();
  useEffect(() => {
    if (!data || !data.features || data.features.length === 0) return;
    const latLngs = [];
    data.features.forEach(f => {
      if (f.geometry.type === 'Point') {
        latLngs.push([f.geometry.coordinates[1], f.geometry.coordinates[0]]);
      } else if (f.geometry.type === 'LineString') {
        f.geometry.coordinates.forEach(coord => latLngs.push([coord[1], coord[0]]));
      }
    });
    if (latLngs.length > 0) {
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  }, [data, map]);
  return null;
};

function App() {
  const [batchId, setBatchId] = useState('');
  const [filter, setFilter] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [recentBatches, setRecentBatches] = useState([]);

  const [currentTime, setCurrentTime] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(2); 
  const [hasInteracted, setHasInteracted] = useState(false);
  
  // Initialize as null so no event is selected by default
  const [selectedId, setSelectedId] = useState(null);
  
  const playInterval = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem('nomadic_batch_history');
    if (saved) {
      try { setRecentBatches(JSON.parse(saved)); } catch (e) { console.error(e); }
    }
  }, []);

  const addToHistory = (id) => {
    if (!id) return;
    const newHistory = [id, ...recentBatches.filter(item => item !== id)].slice(0, 10);
    setRecentBatches(newHistory);
    localStorage.setItem('nomadic_batch_history', JSON.stringify(newHistory));
  };

  const handleVisualize = async () => {
    if (!batchId) return alert("Please enter a Batch ID");
    setLoading(true);
    setHasInteracted(false);
    
    // 1. Reset selection immediately when starting a new search
    setSelectedId(null); 
    
    const API_URL = 'http://localhost:8000'; 
    
    try {
      const res = await fetch(`${API_URL}/api/visualize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, filter })
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      const geoJson = await res.json();
      
      const features = geoJson.features.sort((a,b) => a.properties.timestamp - b.properties.timestamp);
      if (features.length > 0) {
        const start = features[0].properties.timestamp;
        const lastEvent = features[features.length - 1];
        const end = (lastEvent.properties.timestamp_end || lastEvent.properties.timestamp) + 2000;
        
        setStartTime(start);
        setEndTime(end);
        setCurrentTime(start);
        setData(geoJson);
        addToHistory(batchId);
        
        // --- FIX: DO NOT SET selectedId HERE ---
        // By leaving this out, the map loads without popping up any video.
      } else {
        alert("No events found.");
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEventClick = (id, time) => {
    setHasInteracted(true);
    setCurrentTime(time);
    setSelectedId(id);
  };

  const handleSeek = (t) => {
    setHasInteracted(true);
    setCurrentTime(t);
  };

  useEffect(() => {
    if (!data) return;
    const activeEvents = data.features.filter(f => 
      currentTime >= f.properties.timestamp && 
      currentTime <= f.properties.timestamp_end
    );

    if (activeEvents.length > 0) {
      const isSelectedStillActive = activeEvents.some(f => f.properties.id === selectedId);
      
      if (!isSelectedStillActive) {
        // --- FIX: Only auto-select if user is actively PLAYING ---
        // If simply scrubbing or loading, we do NOT auto-select.
        if (isPlaying) {
             setSelectedId(activeEvents[0].properties.id);
        }
      }
    } else {
      // If time passes and no event is active, clear the selection
      setSelectedId(null);
    }
  }, [currentTime, data, isPlaying]); // Added isPlaying dependency

  useEffect(() => {
    if (isPlaying) {
      playInterval.current = setInterval(() => {
        setCurrentTime(prev => {
          if (prev >= endTime) {
            setIsPlaying(false);
            return startTime;
          }
          return prev + (100 * playbackSpeed); 
        });
      }, 100);
    } else {
      clearInterval(playInterval.current);
    }
    return () => clearInterval(playInterval.current);
  }, [isPlaying, endTime, startTime, playbackSpeed]);

  const eventList = data ? data.features.filter(f => f.geometry.type === 'Point') : [];

  return (
    <div className="flex flex-col h-screen bg-slate-100 overflow-hidden">
      
      <div className="bg-white shadow-sm p-4 z-[2000] relative shrink-0">
        <div className="max-w-full mx-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <h1 className="text-xl font-bold text-slate-800">NomadicML <span className="text-blue-600">Geovisualizer</span></h1>
          <div className="flex gap-2 w-full max-w-2xl items-center">
             <details className="relative">
              <summary className="list-none bg-white border border-slate-300 text-slate-600 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-50 text-sm font-medium select-none transition-colors">🕒</summary>
              <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-[5000]">
                {recentBatches.map(id => (
                  <button key={id} onClick={() => { setBatchId(id); document.querySelector('details[open]').removeAttribute('open'); }} className="w-full text-left px-4 py-2.5 text-xs font-mono text-slate-600 hover:bg-blue-50 hover:text-blue-700 truncate border-b border-slate-50 last:border-0">{id}</button>
                ))}
              </div>
            </details>
            <input value={batchId} onChange={(e) => setBatchId(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" placeholder="Enter Batch ID..." />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="border border-slate-300 rounded-lg px-4 py-2 bg-white text-sm outline-none">
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="invalid">Invalid</option>
            </select>
            <button onClick={handleVisualize} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-lg text-sm disabled:opacity-50">{loading ? 'Loading...' : 'Visualize'}</button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 relative h-full">
          <MapContainer center={[39.8283, -98.5795]} zoom={4} zoomControl={false} style={{ height: "100%", width: "100%" }}>
              <LayersControl position="topright">
                <LayersControl.BaseLayer name="Dark Mode"><TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='CartoDB' /></LayersControl.BaseLayer>
                <LayersControl.BaseLayer checked name="Light Mode"><TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution='CartoDB' /></LayersControl.BaseLayer>
                <LayersControl.BaseLayer name="Satellite"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution='Esri' /></LayersControl.BaseLayer>
              </LayersControl>
              
              {data && (
                <MapLayer 
                  data={data} 
                  currentTime={currentTime} 
                  showAll={!hasInteracted} 
                  selectedId={selectedId} 
                />
              )}
              
              {data && <AutoFitBounds data={data} />}
          </MapContainer>
          {data && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-[90%] z-[1000]">
              <TimelineControls 
                startTime={startTime} endTime={endTime} currentTime={currentTime} isPlaying={isPlaying}
                playbackSpeed={playbackSpeed}
                onPlayPause={() => { setHasInteracted(true); setIsPlaying(!isPlaying); }}
                onSeek={handleSeek}
                onReset={() => { setIsPlaying(false); setCurrentTime(startTime); setHasInteracted(false); }}
                onSpeedChange={setPlaybackSpeed}
              />
            </div>
          )}
        </div>
        {data && (
          <div className="w-[350px] shrink-0 h-full relative transition-all duration-300 ease-in-out">
            <EventGrid 
              events={eventList} 
              currentTime={currentTime} 
              selectedId={selectedId} 
              onEventClick={handleEventClick} 
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;