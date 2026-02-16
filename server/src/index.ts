import express, { Request, Response } from 'express';
import cors from 'cors';
const ee = require('@google/earthengine');
const privateKey = require('../ee-leebrian0908-ead07d27b7fb.json');

const app = express();
app.use(cors());
app.use(express.json());

type FactoryType = 'industry' | 'commercial';

type Factory = {
  pid: number;
  name: string;
  coords: [number, number]; // [lon, lat]
  asset_value: number;
  type?: FactoryType; // default to industry when missing
};

// --- 2. DAMAGE FUNCTION (Migrated from Excel/Python) ---
// Simple linear interpolation for damage ratio (0 to 1) based on depth (m)

const INDUSTRY_DAMAGE_CURVE = [
  { depth: 0, ratio: 0 },
  { depth: 0.5, ratio: 0.28 },
  { depth: 1.0, ratio: 0.48 },
  { depth: 2.0, ratio: 0.72 },
  { depth: 3.0, ratio: 0.86 },
  { depth: 4.0, ratio: 0.91 },
  { depth: 5.0, ratio: 0.96 },
  { depth: 6.0, ratio: 1.00 },
];

const COMMERCIAL_DAMAGE_CURVE = [
  { depth: 0, ratio: 0.00 },
  { depth: 0.5, ratio: 0.38 },
  { depth: 1.0, ratio: 0.54 },
  { depth: 1.5, ratio: 0.66 },
  { depth: 2.0, ratio: 0.76 },
  { depth: 3.0, ratio: 0.88 },
  { depth: 4.0, ratio: 0.94 },
  { depth: 5.0, ratio: 0.98 },
  { depth: 6.0, ratio: 1.00 },
];

function getDamageRatio(depth: number, curve: { depth: number; ratio: number }[]): number {
  if (depth <= 0) return 0;

  const max = curve[curve.length - 1]!;
  if (depth >= max.depth) return max.ratio;

  for (let i = 0; i < curve.length - 1; i++) {
    const p1 = curve[i]!;
    const p2 = curve[i + 1]!;
    if (depth >= p1.depth && depth < p2.depth) {
      return p1.ratio + ((depth - p1.depth) * (p2.ratio - p1.ratio)) / (p2.depth - p1.depth);
    }
  }
  return 0;
}

type RiverModel =
  | '00000NorESM1-M'
  | '0000GFDL_ESM2M'
  | '0000HadGEM2-ES'
  | '00IPSL-CM5A-LR';

function normalizeParams(queryOrBody: any) {
  const sc = String(queryOrBody?.scenario || 'rcp8p5');
  const yr = Number(queryOrBody?.year) || 2050;

  let rp = Number(queryOrBody?.returnPeriod) || 100;
  const VALID_RPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];
  if (!VALID_RPS.includes(rp)) rp = 100;

  const VALID_MODELS: RiverModel[] = [
    '00000NorESM1-M',
    '0000GFDL_ESM2M',
    '0000HadGEM2-ES',
    '00IPSL-CM5A-LR'
  ];
  let model = String(queryOrBody?.model || '0000GFDL_ESM2M') as RiverModel;
  if (!VALID_MODELS.includes(model)) model = '0000GFDL_ESM2M';

  let bufferM = Number(queryOrBody?.bufferMeters ?? queryOrBody?.bufferM ?? 0);
  if (!Number.isFinite(bufferM) || bufferM < 0) bufferM = 0;
  if (bufferM > 50000) bufferM = 50000; // safety cap

  return { sc, yr, rp, model, bufferM };
}

function sanitizeFactories(input: any): Factory[] {
  if (!Array.isArray(input)) return [];

  const out: Factory[] = [];
  input.forEach((row, idx) => {
    const name = String(row?.name ?? '').trim();
    const asset = Number(row?.asset_value ?? row?.assetValue);
    const lon = Array.isArray(row?.coords) ? Number(row.coords[0]) : Number(row?.lon ?? row?.lng);
    const lat = Array.isArray(row?.coords) ? Number(row.coords[1]) : Number(row?.lat);
    const typeRaw = String(row?.type ?? '').trim().toLowerCase();
    const type: FactoryType = typeRaw === 'commercial' ? 'commercial' : 'industry';

    if (!name) return;
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return;
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return;
    if (!Number.isFinite(asset) || asset < 0) return;

    out.push({
      pid: idx + 1,
      name,
      coords: [lon, lat],
      asset_value: asset,
      type
    });
  });

  return out;
}

function calculateRisk(
  factories: Factory[],
  sc: string,
  yr: number,
  rp: number,
  model: RiverModel,
  bufferM: number,
  res: Response
) {
  console.log(`Calculating for: ${sc} / ${yr} / RP${rp} / model=${model} / buffer=${bufferM}m / factories=${factories.length}`);

  const pointsFc = ee.FeatureCollection(
    factories.map(f => ee.Feature(ee.Geometry.Point(f.coords), { pid: f.pid }))
  );

  // Base filter first (soft model logic, same as original script)
  const base = ee.ImageCollection('WRI/Aqueduct_Flood_Hazard_Maps/V2')
    .filter(ee.Filter.eq('floodtype', 'inunriver'))
    .filter(ee.Filter.eq('climatescenario', sc))
    .filter(ee.Filter.eq('returnperiod', rp))
    .filter(ee.Filter.eq('year', yr));

  const modelFiltered = base.filter(ee.Filter.eq('model', model));
  const dataset = ee.ImageCollection(ee.Algorithms.If(modelFiltered.size().gt(0), modelFiltered, base));

  dataset.size().evaluate((count: number, error: any) => {
    if (error) return res.status(500).json({ error: error.message });

    if (count === 0) {
      return res.json(
        factories.map(f => ({
          ...f,
          depth_m: 0,
          depth_stat: bufferM > 0 ? 'max' : 'point',
          financial_loss: 0,
          risk_level: 'No Data',
          model_used: model,
          return_period: rp,
          buffer_m: bufferM
        }))
      );
    }

    const img = ee.Image(dataset.first()).select('inundation_depth').unmask(0);
    const scale = img.projection().nominalScale();

    let sampled: any;
    if (bufferM > 0) {
      const buffered = pointsFc.map((pt: any) => ee.Feature(pt).buffer(bufferM).set('pid', ee.Feature(pt).get('pid')));
      sampled = img.reduceRegions({
        collection: buffered,
        reducer: ee.Reducer.mean().combine({ reducer2: ee.Reducer.max(), sharedInputs: true }),
        scale
      });
    } else {
      sampled = img.sampleRegions({
        collection: pointsFc,
        properties: ['pid'],
        scale,
        geometries: false
      });
    }

    sampled.evaluate((data: any, reduceError: any) => {
      if (reduceError) return res.status(500).json({ error: reduceError.message });

      const results = (data?.features || []).map((f: any) => {
        const pid = f?.properties?.pid;
        const factory = factories.find(x => x.pid === pid);
        if (!factory) return null;

        const depthPoint = Number(f?.properties?.inundation_depth) || 0;
        const depthMean = Number(f?.properties?.mean) || 0;
        const depthMax = Number(f?.properties?.max) || 0;

        const depth = bufferM > 0 ? depthMax : depthPoint; // risk depth
        const factoryType: FactoryType = factory.type === 'commercial' ? 'commercial' : 'industry';
        const curve = factoryType === 'commercial' ? COMMERCIAL_DAMAGE_CURVE : INDUSTRY_DAMAGE_CURVE;
        const damageRatio = getDamageRatio(depth, curve);
        const loss = factory.asset_value * damageRatio;

        return {
          ...factory,
          depth_m: depth,
          depth_mean_m: bufferM > 0 ? depthMean : depthPoint,
          depth_max_m: bufferM > 0 ? depthMax : depthPoint,
          depth_stat: bufferM > 0 ? 'max' : 'point',
          damage_ratio: damageRatio,
          financial_loss: loss,
          risk_level: loss > 10000000 ? 'High' : (loss > 0 ? 'Medium' : 'Low'),
          model_used: model,
          return_period: rp,
          buffer_m: bufferM
        };
      }).filter(Boolean);

      return res.json(results);
    });
  });
}

// No default factories route anymore.
app.get('/api/risk', (_req: Request, res: Response) => {
  return res.status(400).json({
    error: 'No default factories configured. Upload CSV and call POST /api/risk with factories.'
  });
});

// Custom factories only
app.post('/api/risk', (req: Request, res: Response) => {
  const { sc, yr, rp, model, bufferM } = normalizeParams(req.body);
  const factories = sanitizeFactories(req.body?.factories);

  if (!factories.length) {
    return res.status(400).json({
      error: 'No valid factories provided. Include name, lat/lon (or coords), asset_value, and type.'
    });
  }

  calculateRisk(factories, sc, yr, rp, model, bufferM, res);
});

// --- 4. INITIALIZE & START ---
console.log("1. System checks starting...");

try {
  // Check if key loaded correctly
  if (!privateKey.private_key) {
    throw new Error("Key file looks wrong. Does it have a 'private_key' field?");
  }
  console.log("2. Key file valid. Attempting to authenticate with Google...");

  ee.data.authenticateViaPrivateKey(privateKey, 
    () => {
      console.log("3. Authentication SUCCESS! Now initializing Earth Engine...");
      
      ee.initialize(null, null, 
        () => {
          console.log("4. Initialization SUCCESS!");
          app.listen(3001, () => {
            console.log("✅ SERVER READY on http://localhost:3001");
            console.log("   (Go to your React app now)");
          });
        },
        (err: any) => {
          console.error("❌ ERROR during ee.initialize():", err);
        }
      );
    },
    (err: any) => {
      console.error("❌ ERROR during authenticateViaPrivateKey:", err);
    }
  );
} catch (e) {
  console.error("❌ CRITICAL ERROR:", e);
}