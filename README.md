# TCFD Physical Risk Assessment Dashboard

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![React](https://img.shields.io/badge/frontend-React%20%2B%20Vite-61DAFB)
![Node](https://img.shields.io/badge/backend-Node.js%20%2B%20Express-339933)
![GEE](https://img.shields.io/badge/data-Google%20Earth%20Engine-4285F4)

**A full-stack web application for quantifying and visualizing climate-related physical risks (Riverine Flooding) in alignment with TCFD recommendations.**

![messageImage_1771334699174](https://github.com/user-attachments/assets/810da16b-2db7-40b7-bd13-9f69d3d588b3)

## Live Demo
> **[View Live Dashboard](https://tcfd-dashboard.vercel.app)**
> *(Note: The backend runs on a free instance and may take 30-50 seconds to wake up on the first request.)*

---

## Project Overview

This dashboard helps sustainability consultants and asset managers assess the **financial impact of climate change** on physical assets. By integrating **Google Earth Engine (GEE)** with a custom web interface, it allows users to:

1.  **Upload Portfolio Data:** Analyze hundreds of factory/commercial sites instantly via CSV.
2.  **Scenario Analysis:** Toggle between different IPCC scenarios (RCP 4.5, RCP 8.5) and time horizons (2030, 2050, 2080).
3.  **3D Visualization:** View flood inundation depths directly on a 3D interactive globe.
4.  **Financial Quantification:** Estimate potential asset damage using industry-specific Depth-Damage Functions.

---

## Key Features

* **🌍 Global Coverage:** Uses the WRI Aqueduct Flood Hazard Maps (via GEE) to assess risk anywhere in the world.
* **🏭 Industry vs. Commercial Logic:** Applies different damage curves based on asset type (e.g., machinery is more sensitive to depth than office furniture).
* **📊 Interactive Charts:** Real-time visualization of flood depth (m) and estimated financial loss ($).
* **📥 CSV Export:** Download analysis results with full UTF-8 support (compatible with Excel).
* **🗺️ 3D Extrusion Maps:** Visualizes risk magnitude using Mapbox GL JS 3D extrusions.

---

## Tech Stack

### **Frontend (Client)**
* **Framework:** React (Vite) + TypeScript
* **Maps:** Mapbox GL JS
* **Charts:** Recharts
* **Data Handling:** PapaParse (CSV parsing)
* **Hosting:** Vercel

### **Backend (Server)**
* **Runtime:** Node.js + Express
* **Language:** TypeScript
* **Geospatial Engine:** Google Earth Engine (GEE) Python/Node API
* **Authentication:** Google Service Account (Private Key)
* **Hosting:** Render

---

## Methodology

### 1. Flood Hazard Data
The application queries the **WRI Aqueduct Flood Hazard Maps** stored in Google Earth Engine. It retrieves inundation depth based on:
* **Return Period:** 1-in-100 year (Standard), 1-in-500 year, etc.
* **Climate Scenario:** RCP 4.5 (Moderate) vs. RCP 8.5 (High Emissions).
* **Model:** Aggregated GCMs (General Circulation Models).

### 2. Financial Loss Calculation
We utilize **Depth-Damage Functions** to translate flood depth into financial loss. To ensure precision, we apply **linear interpolation** between the defined data points, allowing for continuous damage estimation at any specific depth.
* **Industrial Assets:** High sensitivity to low-level flooding (machinery damage).
* **Commercial Assets:** Moderate sensitivity (structural/inventory damage).

**$$\text{Financial Loss} = \text{Asset Value} \times \text{Damage Ratio}$$**

| Depth (m)     | Industry Ratio | Commercial Ratio |
|:------------- |:-------------- |:---------------- |
| `0.0`         | 0.00           | 0.00             |
| `0.5`         | 0.28           | 0.38             |
| `1.0`         | 0.48           | 0.54             |
| `1.5`         | -              | 0.66             |
| `2.0`         | 0.72           | 0.76             |
| `3.0`         | 0.86           | 0.88             |
| `4.0`         | 0.91           | 0.94             |
| `5.0`         | 0.96           | 0.98             |
| `6.0`         | 1.00           | 1.00             |

### 3. Data Source
Riverine flood inundation:  [Aqueduct Flood Hazard Maps Version 2 (2020), World Resources Institute](https://developers.google.com/earth-engine/datasets/catalog/WRI_Aqueduct_Flood_Hazard_Maps_V2)

Flood depth-damage functions: [Huizinga, J., de Moel, H., Szewczyk, W. (2017). Global flood depth-damage functions. Methodology and the database with guidelines. EUR 28552 EN. doi: 10.2760/16510](https://publications.jrc.ec.europa.eu/repository/handle/JRC105688?mode=full)

---

## Getting Started (Local Development)

### 1. Clone the Repo
```bash
git clone [https://github.com/your-username/tcfd-dashboard.git](https://github.com/your-username/tcfd-dashboard.git)
cd tcfd-dashboard
```

### 2. Backend Setup
```bash
cd server
npm install
```
1. Create a `ee-key.json` file in the root directory with your Google Service Account key.
2. Run the server:
```bash
npm run dev
```

### 3. Frontend Setup
```bash
cd client
npm install
```
1. Create a `.env` file in the `client` folder:
```env
VITE_MAPBOX_TOKEN=pk.eyJ1In... (Your Mapbox Token)
VITE_API_URL=http://localhost:3001
```
2. Run the client:
```bash
npm run dev
```

---

## CSV Template Format

To analyze your own data, upload a CSV file with the following columns.  
> **Note:** Ensure the file is saved as **UTF-8 with BOM** if using Chinese characters.

| Column Name   | Type   | Description |
|:------------- |:------ |:----------- |
| `name`        | String | Name of the site (e.g., "Taipei HQ") |
| `lat`         | Number | Latitude (e.g., 25.0330) |
| `lon`         | Number | Longitude (e.g., 121.5654) |
| `asset_value` | Number | Total value of the asset (in local currency) |
| `type`        | String | `commercial` or `industry` |

**Example:**
```csv
name,lat,lon,asset_value,type
Taipei Plant,25.1105,121.4988,5000000,industry
Tokyo Office,35.6667,139.8667,25000000,commercial
```

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Contact

**Brian Lee 李適軒** [LinkedIn](https://www.linkedin.com/in/brianlee043/) | [Email](mailto:leebrian0908@gmail.com)

Consultant

ESG Strategy & Sustainability Service, Ernst & Young Taiwan 安永聯合會計師事務所

> *Developed as a capstone project for visualizing climate risk in financial reporting.*
