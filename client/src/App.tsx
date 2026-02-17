import { useEffect, useState, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import 'mapbox-gl/dist/mapbox-gl.css';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

type UploadedFactory = {
  pid: number;
  name: string;
  coords: [number, number]; // [lon, lat]
  asset_value: number;
  type: 'industry' | 'commercial';
};

type UploadParseResult = {
  factories: UploadedFactory[];
  originalHeaders: string[];
  originalRows: Record<string, string>[];
};

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const hoverPopup = useRef<mapboxgl.Popup | null>(null);
  const isMapLoaded = useRef(false);
  const [data, setData] = useState<any[]>([]);
  const [params, setParams] = useState({
    scenario: 'rcp8p5',
    year: '2050',
    rp: '100',
    model: '0000GFDL_ESM2M',
    bufferM: '1000'
  });
  const [loading, setLoading] = useState(false);
  const [uploadedFactories, setUploadedFactories] = useState<UploadedFactory[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [uploadedCsvHeaders, setUploadedCsvHeaders] = useState<string[]>([]);
  const [uploadedCsvRows, setUploadedCsvRows] = useState<Record<string, string>[]>([]);

  const parseCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells.map(c => c.replace(/^"(.*)"$/, '$1').trim());
  };

  const norm = (s: string) => s.toLowerCase().replace(/[\s_]/g, '');

  const escapeHtml = (value: unknown): string => {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  const parseFactoriesCsv = (text: string): UploadParseResult => {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) throw new Error('CSV needs header + at least 1 row.');

    const originalHeaders = parseCsvLine(lines[0]);
    const headers = originalHeaders.map(norm);
    const nameIdx = headers.findIndex(h => h === 'name');
    const latIdx = headers.findIndex(h => h === 'lat' || h === 'latitude');
    const lonIdx = headers.findIndex(h => h === 'lon' || h === 'lng' || h === 'longitude');
    const assetIdx = headers.findIndex(h => h === 'assetvalue' || h === 'asset_value' || h === 'value');
    const typeIdx = headers.findIndex(h => h === 'type');

    if (nameIdx < 0 || latIdx < 0 || lonIdx < 0 || assetIdx < 0 || typeIdx < 0) {
      throw new Error('Required columns: name, lat, lon, asset_value, type');
    }

    const rows: UploadedFactory[] = [];
    const originalRows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.every(c => !c)) continue;

      const name = (cols[nameIdx] || '').trim();
      const lat = Number(cols[latIdx]);
      const lon = Number(cols[lonIdx]);
      const asset = Number(cols[assetIdx]);
      const typeRaw = String(cols[typeIdx] || '').trim().toLowerCase();
      const type = typeRaw === 'commercial' ? 'commercial' : (typeRaw === 'industry' ? 'industry' : null);

      if (!name) continue;
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) continue;
      if (!Number.isFinite(lon) || lon < -180 || lon > 180) continue;
      if (!Number.isFinite(asset) || asset < 0) continue;
      if (!type) continue;

      const originalRow: Record<string, string> = {};
      originalHeaders.forEach((header, idx) => {
        originalRow[header] = cols[idx] ?? '';
      });

      rows.push({
        pid: rows.length + 1,
        name,
        coords: [lon, lat],
        asset_value: asset,
        type
      });
      originalRows.push(originalRow);
    }

    if (!rows.length) throw new Error('No valid rows found.');
    return {
      factories: rows,
      originalHeaders,
      originalRows
    };
  };

  const onCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploadError('');
      const text = await file.text();
      const parsed = parseFactoriesCsv(text);
      setUploadedFactories(parsed.factories);
      setUploadedCsvHeaders(parsed.originalHeaders);
      setUploadedCsvRows(parsed.originalRows);
    } catch (err: any) {
      setUploadedFactories([]);
      setUploadedCsvHeaders([]);
      setUploadedCsvRows([]);
      setUploadError(err?.message || 'CSV parse failed');
    }
  };

  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/leebrian0908/cmlpafe7l006e01sw6a3c47ir',
      center: [121, 23], // Taiwan
      zoom: 4,
      pitch: 60, // Tilt for 3D
      antialias: true
    });

    map.current.on('load', () => {
      isMapLoaded.current = true;

      // Point source for circles
      map.current?.addSource('factories-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      // Polygon source for 3D bars
      map.current?.addSource('factories-polygons', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
      });

      map.current?.addLayer({
        id: 'factory-dots',
        type: 'circle',
        source: 'factories-points',
        paint: {
          'circle-radius': 6,
          'circle-color': '#555',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });

      map.current?.addLayer({
        id: 'factory-labels',
        type: 'symbol',
        source: 'factories-points',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right'],
          'text-radial-offset': 0.85,
          'text-justify': 'auto',
          'text-padding': 3,
          'text-max-width': 12,
          'text-allow-overlap': false,
          'text-ignore-placement': false
        },
        paint: {
          'text-color': '#0f172a',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.25
        }
      });

      map.current?.addLayer({
        id: 'loss-bars',
        type: 'fill-extrusion',
        source: 'factories-polygons',
        paint: {
          // COLOR: Solid Blue
          'fill-extrusion-color': '#2563eb', 

          // HEIGHT: Based strictly on 'depth' (Flood Height)
          // We multiply by 50,000 so a 1-meter flood looks like a 50km tower.
          // This makes it clearly visible on a global map.
          'fill-extrusion-height': [
             '*', ['get', 'depth'], 500000
          ],
          
          'fill-extrusion-opacity': 0.9
        }
      });

      hoverPopup.current = new mapboxgl.Popup({
        closeButton: false,
        closeOnClick: false,
        offset: 14
      });

      map.current?.on('mouseenter', 'factory-dots', (e: mapboxgl.MapLayerMouseEvent) => {
        map.current!.getCanvas().style.cursor = 'pointer';

        const feature = e.features?.[0];
        const coordinates = (feature?.geometry as any)?.coordinates as [number, number] | undefined;
        const props = (feature?.properties || {}) as Record<string, any>;
        if (!coordinates) return;

        const popupHtml = `
          <div style="font-size:12px;line-height:1.45;min-width:220px;">
            <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(props.name)}</div>
            <div>Type: ${escapeHtml(props.type)}</div>
            <div>Asset Value: ${Number(props.asset_value || 0).toLocaleString()} 萬元新臺幣</div>
            <div>Estimated Inundation: ${Number(props.depth || 0).toFixed(3)} m</div>
            <div>Financial Loss: ${Math.round(Number(props.loss || 0)).toLocaleString()} 萬元新臺幣</div>
          </div>
        `;

        hoverPopup.current
          ?.setLngLat(coordinates)
          .setHTML(popupHtml)
          .addTo(map.current!);
      });

      map.current?.on('mousemove', 'factory-dots', (e: mapboxgl.MapLayerMouseEvent) => {
        const feature = e.features?.[0];
        const coordinates = (feature?.geometry as any)?.coordinates as [number, number] | undefined;
        if (coordinates) hoverPopup.current?.setLngLat(coordinates);
      });

      map.current?.on('mouseleave', 'factory-dots', () => {
        map.current!.getCanvas().style.cursor = '';
        hoverPopup.current?.remove();
      });
    });

    return () => {
      isMapLoaded.current = false;
      hoverPopup.current?.remove();
      hoverPopup.current = null;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Dynamic chart height so labels do not overlap
  const rowHeight = 30;
  const chartHeight = Math.max(420, data.length * rowHeight + 40);

  const createBufferCircle = (coords: [number, number], meters: number): number[][][] => {
    const [lon, lat] = coords;
    const radius = Math.max(1, meters);
    const earthRadius = 6378137;
    const angularDistance = radius / earthRadius;
    const latRad = (lat * Math.PI) / 180;
    const points: number[][] = [];

    for (let i = 0; i <= 64; i++) {
      const bearing = (2 * Math.PI * i) / 64;
      const lat2 = Math.asin(
        Math.sin(latRad) * Math.cos(angularDistance) +
          Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearing)
      );
      const lon2 =
        (lon * Math.PI) / 180 +
        Math.atan2(
          Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latRad),
          Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(lat2)
        );
      points.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
    }

    return [points];
  };

  // Determine API URL based on environment
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_URL}/api/risk`, {
        scenario: params.scenario,
        year: params.year,
        returnPeriod: params.rp,
        model: params.model,
        bufferMeters: Number(params.bufferM) || 0,
        factories: uploadedFactories
      });

      const results = (Array.isArray(res.data) ? res.data : []).map((site: any) => ({
        ...site,
        financial_loss: Math.round(Number(site.financial_loss) || 0)
      }));
      setData(results);

      const pointGeojson: any = {
        type: 'FeatureCollection',
        features: results.map((site: any) => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: site.coords
          },
          properties: {
            loss: site.financial_loss,
            name: site.name,
            depth: site.depth_m,
            asset_value: site.asset_value,
            type: site.type
          }
        }))
      };

      const selectedBufferM = Number(params.bufferM) || 0;

      const polygonGeojson: any = {
        type: 'FeatureCollection',
        features: selectedBufferM > 0
          ? results.map((site: any) => ({
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: createBufferCircle(site.coords, selectedBufferM)
              },
              properties: {
                loss: site.financial_loss,
                name: site.name,
                depth: site.depth_m
              }
            }))
          : []
      };

      if (map.current && isMapLoaded.current) {
        const pointSource = map.current.getSource('factories-points') as mapboxgl.GeoJSONSource | undefined;
        const polygonSource = map.current.getSource('factories-polygons') as mapboxgl.GeoJSONSource | undefined;

        pointSource?.setData(pointGeojson);
        polygonSource?.setData(polygonGeojson);

        const eastAsiaBounds = new mapboxgl.LngLatBounds([95, -5], [140, 45]);
        map.current.fitBounds(eastAsiaBounds, {
          padding: 60,
          maxZoom: 5.2,
          duration: 1200,
          pitch: 60
        });
      }
    } catch (err) {
      console.error(err);
      alert('Backend Error! Check terminal.');
    } finally {
      setLoading(false);
    }
  };

  const [panelWidth, setPanelWidth] = useState(500);
  const [isScrolling, setIsScrolling] = useState(false);
  const isResizing = useRef(false);
  const scrollTimer = useRef<number | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const next = Math.min(760, Math.max(320, e.clientX)); // clamp width
      setPanelWidth(next);
    };

    const onUp = () => {
      isResizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = () => {
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onLeftPanelScroll = () => {
    setIsScrolling(true);
    if (scrollTimer.current) window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => setIsScrolling(false), 700);
  };

  const escapeCsvValue = (value: unknown): string => {
    const raw = value == null ? '' : String(value);
    return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };

  const exportResultsCsv = () => {
    if (!data.length) return;

    const baseHeaders = uploadedCsvHeaders.length
      ? uploadedCsvHeaders
      : ['name', 'lat', 'lon', 'asset_value', 'type'];
    const exportHeaders = [...baseHeaders, 'inundation_depth_m', 'damage_ratio','financial_loss_ten_thousands_ntd'];

    const lines: string[] = [];
    lines.push(exportHeaders.map(escapeCsvValue).join(','));

    data.forEach((site: any, idx: number) => {
      const rowIndex = Number.isFinite(Number(site?.pid)) ? Math.max(0, Number(site.pid) - 1) : idx;
      const original = uploadedCsvRows[rowIndex] ?? {};
      const values = [
        ...baseHeaders.map(h => original[h] ?? ''),
        Number(site?.depth_m ?? 0).toFixed(4),
        Math.round(Number(site?.financial_loss ?? 0)),
        Number(site?.damage_ratio ?? 0).toFixed(6)
      ];
      lines.push(values.map(escapeCsvValue).join(','));
    });

    const csvContent = `\uFEFF${lines.join('\n')}\n`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'risk_results.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <div
        style={{
          width: `${panelWidth}px`,
          height: '100vh',
          background: '#f8fafc',
          borderRight: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <div
          className={`left-scroll ${isScrolling ? 'show-scrollbar' : ''}`}
          onScroll={onLeftPanelScroll}
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '20px' }}
        >
          {/* Top controls area (fixed) */}
          <div style={{ padding: '20px 20px 12px 20px', flex: '0 0 auto' }}>
            {/* 1. TITLE (Split into 2 lines) */}
            <div>
              <h2 style={{ margin: '0 0 5px 0', lineHeight: '1.4', fontSize: '1.25rem', color: '#1e293b' }}>
                TCFD 情境分析：<br />
                <span style={{ color: '#2563eb' }}>智能洪水財務風險量化儀表板</span>
              </h2>
              {/* 2. COPYRIGHT (Small text below title) */}
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                v.1.0｜2026 安永聯合會計師事務所｜李適軒 Brian Lee
              </p>

              </div>

              <div style={{ padding: '10px 10px 6px 10px', flex: '0 0 auto' }}></div>
              {/* Upload CSV */}
              <div>

              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                • Analysis powered by Google Earth Engine. 

              </p>
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                • Flood data from WRI Aqueduct, damage function from the Joint Research Center of the European Commission. 

              </p>
              <p style={{ fontSize: '0.75rem', color: '#64748b', margin: 0 }}>
                • CAUTION: Results are for reference only and not intended for investment decisions. 

              </p>
            </div>

            <div style={{ padding: '10px 10px 6px 10px', flex: '0 0 auto' }}></div>
            {/* Upload CSV */}
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem' }}>
                Upload CSV
              </label>
              <input type="file" accept=".csv,text/csv" onChange={onCsvUpload} />
              <p style={{ margin: '6px 0 0', fontSize: '0.8rem' }}>
                <a href="/Demo.csv" download style={{ color: '#2563eb', textDecoration: 'underline' }}>
                  Download CSV template
                </a>
              </p>
              {!!uploadedFactories.length && (
                <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#16a34a' }}>
                  Loaded {uploadedFactories.length} locations
                </p>
              )}
              {!!uploadError && (
                <p style={{ margin: '6px 0 0', fontSize: '0.8rem', color: '#dc2626' }}>
                  {uploadError}
                </p>
              )}
            </div>

            <div style={{ padding: '5px 5px 10px 5px', flex: '0 0 auto' }}></div>
            {/* Controls */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
              <div>
                <label style={{display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem'}}>Climate Scenario</label>
                <select
                  value={params.scenario}
                  onChange={e => setParams({...params, scenario: e.target.value})}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                >
                  <option value="rcp4p5">RCP 4.5 (Optimistic Scenario 樂觀情境)</option>
                  <option value="rcp8p5">RCP 8.5 (Pessimistic Scenario 悲觀情境)</option>
                </select>
              </div>

              <div>
                <label style={{display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem'}}>Year</label>
                <select
                  value={params.year}
                  onChange={e => setParams({...params, year: e.target.value})}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                >
                  <option value="2030">2030</option>
                  <option value="2050">2050</option>
                  <option value="2080">2080</option>
                </select>
              </div>

              <div>
                <label style={{display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem'}}>Return Period (years)</label>
                <select
                  value={params.rp}
                  onChange={e => setParams({ ...params, rp: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                  <option value="250">250</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                </select>
              </div>

              <div>
                <label style={{display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem'}}>Climate Model</label>
                <select
                  value={params.model}
                  onChange={e => setParams({ ...params, model: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                >
                  <option value="00000NorESM1-M">NorESM1-M: Bjerknes Centre for Climate Research, Norwegian Meteorological Institute</option>
                  <option value="0000GFDL_ESM2M">GFDL_ESM2M: Geophysical Fluid Dynamics Laboratory (NOAA)</option>
                  <option value="0000HadGEM2-ES">HadGEM2-ES: Met Office Hadley Centre</option>
                  <option value="00IPSL-CM5A-LR">IPSL-CM5A-LR: Institut Pierre Simon Laplace</option>
                </select>
              </div>

              <div>
                <label style={{display: 'block', marginBottom: '5px', fontWeight: 'bold', fontSize: '0.9rem'}}>
                  Buffer Distance (meters)
                </label>
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={params.bufferM}
                  onChange={e => setParams({ ...params, bufferM: e.target.value })}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
              </div>

              <button
                onClick={fetchData}
                disabled={loading}
                style={{
                  padding: '12px',
                  background: loading ? '#94a3b8' : '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  transition: 'background 0.2s'
                }}
              >
                {loading ? '分析中...' : '啟動圖資分析與財務量化'}
              </button>

              <button
                onClick={exportResultsCsv}
                disabled={!data.length}
                style={{
                  padding: '12px',
                  background: data.length ? '#0f766e' : '#94a3b8',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: data.length ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                  transition: 'background 0.2s'
                }}
              >
                Export Results to CSV
              </button>
            </div>

            {/* Chart Section - taller + readable labels */}
            <div style={{ marginTop: '15px', display: 'flex', flexDirection: 'column', gap: '18px', paddingBottom: '12px' }}>
              <div style={{ height: chartHeight }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Estimated Inundation Depth (m)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                    <XAxis type="number" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={145}
                      tick={{ fontSize: 11 }}
                      interval={0}
                      tickFormatter={(v: string) => (v?.length > 22 ? `${v.slice(0, 22)}…` : v)}
                    />
                    <Tooltip formatter={(value: number | undefined) => [`${(value ?? 0).toFixed(2)} m`, 'Depth']} />
                    <Bar dataKey="depth_m" fill="#0ea5e9" radius={[0, 4, 4, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '18px', paddingBottom: '12px' }}></div>
              <div style={{ height: chartHeight }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '10px' }}>Estimated Financial Loss (in 10,000 NTD)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} layout="vertical" margin={{ left: 8, right: 8, top: 10, bottom: 4 }}>
                    <XAxis type="number" />
                    <YAxis
                      dataKey="name"
                      type="category"
                      width={145}
                      tick={{ fontSize: 11 }}
                      interval={0}
                      tickFormatter={(v: string) => (v?.length > 22 ? `${v.slice(0, 22)}…` : v)}
                    />
                    <Tooltip formatter={(value: number | undefined) => [`$${Math.round(value ?? 0).toLocaleString()}`, 'Loss']} />
                    <Bar dataKey="financial_loss" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* drag handle */}
          <div
            onMouseDown={startResize}
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: '8px',
              height: '100%',
              cursor: 'col-resize',
              background: 'transparent'
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, height: '100vh', position: 'relative' }}>
        <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />
      </div>
    </div>
  );
}

export default App;