# 🚁 Drone3D: Single-Pass Drone Video to Metrically Scaled 3D Model Prototype

A production-grade monorepo prototype for turning single-pass aerial drone video into metrically scaled, confidence-scored 3D point clouds and meshes using **FastAPI**, **React + TypeScript + Three.js**, **COLMAP**, and **Open3D**.

---

## 🏛️ Monorepo Architecture

> **Free hosting:** See [Hosting on Hugging Face Spaces (Free)](#-hosting-on-hugging-face-spaces-free) below.

---

```
3D_drone/
├── backend/                  # FastAPI Python backend service
│   ├── app/
│   │   ├── api/              # REST Endpoints: /health, /jobs, /calibrate
│   │   ├── services/         # JobManager, asynchronous pipeline orchestration
│   │   ├── config.py         # App configuration & path discovery
│   │   └── main.py           # FastAPI entrypoint with CORS & static file mounts
│   ├── tests/                # Automated pytest suite (11 unit & integration tests)
│   ├── requirements.txt      # Python dependencies
│   ├── Dockerfile            # Container definition
│   ├── .env.example          # Environment variables template
│   └── .env                  # Local environment configuration
├── pipeline/                 # Modular Python 3D processing pipeline
│   ├── frame_extractor.py    # 1-3 FPS video sampling + variance of Laplacian blur rejection
│   ├── colmap_runner.py      # COLMAP CLI wrapper (feature extraction, matching, mapper, MVS)
│   ├── open3d_processor.py   # Statistical outlier removal, voxel downsampling, normal estimation, meshing
│   ├── metric_calibrator.py  # WGS-84 to ENU, Umeyama 7-DoF similarity transform, 2-point scale fallback
│   └── confidence_estimator.py # Confidence evaluation & monocular depth fill-in
├── frontend/                 # React 19 + TypeScript + Vite + Three.js UI
│   ├── src/
│   │   ├── components/       # Header, VideoUploader, JobProgress, Viewer3D, MetricCalibration, MetricsSummary
│   │   ├── services/         # Typed API client
│   │   ├── App.tsx           # Dashboard layout & state polling
│   │   └── index.css         # Cyber-engineering dark theme
│   ├── package.json
│   └── vite.config.ts
├── data/
│   ├── samples/              # Pre-packaged sample drone video (sample_drone.mp4)
│   └── uploads/              # Uploaded user videos
├── jobs/                     # Working directories per reconstruction job
├── docker-compose.yml        # Docker Compose configuration
└── README.md                 # System documentation
```

---

## 🚀 Key Pipeline Stages

### 1. Frame Extraction & Quality Filtering (`pipeline/frame_extractor.py`)
- Ingests drone MP4/MOV video files.
- Samples video at target rate (1 to 3 FPS) to ensure optimal baseline parallax for Structure-from-Motion.
- Calculates the **variance of the Laplacian** $\text{Var}(\nabla^2 I)$ on each candidate frame.
- Automatically discards blurry frames below the threshold (default: 100.0).
- Persists retained sharp frames and saves full metadata to `frames_meta.json`.

### 2. Sparse Reconstruction with COLMAP (`pipeline/colmap_runner.py`)
- Detects the `colmap` executable on `PATH` or via `COLMAP_EXE_PATH`.
- Provides an explicit, informative error message if COLMAP is missing.
- When COLMAP is present:
  1. `feature_extractor` (SIFT keypoints with SIMPLE_RADIAL camera model)
  2. `sequential_matcher` (optimized for sequential aerial passes)
  3. `mapper` (incremental bundle adjustment)
  4. `model_converter` (exports sparse point cloud to PLY)
- Parses registered images count and fails early if fewer than 3 cameras register.
- **Strict Mock Mode**: When COLMAP is missing on development machines, a clearly labeled Mock Mode is available for frontend UI testing. Data is explicitly tagged with `"is_mock": true` and marked with visual warning banners.

### 3. Dense Stereo & Open3D Processing (`pipeline/open3d_processor.py`)
- Runs COLMAP `image_undistorter`, `patch_match_stereo`, and `stereo_fusion`.
- Open3D Post-Processing:
  - **Statistical Outlier Removal**: Filters noisy sky and floating points (`nb_neighbors=20`, `std_ratio=2.0`).
  - **Voxel Downsampling**: Regularizes point density (`voxel_size=0.05m`).
  - **Normal Estimation**: Estimates tangent-plane-consistent surface normals.
  - **Poisson Surface Meshing**: Reconstructs watertight surface mesh cropped to point cloud bounds.
  - Exports filtered point cloud as `point_cloud.ply` and mesh as `mesh.ply` / `mesh.glb`.
  - Records point count, triangle count, and bounding box dimensions in `metrics.json`.

### 4. Metric Calibration & Georeferencing (`pipeline/metric_calibrator.py`)
- **WGS-84 to Local ENU Coordinates**: Converts drone GPS latitude, longitude, and ellipsoidal altitude into local East, North, Up cartesian coordinates in meters.
- **Umeyama 7-DoF Similarity Transform**: Solves for optimal scale $s$, rotation $R \in SO(3)$, and translation $t$ aligning camera trajectory to GPS coordinates:
  $$\hat{Y} = s R X + t$$
- **2-Point Known-Distance Fallback**: Allows the user to select two reconstructed 3D points $(p_1, p_2)$ in the browser, input the known real-world physical distance $d_{\text{real}}$, and scales the model:
  $$s = \frac{d_{\text{real}}}{\|p_1 - p_2\|}$$
- **Accuracy Disclaimer**: Consumer drone GPS alignment is strictly labeled as **Approximate GPS Georeferencing** ($\pm 2 \text{ to } 5\text{m}$ residual RMSE). Centimeter accuracy is never claimed without RTK, PPK, or surveyed Ground Control Points (GCPs).

### 5. Confidence-Aware Geometry Layer (`pipeline/confidence_estimator.py`)
- Multi-view stereo validated points receive high confidence ($C \ge 0.8$, rendered in **Green**).
- Sparse points receive medium confidence ($0.4 \le C < 0.8$, rendered in **Yellow**).
- Inferred / monocular depth fill-in regions receive low confidence ($C < 0.4$, rendered in **Red/Orange**).
- Interactive 3D viewer supports switching between **RGB True Color**, **Confidence Heatmap**, and **High Confidence Only** filter.

---

## 🛠️ Quickstart Installation

### Prerequisites
- **Python 3.10 - 3.14**
- **Node.js 18+ & npm**
- **COLMAP** (Optional for local UI preview via Mock Mode, required for real SfM/MVS reconstruction):
  - Windows (recommended): `powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup_colmap.ps1` — installs a portable COLMAP into `tools/colmap` which the backend auto-detects. Or download the `colmap-x64-windows-nocuda.zip` (CPU) or `-cuda.zip` (NVIDIA GPU) from [COLMAP Releases](https://github.com/colmap/colmap/releases) and add its `bin/` to `PATH` (or set `COLMAP_EXE_PATH`).
  - Ubuntu/Debian: `sudo apt-get install colmap ffmpeg`
  - Docker: COLMAP is already baked into the image — no install needed.

### 1. Backend Setup
```bash
# Clone and enter directory
cd backend

# Install dependencies
python -m pip install -r requirements.txt

# Run pytest unit & integration test suite
python -m pytest tests -v

# Start FastAPI backend server
python -m uvicorn app.main:app --host 0.0.0.0 --port 5173 --reload
```
API Documentation will be accessible at: `http://localhost:5173/docs`.

### 2. Frontend Setup
```bash
cd ../frontend

# Install frontend dependencies
npm install

# Run Vite development server
npm run dev
```
Open `http://localhost:3000` in your browser.

### 3. Docker Compose Setup (Alternative)
```bash
docker-compose up --build
```

---

## 🧪 Automated Test Verification

All unit and integration tests are automated via `pytest`:
```bash
python -m pytest backend/tests -v
```

### Verified Test Results
```
backend/tests/test_api.py::test_health_check_endpoint PASSED             [  9%]
backend/tests/test_api.py::test_list_samples_endpoint PASSED             [ 18%]
backend/tests/test_api.py::test_create_and_process_job_mock_mode PASSED  [ 27%]
backend/tests/test_confidence.py::test_confidence_to_rgb_color_mapping PASSED [ 36%]
backend/tests/test_confidence.py::test_align_relative_depth_to_metric PASSED [ 45%]
backend/tests/test_confidence.py::test_compute_point_cloud_confidence_processing PASSED [ 54%]
backend/tests/test_frames.py::test_compute_laplacian_variance_sharp_vs_blurry PASSED [ 63%]
backend/tests/test_frames.py::test_extract_frames_on_synthetic_video PASSED [ 72%]
backend/tests/test_georef.py::test_wgs84_enu_conversion PASSED           [ 81%]
backend/tests/test_georef.py::test_umeyama_similarity_transform PASSED   [ 90%]
backend/tests/test_georef.py::test_calibrate_scale_from_two_points PASSED [100%]

======================== 11 passed in 3.33s ========================
```

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | System tool health check (OpenCV, Open3D, FFmpeg, COLMAP) |
| `POST` | `/api/jobs` | Submit drone video or sample for 3D reconstruction |
| `GET` | `/api/jobs` | List all historical reconstruction jobs |
| `GET` | `/api/jobs/{id}` | Get full job metadata, metrics, and file output URLs |
| `GET` | `/api/jobs/{id}/status` | Lightweight status polling endpoint (stage, progress, logs) |
| `POST` | `/api/jobs/{id}/calibrate` | Apply 2-point scale calibration or GPS trajectory alignment |
| `GET` | `/api/jobs/samples` | List available pre-packaged sample videos |
| `GET` | `/jobs/{id}/...` | Static asset serving for `.ply` point clouds, `.glb` meshes, and `.json` metrics |

---

## ☁️ Hosting on Hugging Face Spaces (Free)

The whole stack ships as a single container: the React SPA is built at image-build time and served directly by FastAPI, with COLMAP + FFmpeg + Open3D inside.

### Deploy steps (no credit card, no server)

1. Push this repository to a **public GitHub repo**.
2. Go to [huggingface.co/new-space](https://huggingface.co/new-space) → **Create Space**.
3. Fill in:
   - **Space name:** e.g. `drone3d`
   - **License:** any
   - **SDK:** select **Docker** → **Blank**
   - **Hardware:** **CPU basic · 2 vCPU · 16 GB** (the free tier)
4. In the Space, open **Files** → **Add file** → **Upload files from git-terminal** and push this whole repo (the root `Dockerfile` is what HF builds — it expects to sit at the repo root).
   - The easiest way: `git clone https://huggingface.co/spaces/<YOUR_USERNAME>/drone3d`, copy this project into it, `git add . && git commit -m "Deploy" && git push`.
5. Wait for the build (~5–10 min the first time; COLMAP is a big install). Live logs are on the **App** tab.
6. Done — your site is at `https://<YOUR_USERNAME>-drone3d.hf.space`.

### Free-tier caveats (be honest about them)

- **Storage is ephemeral:** every Space restart wipes `jobs/` and `data/uploads/`. Finished reconstructions disappear on rebuild/sleep/wake — download the `.ply`/`.glb` outputs you care about.
- **Sleeping:** free Spaces sleep after ~48h of inactivity and take a couple of minutes to cold-start on the next visit.
- **Heavy jobs:** COLMAP MVS on long videos can exceed the free CPU quota — the Space will run slowly, not break. Keep sample clips short.

### Alternative free options

| Option | Works? | Notes |
|---|---|---|
| **HF Spaces (Docker)** | ✅ Best fit | Full pipeline incl. COLMAP; ephemeral disk |
| **GitHub + Vercel + HF hybrid** | ✅ Works | Beautiful Vercel URL + CDN for the UI; heavy work still runs on HF (see below) |
| Render / Railway free tier | ⚠️ Partial | Free VMs are tiny (512 MB); Mock Mode only, COLMAP won't fit |
| Vercel / Netlify static only | ❌ Backend impossible | Vercel functions can't run COLMAP (long, stateful, subprocess-heavy) |
| Oracle Cloud Always Free (x86) | ✅ Real server | 4 ARM/x86 cores, 24 GB RAM, permanent; needs a VPS-style setup (Option 1 in the README) |

### GitHub + Vercel + Hugging Face (split hosting)

You **can** use GitHub + Vercel — for the frontend. The catch: Vercel has no VM, and its serverless functions cannot run COLMAP (multi-minute subprocess pipelines writing to disk). So this hybrid keeps the heavy work on the free HF Space and gets a slick Vercel URL + global CDN for the UI:

1. Deploy the backend once on HF Spaces (steps above) — note your URL, e.g. `https://youruser-drone3d.hf.space`.
2. Push this repo to GitHub.
3. On [vercel.com](https://vercel.com) → **Add New Project** → import the GitHub repo.
4. Vercel auto-detects Vite. Set:
   - **Root Directory:** `frontend`
   - **Environment variable:** `VITE_API_BASE` = `https://youruser-drone3d.hf.space`
5. Replace the two `YOUR-SPACE.hf.space` placeholders in `vercel.json` with your real Space URL, commit, and deploy.
6. Your site is live at `https://your-project.vercel.app`.

How it works: `VITE_API_BASE` is baked into the frontend bundle at build time (`frontend/src/services/api.ts`), so all API calls, PLY downloads, and artifact links point at the Space origin. The `vercel.json` rewrites also proxy `/api`, `/jobs`, and `/data` through Vercel, so the browser sees a single origin and no CORS setup is needed. Leave `VITE_API_BASE` unset and everything stays same-origin (Docker/SPA/nginx modes) — default behavior is unchanged.

Caveats: the Space's ephemeral-disk and sleep caveats still apply; and Vercel's free proxy has a 60s edge timeout, plenty for API polling but short for an upload-plus-start round trip — large videos should be uploaded directly from the browser to the backend URL if that ever bites.

## ⚖️ Project Standards & Disclaimer
- **No Fabricated Outputs**: All metrics, point counts, and processing times reflect actual computation. If COLMAP is not detected, normal mode raises an explicit error and only the clearly tagged Mock Mode displays demo geometry.
- **Geodetic Accuracy**: Single-pass consumer drone flights cannot deliver centimeter accuracy without RTK/PPK GNSS receivers or ground-surveyed check points. Output georeferencing is transparently labeled as approximate.
