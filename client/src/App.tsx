import { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = 'pk.eyJ1IjoibGVlYnJpYW4wOTA4IiwiYSI6ImNtbG1nMGk3cTBqdGkzanB2bWFncmtkZW8ifQ.ElgMiOpm7mhP-pqZBTJ6wA';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [params, setParams] = useState({ scenario: 'rcp8p5', year: '2050', rp: '100' });
  const [loading, setLoading] = useState(false);

  // Helper: Create a visible square (0.02 deg ~ 2km wide)
  const createSquare = (coords: number[], size: number = 0.02) => {
    const [lon, lat] = coords;
    return [[
      [lon - size, lat - size],
      [lon + size, lat - size],
      [lon + size, lat + size],
      [lon - size, lat + size],
      [lon - size, lat - size]
    ]];
  };

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [121, 23], // Taiwan
      zoom: 4,
      pitch: 60, // Tilt for 3D
    });

    map.current.on('load', () => {
      // 1. Add Source
      map.current?.addSource('factories', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // 2. Add "Base" Circles (ALWAYS VISIBLE)
      // This ensures you see the location even if 3D bar is 0 height
      map.current?.addLayer({
        id: 'factory-dots',
        type: 'circle',
        source: 'factories',
        paint: {
          'circle-radius': 6,
          'circle-color': '#555',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });

      // 3. Add 3D Bars
      map.current?.addLayer({
        id: 'loss-bars',
        type: 'fill-extrusion',
        source: 'factories',
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'loss'],
            0, '#94a3b8',        // Gray if $0 Loss
            1, '#4ade80',        // Green if small loss
            10000000, '#ef4444'  // Red if high loss
          ],
          // Height logic: If loss > 0, scale it. If 0, give it a tiny base (2000m) so it's visible.
          'fill-extrusion-height': [
             'case',
             ['>', ['get', 'loss'], 0], ['*', ['get', 'loss'], 0.0001], // Scale real loss
             2000 // Default height for "safe" sites
          ],
          'fill-extrusion-opacity': 0.9
        }
      });
    });
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      console.log("Fetching data...");
      const res = await axios.get('http://localhost:3001/api/risk', {
        params: { scenario: params.scenario, year: params.year, returnPeriod: params.rp }
      });
      
      const results = res.data;
      console.log("Data Received:", results); // CHECK YOUR BROWSER CONSOLE FOR THIS

      setData(results);

      const geojson: any = {
        type: 'FeatureCollection',
        features: results.map((site: any) => ({
          type: 'Feature',
          // Create polygon for 3D bar
          geometry: { 
            type: 'Polygon', 
            coordinates: createSquare(site.coords) 
          },
          properties: {
            loss: site.financial_loss,
            name: site.name,
            depth: site.depth_m
          }
        }))
      };

      const source: any = map.current?.getSource('factories');
      if (source) {
        source.setData(geojson);
        console.log("Map updated with", results.length, "sites");
      }

      // Auto-zoom to show all points
      if (results.length > 0) {
        const bounds = new mapboxgl.LngLatBounds();
        results.forEach((site: any) => bounds.extend(site.coords));
        map.current?.fitBounds(bounds, { padding: 100, maxZoom: 8 });
      }

    } catch (err) {
      console.error(err);
      alert("Backend Error! Check terminal.");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <div style={{ width: '350px', padding: '20px', background: '#f8fafc', overflowY: 'auto' }}>
        <h2>TCFD Dashboard</h2>
        <div style={{display: 'flex', gap: '10px', flexDirection: 'column'}}>
            <label>Year</label>
            <select value={params.year} onChange={e => setParams({...params, year: e.target.value})} style={{padding: '5px'}}>
            <option value="2030">2030</option>
            <option value="2050">2050</option>
            <option value="2080">2080</option>
            </select>
            <button onClick={fetchData} disabled={loading} style={{ padding: '10px', background: '#2563eb', color: 'white', borderRadius: '4px' }}>
            {loading ? 'Analyzing...' : 'Run Analysis'}
            </button>
        </div>

        <div style={{ height: '250px', marginTop: '20px' }}>
            <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical">
                <XAxis type="number" hide />
                <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 9}} />
                <Tooltip />
                <Bar dataKey="financial_loss" fill="#3b82f6" radius={[0, 4, 4, 0]} />
            </BarChart>
            </ResponsiveContainer>
        </div>
      </div>
      <div ref={mapContainer} style={{ flex: 1 }} />
    </div>
  );
}

export default App;