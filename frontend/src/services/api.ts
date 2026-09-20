export interface HealthStatus {
  status: string;
  python_version: string;
  opencv_version: string;
  open3d_version: string;
  ffmpeg: {
    available: boolean;
    path: string | null;
  };
  colmap: {
    available: boolean;
    path: string | null;
    notice: string | null;
  };
}

export interface JobStatus {
  id: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  stage: string;
  progress: number;
  registered_images: number;
  point_count: number;
  mesh_triangle_count: number;
  scale_factor: number;
  error: string | null;
  recent_logs: string[];
  mock_mode: boolean;
  outputs: {
    frames_meta?: string;
    sparse_ply?: string;
    dense_ply?: string;
    mesh_ply?: string;
    mesh_glb?: string;
    confidence_ply?: string;
    metrics_json?: string;
  };
}

export interface SampleVideo {
  name: string;
  size_mb: number;
  path: string;
}

export interface CalibrationResult {
  method: string;
  p1?: number[];
  p2?: number[];
  reconstructed_distance_units?: number;
  known_distance_meters?: number;
  scale_factor: number;
  accuracy_grade: string;
  disclaimer: string;
  georeferencing_rmse_meters?: number;
}

// Deployment modes:
//  - Same-origin (Docker/SPA/nginx): default, relative paths hit the co-located FastAPI.
//  - Split hosting (e.g. static frontend on Vercel + backend on a VM/Space): set
//    VITE_API_BASE at build time to the backend origin, e.g. "https://user-space.hf.space".
const RAW_API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined)?.trim() || '';
const API_BASE = `${RAW_API_BASE}/api`;

// Origin serving /jobs and /data artifacts. Same as API origin unless overridden.
export const ASSETS_BASE = RAW_API_BASE || ''; // artifact paths like /jobs/<id>/output/x.ply

// Prefix a backend-relative artifact path (e.g. /jobs/<id>/output/cloud.ply) with
// the backend origin when the frontend is hosted separately (Vercel + VM backend).
export function assetUrl(path: string | undefined | null): string {
  if (!path) return '';
  if (/^(https?:)?\/\//i.test(path)) return path; // already absolute
  return `${RAW_API_BASE}${path}`;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.statusText}`);
  return res.json();
}

export async function fetchSamples(): Promise<SampleVideo[]> {
  const res = await fetch(`${API_BASE}/jobs/samples`);
  if (!res.ok) throw new Error(`Fetch samples failed: ${res.statusText}`);
  return res.json();
}

export async function createJob(formData: FormData): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    body: formData
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Failed to submit job');
  }
  return res.json();
}

export async function fetchJobStatus(jobId: string): Promise<JobStatus> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/status`);
  if (!res.ok) throw new Error(`Fetch job status failed: ${res.statusText}`);
  return res.json();
}

export async function fetchJobDetails(jobId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Fetch job details failed: ${res.statusText}`);
  return res.json();
}

export async function calibrateJob(jobId: string, payload: any): Promise<{ calibration: CalibrationResult }> {
  const res = await fetch(`${API_BASE}/jobs/${jobId}/calibrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || 'Calibration failed');
  }
  return res.json();
}
