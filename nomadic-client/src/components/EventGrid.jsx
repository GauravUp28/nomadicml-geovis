import React, { useEffect, useRef } from 'react';
import { SEVERITY_COLORS, STATUS_COLORS, formatTime } from '../utils';

const EventGrid = ({ events, currentTime, onEventClick }) => {
  const scrollRefs = useRef({});

  // 1. Sort events by start time (timestamp)
  const sortedEvents = [...events].sort((a, b) => 
    a.properties.timestamp - b.properties.timestamp
  );

  // Auto-scroll to active event
  useEffect(() => {
    const activeEvent = sortedEvents.find(e => 
      currentTime >= e.properties.timestamp && 
      currentTime <= e.properties.timestamp_end
    );

    if (activeEvent) {
      const activeId = activeEvent.properties.timestamp;
      if (scrollRefs.current[activeId]) {
        scrollRefs.current[activeId].scrollIntoView({ 
          behavior: 'smooth', 
          block: 'nearest' 
        });
      }
    }
  }, [currentTime, sortedEvents]);

  return (
    <div className="h-full overflow-y-auto bg-white border-l border-slate-200 shadow-xl z-[3000] flex flex-col">
      <div className="p-4 border-b border-slate-100 bg-slate-50 sticky top-0 z-10">
        <h3 className="font-bold text-slate-700 text-sm uppercase tracking-wide">
          Events Log ({sortedEvents.length})
        </h3>
      </div>
      
      <div className="p-3 space-y-3">
        {sortedEvents.map((feature, idx) => {
          const p = feature.properties;
          
          // Check if Active
          const isActive = currentTime >= p.timestamp && currentTime <= p.timestamp_end;
          
          // Styling
          const severityColor = SEVERITY_COLORS[p.severity] || 'gray';
          const statusColor = STATUS_COLORS[p.status.toLowerCase()] || 'gray';
          
          return (
            <div 
              key={idx}
              ref={el => scrollRefs.current[p.timestamp] = el}
              onClick={() => onEventClick(p.timestamp)}
              className={`
                relative p-4 rounded-xl border transition-all cursor-pointer group
                ${isActive 
                  ? 'bg-blue-50 border-blue-500 shadow-md ring-1 ring-blue-500' 
                  : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'
                }
              `}
            >
              {/* Active Indicator Dot */}
              {isActive && (
                <span className="absolute top-3 right-3 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                </span>
              )}

              <div className="flex justify-between items-start mb-2">
                <h4 className={`font-bold text-sm ${isActive ? 'text-blue-900' : 'text-slate-800'}`}>
                  {p.label}
                </h4>
              </div>

              <div className="flex gap-2 mb-3">
                <span 
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase text-white"
                  style={{ backgroundColor: statusColor }}
                >
                  {p.status}
                </span>
                <span 
                  className="px-2 py-0.5 rounded text-[10px] font-bold uppercase text-white"
                  style={{ backgroundColor: severityColor }}
                >
                  {p.severity}
                </span>
              </div>

              <div className="flex items-center text-xs text-slate-500 font-mono gap-4">
                <span>Start: {formatTime(p.timestamp)}</span>
                <span>Dur: {((p.timestamp_end - p.timestamp)/1000).toFixed(1)}s</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EventGrid;