import React from 'react';
import { CircleMarker, Popup, Polyline } from 'react-leaflet';
import { SEVERITY_COLORS, STATUS_COLORS } from '../utils';

const MapLayer = ({ data, currentTime, showAll }) => {
  
  const visibleFeatures = data.features
    .filter(f => {
      // 1. Overview Mode: Show everything
      if (showAll) return true;

      const start = f.properties.timestamp;
      const end = f.properties.timestamp_end;

      // 2. Exact Duration Logic:
      // Show event ONLY if current playback time is inside the event's duration
      return currentTime >= start && currentTime <= end;
    })
    .sort((a, b) => a.properties.timestamp - b.properties.timestamp);

  return (
    <>
      {visibleFeatures.map((feature, idx) => {
        const p = feature.properties;
        const color = SEVERITY_COLORS[p.severity] || 'blue';
        const position = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];

        // --- Render Path (LineString) ---
        if (feature.geometry.type === 'LineString') {
          const positions = feature.geometry.coordinates.map(c => [c[1], c[0]]);
          const endPos = positions[positions.length - 1];

          return (
            <React.Fragment key={`path-group-${idx}`}>
              <Polyline 
                positions={positions} 
                pathOptions={{ color, weight: 4, opacity: 0.6, dashArray: '4, 8' }} 
              />
              <CircleMarker
                center={endPos}
                radius={5}
                pathOptions={{ color: '#333', weight: 1, fillColor: color, fillOpacity: 1 }}
              >
                 <Popup>End of Event</Popup>
              </CircleMarker>
            </React.Fragment>
          );
        }

        // --- Render Point (CircleMarker) ---
        if (feature.geometry.type === 'Point') {
          const statusKey = p.status ? p.status.toLowerCase() : 'unknown';
          const statusColor = STATUS_COLORS[statusKey] || '#666';

          return (
            <CircleMarker
              key={`point-${idx}`}
              center={position}
              radius={8}
              pathOptions={{ color: 'white', weight: 2, fillColor: color, fillOpacity: 1 }}
            >
              <Popup minWidth={320}>
                <div className="font-sans">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="m-0 text-sm font-bold text-slate-800">{p.label}</h4>
                    <span 
                      className="text-[10px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-wider"
                      style={{ backgroundColor: statusColor }}
                    >
                      {p.status}
                    </span>
                  </div>
                  
                  <div className="text-xs text-slate-500 mb-3 flex gap-3">
                    <span>🕒 <b>{p.time_str}</b></span>
                    <span>⚠️ <b style={{ color }}>{p.severity.toUpperCase()}</b></span>
                  </div>

                  {p.video_url && (
                    <div className="bg-black rounded-lg overflow-hidden mb-3 border border-slate-200">
                      <video width="100%" controls className="block">
                        <source src={`${p.video_url}#t=${p.video_offset}`} type="video/mp4" />
                      </video>
                    </div>
                  )}

                  <div 
                    className="bg-slate-50 p-3 rounded-md text-xs text-slate-700 leading-relaxed border-l-4"
                    style={{ borderColor: color }}
                  >
                    {p.description}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        }
        return null;
      })}
    </>
  );
};

export default MapLayer;