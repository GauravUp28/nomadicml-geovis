import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, LayersControl, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import MapLayer from './components/MapLayer';
import TimelineControls from './components/TimelineControls';
import EventGrid from './components/EventGrid';
import HeatmapLayer from './components/HeatmapLayer'; 
import { Flame, Search, X, Loader2 } from 'lucide-react';

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
  
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [filteredData, setFilteredData] = useState(null);

  const [data, setData] = useState(null);
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

  const handleVisualize = async () => {
    if (!batchId) return alert("Please enter a Batch ID");
    setLoading(true);
    setHasInteracted(false);
    setSelectedId(null);
    setSearchQuery('');

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
        if (data) setFilteredData(data);
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
                
                const matches = data.features.filter(f => 
                    matching_ids.includes(f.properties.id)
                );
                
                setFilteredData({ ...data, features: matches });
            }
        } catch (err) {
            console.error("AI Search Failed", err);
        } finally {
            setIsSearching(false);
        }
    }, 1000);

    return () => clearTimeout(delaySearch);
  }, [searchQuery, data, batchId]);

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
    if (!filteredData) return;
    const activeEvents = filteredData.features.filter(f =>
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
  }, [currentTime, filteredData, isPlaying]); 

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

  const eventList = filteredData ? filteredData.features.filter(f => f.geometry.type === 'Point') : [];

  const getHeatmapData = () => {
    if (!filteredData) return null;
    if (isPlaying || hasInteracted) {
       return {
         ...filteredData,
         features: filteredData.features.filter(f => f.properties.timestamp <= currentTime)
       };
    }
    return filteredData;
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
            
            {/* SEARCH BAR (AI ENABLED) */}
            <div className="flex-1 relative group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                {isSearching ? <Loader2 size={16} className="animate-spin text-blue-500" /> : <Search size={16} />}
              </div>
              <input 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder='AI Search (e.g. "red car right lane")...'
                className="w-full border border-slate-300 rounded-lg pl-10 pr-8 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all"
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

            {filteredData && (
              <>
                {showHeatmap ? (
                  <HeatmapLayer data={heatmapData} />
                ) : (
                  <MapLayer
                    data={filteredData}
                    currentTime={currentTime}
                    showAll={!hasInteracted && !isPlaying}
                    selectedId={selectedId}
                    onMarkerClick={handleEventClick}
                    isPlaying={isPlaying}
                  />
                )}
              </>
            )}

            {filteredData && <AutoFitBounds data={filteredData} />}
          </MapContainer>
          
          {filteredData && !showHeatmap && (
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
        
        {filteredData && (
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