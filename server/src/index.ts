import express from 'express';
import cors from 'cors';
const ee = require('@google/earthengine');
// ⚠️ PUT YOUR GOOGLE CLOUD KEY HERE
const privateKey = require('../ee-leebrian0908-ead07d27b7fb.json'); 

const app = express();
app.use(cors());
app.use(express.json());

// --- 1. YOUR DATA (Migrated from your script) ---
const FACTORIES = [
  { pid: 1, name: 'Kinpo Electronics (Taiwan)', coords: [121.602908, 25.002766], asset_value: 50000000 },
  { pid: 2, name: 'Cal-Comp (Thailand)', coords: [100.5604182, 13.7325002], asset_value: 30000000 },
  { pid: 3, name: 'Cal-Comp (Philippines)', coords: [121.1792173, 14.0136501], asset_value: 25000000 },
  // Add more from your list...
];

// --- 2. DAMAGE FUNCTION (Migrated from Excel/Python) ---
// Simple linear interpolation for damage ratio (0 to 1) based on depth (m)
const DAMAGE_CURVE = [
  { depth: 0, ratio: 0 },
  { depth: 0.5, ratio: 0.1 },
  { depth: 1.0, ratio: 0.4 },
  { depth: 2.5, ratio: 1.0 } // 100% damage at 2.5m
];

function getDamageRatio(depth: number): number {
  if (depth <= 0) return 0;
  
  // Fix 1: Use '!' to tell TS "I promise this element exists"
  const max = DAMAGE_CURVE[DAMAGE_CURVE.length - 1]!; 
  
  if (depth >= max.depth) return max.ratio;

  for (let i = 0; i < DAMAGE_CURVE.length - 1; i++) {
    // Fix 2: Use '!' here too
    const p1 = DAMAGE_CURVE[i]!;
    const p2 = DAMAGE_CURVE[i + 1]!;
    
    if (depth >= p1.depth && depth < p2.depth) {
      // Linear interpolation formula
      return p1.ratio + (depth - p1.depth) * (p2.ratio - p1.ratio) / (p2.depth - p1.depth);
    }
  }
  return 0;
}

// --- 3. API ENDPOINT ---
app.get('/api/risk', (req, res) => {
  try {
    const { scenario, year, returnPeriod } = req.query; 
    
    // 1. Sanitize Inputs (Fixing the RP 10 issue)
    const sc = scenario || 'rcp8p5';
    const yr = Number(year) || 2050;
    // Force valid return periods. If user asks for 10, bump it to 25.
    let rp = Number(returnPeriod) || 100;
    const VALID_RPS = [25, 50, 100, 200, 500, 1000];
    if (!VALID_RPS.includes(rp)) {
      console.log(`⚠️ Warning: RP ${rp} is invalid. Defaulting to 25.`);
      rp = 25;
    }

    console.log(`Calculating for: ${sc} / ${yr} / RP${rp}`);

    // 2. Setup GEE Objects
    const pts = ee.FeatureCollection(
      FACTORIES.map(f => ee.Feature(ee.Geometry.Point(f.coords), { pid: f.pid }))
    );

    const dataset = ee.ImageCollection('WRI/Aqueduct_Flood_Hazard_Maps/V2')
      .filter(ee.Filter.eq('floodtype', 'inunriver'))
      .filter(ee.Filter.eq('climatescenario', sc))
      .filter(ee.Filter.eq('returnperiod', rp))
      .filter(ee.Filter.eq('year', yr));
    
    // 3. CHECK IF DATA EXISTS (The Fix!)
    // We use 'evaluate' to check size asynchronously.
    dataset.size().evaluate((count: number, error: any) => {
      if (error) {
        console.error("❌ GEE Error:", error);
        return res.status(500).json({ error: error.message });
      }
      
      if (count === 0) {
        console.warn("⚠️ No data found for this combo. Returning 0s.");
        // Return safe "zero" data instead of hanging
        const emptyResults = FACTORIES.map(f => ({
          ...f, depth_m: 0, financial_loss: 0, risk_level: 'No Data'
        }));
        return res.json(emptyResults);
      }

      // If data exists, proceed...
      const modelPref = dataset.filter(ee.Filter.eq('model', '0000GFDL_ESM2M'));
      const finalCol = ee.ImageCollection(
        ee.Algorithms.If(modelPref.size().gt(0), modelPref, dataset)
      );
      
      const img = ee.Image(finalCol.first()).select('inundation_depth').unmask(0);

      // 4. EXECUTE (Using evaluate instead of getInfo)
      // This prevents the server from freezing while waiting for Google.
      img.reduceRegions({
        collection: pts,
        reducer: ee.Reducer.mean(),
        scale: 30
      }).evaluate((data: any, error: any) => {
        if (error) {
          console.error("❌ Reduction Error:", error);
          return res.status(500).json({ error: error.message });
        }

        // 5. Process Results
        const results = data.features.map((f: any) => {
          const pid = f.properties.pid;
          const factory = FACTORIES.find(fac => fac.pid === pid);
          const depth = f.properties.mean || 0;
          
          const damageRatio = getDamageRatio(depth);
          const loss = (factory?.asset_value || 0) * damageRatio;

          return {
            ...factory,
            depth_m: depth,
            damage_ratio: damageRatio,
            financial_loss: loss,
            risk_level: loss > 10000000 ? 'High' : (loss > 0 ? 'Medium' : 'Low')
          };
        });

        console.log("✅ Data sent to Client!");
        res.json(results);
      });
    });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
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