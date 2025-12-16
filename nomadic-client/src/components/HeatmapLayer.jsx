import { useEffect } from 'react';
import { useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import HeatmapLegend from './HeatmapLegend';

const HeatmapLayer = ({ data }) => {
  const map = useMap();

  useMapEvents({
    click(e) {
      const currentZoom = map.getZoom();
      const maxZoom = 17;
      const targetZoom = Math.min(currentZoom + 2, maxZoom);
      map.flyTo(e.latlng, targetZoom, { duration: 0.5 });
    },
  });

  useEffect(() => {
    if (!data) return;

    const points = data.features
      .filter(f => f.geometry.type === 'Point') 
      .map(f => {
        const lat = f.geometry.coordinates[1];
        const lng = f.geometry.coordinates[0];
        const intensity = 0.3; 
        return [lat, lng, intensity];
      });

    try {
        const heat = L.heatLayer(points, {
          radius: 30,
          blur: 20,
          minOpacity: 0.4, 
          gradient: { 
            0.2: '#00bfffff', 
            0.6: '#ffff00', 
            1.0: '#ff0000'
          }
        });

        heat.addTo(map);

        return () => {
          map.removeLayer(heat);
        };
    } catch (e) {
        console.error("Failed to initialize Heatmap", e);
    }

  }, [data, map]);

  return <HeatmapLegend />;
};

export default HeatmapLayer;