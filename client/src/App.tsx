import { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import 'mapbox-gl/dist/mapbox-gl.css';

// ⚠️ YOUR MAPBOX TOKEN HERE
mapboxgl.accessToken = 'pk.eyJ1IjoibGVlYnJpYW4wOTA4IiwiYSI6ImNtbG1nMGk3cTBqdGkzanB2bWFncmtkZW8ifQ.ElgMiOpm7mhP-pqZBTJ6wA';

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [params, setParams] = useState({ scenario: 'rcp8p5', year: '2050', rp: '100' });
  const [loading, setLoading] = useState(false);

  // 1. Initialize Map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [110, 20], // Center on Asia
      zoom: 3,
      pitch: 45, // 3D effect
    });

    map.current.on('load', () => {
      // Add a source for our factories
      map.current?.addSource('factories', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Add 3D Bars Layer
      map.current?.addLayer({
        id: 'loss-bars',
        type: 'fill-extrusion',
        source: 'factories',
        paint: {
          'fill-extrusion-color': [
            'interpolate', ['linear'], ['get', 'loss'],
            0, '#4ade80',      // Green (No loss)
            1000000, '#facc15', // Yellow
            10000000, '#ef4444' // Red (High loss)
          ],
          // Height = Loss Value scaled down so it fits on map
          'fill-extrusion-height': ['*', ['get', 'loss'], 0.00005], 
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.8
        }
      });
    });
  }, []);

  // 2. Fetch Data & Update Map
  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.get('http://localhost:3001/api/risk', {
        params: { scenario: params.scenario, year: params.year, returnPeriod: params.rp }
      });
      const results = res.data;
      setData(results);

      // Convert to GeoJSON for Mapbox
      const geojson: any = {
        type: 'FeatureCollection',
        features: results.map((site: any) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: site.coords },
          properties: {
            loss: site.financial_loss,
            name: site.name,
            depth: site.depth_m
          }
        }))
      };

      // Update Map Source
      const source: any = map.current?.getSource('factories');
      if (source) source.setData(geojson);

    } catch (err) {
      console.error(err);
      alert("Error fetching data. Is the backend running?");
    }
    setLoading(false);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      {/* Sidebar Controls */}
      <div style={{ width: '350px', padding: '20px', background: '#f8fafc', borderRight: '1px solid #ddd', display: 'flex', flexDirection: 'column' }}>
        <h2>TCFD Flood Risk</h2>
        
        <label>Scenario</label>
        <select value={params.scenario} onChange={e => setParams({...params, scenario: e.target.value})}>
          <option value="rcp4p5">RCP 4.5</option>
          <option value="rcp8p5">RCP 8.5</option>
        </select>

        <label>Year</label>
        <select value={params.year} onChange={e => setParams({...params, year: e.target.value})}>
          <option value="2030">2030</option>
          <option value="2050">2050</option>
          <option value="2080">2080</option>
        </select>

        <button onClick={fetchData} disabled={loading} style={{ marginTop: '10px', padding: '10px', background: '#2563eb', color: 'white', border: 'none', cursor: 'pointer' }}>
          {loading ? 'Calculating...' : 'Run Analysis'}
        </button>

        <hr />
        
        {/* Financial Chart */}
        <h3>Financial Impact</h3>
        <div style={{ height: '200px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <XAxis dataKey="name" tick={{fontSize: 10}} interval={0} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="financial_loss" fill="#3b82f6" name="Loss ($)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Map Area */}
      <div ref={mapContainer} style={{ flex: 1 }} />
    </div>
  );
}

export default App;