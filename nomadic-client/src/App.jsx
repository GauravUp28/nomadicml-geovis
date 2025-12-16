import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, LayersControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// --- Fix for Leaflet-Draw in Vite/React ---
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
window.L = L; // Important: Helper to ensure leaflet-draw finds the L namespace
// ------------------------------------------

import MapLayer from './components/MapLayer';
import TimelineControls from './components/TimelineControls';
import EventGrid from './components/EventGrid';
import HeatmapLayer from './components/HeatmapLayer'; 
import { Flame, Search, X, Loader2 } from 'lucide-react';

// --- Custom Draw Control Component ---
const DrawControl = React.memo(({ onCreated, onDeleted, onEdited }) => {
  const map = useMap();
  const drawnItemsRef = useRef(new L.FeatureGroup());

  useEffect(() => {
    const drawnItems = drawnItemsRef.current;
    map.addLayer(drawnItems);

    // Initialize the Draw Control
    const drawControl = new L.Control.Draw({
      edit: {
        featureGroup: drawnItems,
        remove: true,
        edit: {}, // Enable Edit Mode
      },
      draw: {
        marker: false,
        circlemarker: false,
        polyline: false,
        polygon: true,    // Enable Polygon
        rectangle: false, // Disable Rectangle (Buggy in some versions)
        circle: true,     // Enable Circle
      },
    });

    map.addControl(drawControl);

    // Event Handlers
    const handleCreated = (e) => {
      const layer = e.layer;
      drawnItems.clearLayers(); // Single shape mode
      drawnItems.addLayer(layer);
      if (onCreated) onCreated(layer);
    };

    const handleDeleted = () => {
      if (onDeleted) onDeleted();
    };

    const handleEdited = () => {
      if (onEdited) onEdited();
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.DELETED, handleDeleted);
    map.on(L.Draw.Event.EDITED, handleEdited);

    return () => {
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.DELETED, handleDeleted);
      map.off(L.Draw.Event.EDITED, handleEdited);
    };
  }, [map, onCreated, onDeleted, onEdited]);

  return null;
});

// --- Geometry Helper ---
const isPointInLayer = (lat, lng, layer) => {
  if (!layer) return true;
  
  // 1. Precise Circle Check (Distance <= Radius in meters)
  if (layer instanceof L.Circle) {
    const center = layer.getLatLng();
    const radius = layer.getRadius();
    return center.distanceTo([lat, lng]) <= radius;
  }
  
  // 2. Polygon Check (Ray-Casting Algorithm)
  if (layer instanceof L.Polygon) {
    const poly = layer.getLatLngs()[0]; // Assumes simple polygon
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i].lat, yi = poly[i].lng;
        const xj = poly[j].lat, yj = poly[j].lng;
        const intersect = ((yi > lng) !== (yj > lng)) &&
            (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
  }
  return true;
};

// --- Auto Fit Bounds (Smart Version) ---
const AutoFitBounds = ({ data, disableZoom }) => {
  const map = useMap();
  useEffect(() => {
    // Don't auto-zoom if the user is actively using a spatial filter
    if (disableZoom) return; 

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
  }, [data, map, disableZoom]);
  return null;
};

const filterFeaturesBySpatialLayer = (features, layer) => {
  if (!layer) return features;
  return features.filter(f => {
    if (f.geometry.type !== 'Point') return false;
    const [lng, lat] = f.geometry.coordinates;
    return isPointInLayer(lat, lng, layer);
  });
};

function App() {
  const [batchId, setBatchId] = useState('');
  const [filter, setFilter] = useState('all');
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  
  // 1. Filtered Data (Batch + AI Search)
  const [filteredData, setFilteredData] = useState(null); 
  const [searchResults, setSearchResults] = useState(null); // cache latest AI search IDs
  
  const [spatialLayer, setSpatialLayer] = useState(null);
  const [shapeVersion, setShapeVersion] = useState(0); 

  const [data, setData] = useState(null); // Raw Batch Data
  const [loading, setLoading] = useState(false);
  const [recentBatches, setRecentBatches] = useState([]);
  const [showHeatmap, setShowHeatmap] = useState(false);

  const [currentTime, setCurrentTime] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [hasInteracted, setHasInteracted] = useState(false);
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

  // --- Stable Handlers (Prevents Flicker on Search) ---
  const onCreated = useCallback((layer) => {
    setSpatialLayer(layer);
    setShapeVersion(v => v + 1);
  }, []);

  const onDeleted = useCallback(() => {
    setSpatialLayer(null);
    setShapeVersion(v => v + 1);
  }, []);

  const onEdited = useCallback(() => {
    setShapeVersion(v => v + 1);
  }, []);

  // --- Compute Final Data (Batch + Search + Spatial) ---
  const displayedData = useMemo(() => {
    if (!filteredData) return null;
    
    // If no spatial filter, return search results as is
    if (!spatialLayer) return filteredData;

    // INTERSECTION LOGIC: Search Results AND Spatial Filter
    const visibleIds = new Set();
    filteredData.features.forEach(f => {
        if (f.geometry.type === 'Point') {
            const [lng, lat] = f.geometry.coordinates;
            if (isPointInLayer(lat, lng, spatialLayer)) {
                visibleIds.add(f.properties.id);
            }
        }
    });

    // Filter the features
    const features = filteredData.features.filter(f => visibleIds.has(f.properties.id));
    return { ...filteredData, features };

  }, [filteredData, spatialLayer, shapeVersion]);


  const handleVisualize = async () => {
    if (!batchId) return alert("Please enter a Batch ID");
    setLoading(true);
    setHasInteracted(false);
    setSelectedId(null);
    setSearchQuery('');
    setSpatialLayer(null); 
    setShapeVersion(0);

    const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

    try {
      const res = await fetch(`${API_URL}/api/visualize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId, filter })
      });
      if (!res.ok) throw new Error((await res.json()).detail);
      const geoJson = await res.json();

      const features = geoJson.features.sort((a, b) => a.properties.timestamp - b.properties.timestamp);
      if (features.length > 0) {
        const start = features[0].properties.timestamp;
        const lastEvent = features[features.length - 1];
        const end = (lastEvent.properties.timestamp_end || lastEvent.properties.timestamp) + 2000;

        setStartTime(start);
        setEndTime(end);
        setCurrentTime(start);
        setData(geoJson);
        setFilteredData(geoJson);
        addToHistory(batchId);
      } else {
        alert("No events found.");
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!searchQuery.trim()) {
        if (data) {
          setFilteredData(data);
          setSearchResults(null);
        }
        return;
    }

    const delaySearch = setTimeout(async () => {
        setIsSearching(true);
        try {
            const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
            
            const res = await fetch(`${API_URL}/api/ai-search`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ batchId, query: searchQuery })
            });
            
            if (res.ok) {
                const { matching_ids } = await res.json();

                const matches = data.features.filter(f => matching_ids.includes(f.properties.id));
                const spatiallyFiltered = filterFeaturesBySpatialLayer(matches, spatialLayer);

                setSearchResults(matching_ids);
                setFilteredData({ ...data, features: spatiallyFiltered });
            }
        } catch (err) {
            console.error("AI Search Failed", err);
        } finally {
            setIsSearching(false);
        }
    }, 1000);

    return () => clearTimeout(delaySearch);
  }, [searchQuery, data, batchId]);

  // Keep filtered data in sync with the drawn region without re-hitting AI search
  useEffect(() => {
    if (!data) return;

    if (!searchQuery.trim()) {
      if (!spatialLayer) {
        setFilteredData(data);
      } else {
        const spatiallyFiltered = filterFeaturesBySpatialLayer(data.features, spatialLayer);
        setFilteredData({ ...data, features: spatiallyFiltered });
      }
      return;
    }

    if (searchResults) {
      const matches = data.features.filter(f => searchResults.includes(f.properties.id));
      const spatiallyFiltered = filterFeaturesBySpatialLayer(matches, spatialLayer);
      setFilteredData({ ...data, features: spatiallyFiltered });
    }
  }, [spatialLayer, shapeVersion, data, searchQuery, searchResults]);

  const handleEventClick = (id, time) => {
    if (showHeatmap) setShowHeatmap(false);
    setHasInteracted(true);
    setCurrentTime(time);
    setSelectedId(id);
  };

  const handleSeek = (t) => {
    setHasInteracted(true);
    setCurrentTime(t);
  };

  useEffect(() => {
    if (!displayedData) return;
    const activeEvents = displayedData.features.filter(f =>
      currentTime >= f.properties.timestamp &&
      currentTime <= f.properties.timestamp_end
    );

    if (activeEvents.length > 0 && isPlaying) {
      const latestEvent = activeEvents[activeEvents.length - 1];
      if (selectedId !== latestEvent.properties.id) {
        setSelectedId(latestEvent.properties.id);
      }
    } else if (activeEvents.length === 0) {
      setSelectedId(null);
    }
  }, [currentTime, displayedData, isPlaying]); 

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

  const eventList = displayedData ? displayedData.features.filter(f => f.geometry.type === 'Point') : [];

  const getHeatmapData = () => {
    if (!displayedData) return null;
    if (isPlaying || hasInteracted) {
       return {
         ...displayedData,
         features: displayedData.features.filter(f => f.properties.timestamp <= currentTime)
       };
    }
    return displayedData;
  };
  
  const heatmapData = getHeatmapData();

  return (
    <div className="flex flex-col h-screen bg-slate-100 overflow-hidden">
      <div className="bg-white shadow-sm p-4 z-[2000] relative shrink-0">
        <div className="max-w-full mx-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <h1 className="text-xl font-bold text-slate-800">NomadicML <span className="text-blue-600">Geovisualizer</span></h1>
          
          <div className="flex gap-2 w-full max-w-4xl items-center">
            
            <details className="relative">
              <summary className="list-none bg-white border border-slate-300 text-slate-600 px-3 py-2 rounded-lg cursor-pointer hover:bg-slate-50 text-sm font-medium select-none transition-colors">🕒</summary>
              <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden z-[5000]">
                {recentBatches.map(id => (
                  <button key={id} onClick={() => { setBatchId(id); document.querySelector('details[open]').removeAttribute('open'); }} className="w-full text-left px-4 py-2.5 text-xs font-mono text-slate-600 hover:bg-blue-50 hover:text-blue-700 truncate border-b border-slate-50 last:border-0">{id}</button>
                ))}
              </div>
            </details>

            <input 
              value={batchId} 
              onChange={(e) => setBatchId(e.target.value)} 
              className="w-32 border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 font-mono" 
              placeholder="Batch ID..." 
            />
            
            {/* SEARCH BAR (Context Aware) */}
            <div className="flex-1 relative group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                {isSearching ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <Search size={16} />}
              </div>
              <input 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                // Dynamic Placeholder to indicate Spatial Context
                placeholder={spatialLayer ? 'Search within selected area...' : 'AI Search (e.g. "red car")...'}
                className={`w-full border rounded-lg pl-10 pr-8 py-2 text-sm outline-none focus:ring-2 transition-all ${
                    spatialLayer ? 'border-blue-400 bg-blue-50 ring-blue-200' : 'border-slate-300 focus:ring-blue-500'
                }`}
                disabled={!data}
              />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            <button 
                onClick={() => setShowHeatmap(!showHeatmap)}
                disabled={!data}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${
                    showHeatmap 
                    ? 'bg-orange-100 text-orange-700 border border-orange-200' 
                    : 'bg-white text-slate-600 border border-slate-300 hover:bg-slate-50 disabled:opacity-50'
                }`}
            >
                <Flame size={16} />
                {showHeatmap ? 'Heatmap' : 'Heatmap'}
            </button>

            <button onClick={handleVisualize} disabled={loading} className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2 rounded-lg text-sm disabled:opacity-50 shadow-sm hover:shadow-md transition-all">
              {loading ? 'Loading...' : 'Visualize'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 relative h-full">
          <MapContainer 
            center={[39.8283, -98.5795]} 
            zoom={4} 
            zoomControl={false} 
            minZoom={3}
            maxBounds={[[-85, -180], [85, 180]]}
            maxBoundsViscosity={1.0}
            style={{ height: "100%", width: "100%" }}
          >
            <LayersControl position="topright">
              <LayersControl.BaseLayer name="Dark Mode"><TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" attribution='CartoDB' /></LayersControl.BaseLayer>
              <LayersControl.BaseLayer checked name="Light Mode"><TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" attribution='CartoDB' /></LayersControl.BaseLayer>
              <LayersControl.BaseLayer name="Satellite"><TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution='Esri' /></LayersControl.BaseLayer>
            </LayersControl>

            {/* --- Draw Control --- */}
            <DrawControl 
              onCreated={onCreated} 
              onDeleted={onDeleted} 
              onEdited={onEdited} 
            />

            {displayedData && (
              <>
                {showHeatmap ? (
                  <HeatmapLayer data={heatmapData} />
                ) : (
                  <MapLayer
                    data={displayedData}
                    currentTime={currentTime}
                    showAll={!hasInteracted && !isPlaying}
                    selectedId={selectedId}
                    onMarkerClick={handleEventClick}
                    isPlaying={isPlaying}
                  />
                )}
              </>
            )}

            {/* Disable auto-zoom if spatial filter is active (keeps user context) */}
            {displayedData && <AutoFitBounds data={displayedData} disableZoom={!!spatialLayer} />}
          </MapContainer>
          
          {displayedData && !showHeatmap && (
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
        
        {displayedData && (
          <div className="w-[350px] shrink-0 h-full relative transition-all duration-300 ease-in-out border-l border-slate-200">
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
