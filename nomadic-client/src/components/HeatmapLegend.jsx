import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

const HeatmapLegend = () => {
  const map = useMap();

  useEffect(() => {
    const legend = L.control({ position: 'bottomright' });

    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'info legend');
      // Tailwind styling wrapper
      div.className = "bg-white/90 backdrop-blur-sm p-3 rounded-lg shadow-lg border border-slate-200 text-xs font-sans";
      
      div.innerHTML = `
        <h4 class="font-bold text-slate-700 mb-2">Event Density</h4>
        <div class="flex items-center gap-2 mb-1">
          <div class="w-4 h-4 rounded" style="background: #ff0000"></div>
          <span>High (4+ Events)</span>
        </div>
        <div class="flex items-center gap-2 mb-1">
          <div class="w-4 h-4 rounded" style="background: #ffff00"></div>
          <span>Medium (2-4 Events)</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-4 h-4 rounded" style="background: #00bfffff"></div>
          <span>Low (1-2 Events)</span>
        </div>
      `;
      return div;
    };

    legend.addTo(map);

    return () => legend.remove();
  }, [map]);

  return null;
};

export default HeatmapLegend;