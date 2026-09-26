import os
import json
import uuid
import time
import logging
import threading
from pathlib import Path
from typing import Dict, Any, Optional, List
from concurrent.futures import ThreadPoolExecutor

from backend.app.config import settings
from pipeline.frame_extractor import extract_frames
from pipeline.colmap_runner import (
    run_sparse_reconstruction,
    run_dense_reconstruction,
    ColmapNotFoundError,
    ColmapExecutionError
)
from pipeline.open3d_processor import process_point_cloud, apply_metric_scale_to_outputs
from pipeline.confidence_estimator import compute_point_cloud_confidence
from pipeline.metric_calibrator import calibrate_scale_from_two_points, calibrate_with_gps

logger = logging.getLogger("backend.job_manager")


class JobManager:
    def __init__(self, jobs_dir: Path):
        self.jobs_dir = jobs_dir
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.executor = ThreadPoolExecutor(max_workers=2)
        self._load_existing_jobs()

    def _load_existing_jobs(self):
        """Loads metadata for previously created jobs from disk."""
        for job_folder in self.jobs_dir.iterdir():
            if job_folder.is_dir():
                job_meta_file = job_folder / "job.json"
                if job_meta_file.exists():
                    try:
                        with open(job_meta_file, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            self.jobs[data["id"]] = data
                    except Exception as e:
                        logger.warning(f"Could not load job {job_folder.name}: {e}")

    def create_job(
        self,
        video_path: str,
        sample_fps: float = 2.0,
        blur_threshold: float = 100.0,
        voxel_size: float = 0.05,
        mock_mode: bool = False
    ) -> Dict[str, Any]:
        """Creates a new reconstruction job and submits it to the background executor."""
        job_id = str(uuid.uuid4())[:8]
        job_dir = self.jobs_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)

        job_info: Dict[str, Any] = {
            "id": job_id,
            "created_at": time.time(),
            "status": "QUEUED",
            "stage": "QUEUED",
            "progress": 0,
            "video_path": video_path,
            "job_dir": str(job_dir),
            "sample_fps": sample_fps,
            "blur_threshold": blur_threshold,
            "voxel_size": voxel_size,
            "mock_mode": mock_mode,
            "registered_images": 0,
            "point_count": 0,
            "mesh_triangle_count": 0,
            "scale_factor": 1.0,
            "logs": ["Job queued."],
            "error": None,
            "outputs": {},
            "metrics": {}
        }

        with self.lock:
            self.jobs[job_id] = job_info
            self._save_job_to_disk(job_id)

        self.executor.submit(self._run_pipeline, job_id)
        return job_info

    def _update_job(self, job_id: str, **kwargs):
        """Thread-safe update to job metadata."""
        with self.lock:
            if job_id in self.jobs:
                for k, v in kwargs.items():
                    if k == "log":
                        self.jobs[job_id]["logs"].append(f"[{time.strftime('%H:%M:%S')}] {v}")
                    else:
                        self.jobs[job_id][k] = v
                self._save_job_to_disk(job_id)

    def _save_job_to_disk(self, job_id: str):
        job_data = self.jobs.get(job_id)
        if job_data:
            job_file = Path(job_data["job_dir"]) / "job.json"
            try:
                with open(job_file, "w", encoding="utf-8") as f:
                    json.dump(job_data, f, indent=2)
            except Exception as e:
                logger.error(f"Failed to persist job {job_id}: {e}")

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            return self.jobs.get(job_id)

    def list_jobs(self) -> List[Dict[str, Any]]:
        with self.lock:
            return sorted(list(self.jobs.values()), key=lambda j: j["created_at"], reverse=True)

    def _run_pipeline(self, job_id: str):
        """Executes all stages of the 3D reconstruction pipeline."""
        job = self.get_job(job_id)
        if not job:
            return

        job_dir = Path(job["job_dir"])
        video_path = job["video_path"]
        sample_fps = job["sample_fps"]
        blur_threshold = job["blur_threshold"]
        voxel_size = job["voxel_size"]
        mock_mode = job["mock_mode"]

        frames_dir = job_dir / "frames"
        recon_dir = job_dir / "reconstruction"
        output_dir = job_dir / "output"

        try:
            # Stage 1: Frame Extraction & Quality Filtering
            self._update_job(
                job_id,
                status="PROCESSING",
                stage="EXTRACTING_FRAMES",
                progress=10,
                log=f"Extracting frames at {sample_fps} FPS with blur threshold {blur_threshold}..."
            )
            frames_meta = extract_frames(
                video_path=video_path,
                output_dir=str(frames_dir),
                sample_fps=sample_fps,
                blur_threshold=blur_threshold
            )
            sharp_count = frames_meta["extracted_sharp_count"]
            rejected_count = frames_meta["rejected_blurry_count"]
            self._update_job(
                job_id,
                log=f"Extracted {sharp_count} sharp frames ({rejected_count} blurry frames rejected).",
                progress=25
            )

            if sharp_count < 3:
                raise ValueError(
                    f"Too few sharp frames extracted ({sharp_count} < 3). "
                    "Cannot perform 3D reconstruction. Lower the blur threshold or provide a longer video."
                )

            # Stage 2: Sparse Reconstruction (COLMAP)
            self._update_job(
                job_id,
                stage="SPARSE_RECONSTRUCTION",
                progress=30,
                log="Running feature extraction and sparse structure-from-motion..."
            )
            sparse_result = run_sparse_reconstruction(
                images_dir=str(frames_dir),
                output_dir=str(recon_dir),
                mock_mode=mock_mode
            )
            registered_count = sparse_result["registered_images"]
            self._update_job(
                job_id,
                registered_images=registered_count,
                progress=50,
                log=f"Sparse reconstruction finished: {registered_count} cameras registered."
            )

            # Stage 3: Dense Reconstruction (COLMAP MVS)
            self._update_job(
                job_id,
                stage="DENSE_RECONSTRUCTION",
                progress=55,
                log="Running PatchMatch stereo and multi-view stereo fusion..."
            )
            dense_result = run_dense_reconstruction(
                images_dir=str(frames_dir),
                sparse_dir=sparse_result["sparse_dir"],
                output_dir=str(recon_dir),
                mock_mode=mock_mode
            )
            dense_ply = dense_result["dense_ply"]
            self._update_job(
                job_id,
                progress=75,
                log=dense_result.get("notice") or "Dense stereo fusion finished."
            )

            # Stage 4: Open3D Filtering & Meshing
            self._update_job(
                job_id,
                stage="OPEN3D_PROCESSING",
                progress=80,
                log="Applying Open3D statistical outlier removal, voxel downsampling, and meshing..."
            )
            o3d_metrics = process_point_cloud(
                input_ply=dense_ply,
                output_dir=str(output_dir),
                voxel_size=voxel_size,
                generate_mesh=True
            )
            self._update_job(
                job_id,
                point_count=o3d_metrics["filtered_point_count"],
                mesh_triangle_count=o3d_metrics["mesh_triangle_count"],
                progress=90,
                log=f"Open3D processing finished: {o3d_metrics['filtered_point_count']} points, {o3d_metrics['mesh_triangle_count']} triangles."
            )

            # Stage 5: Confidence Scoring Layer
            self._update_job(
                job_id,
                stage="CONFIDENCE_SCORING",
                progress=95,
                log="Evaluating multi-view geometric confidence and monocular fill..."
            )
            conf_metrics = compute_point_cloud_confidence(
                input_ply=o3d_metrics["files"]["filtered_point_cloud"],
                output_dir=str(output_dir),
                simulate_monocular_fill=True
            )
            self._update_job(
                job_id,
                log=f"Confidence evaluated: {conf_metrics['high_confidence_pct']}% high confidence points."
            )

            # Relative URLs for frontend access
            outputs = {
                "frames_meta": f"/jobs/{job_id}/frames/frames_meta.json",
                "sparse_ply": f"/jobs/{job_id}/reconstruction/sparse_points.ply" if sparse_result.get("sparse_ply") else None,
                "dense_ply": f"/jobs/{job_id}/output/point_cloud.ply",
                "mesh_ply": f"/jobs/{job_id}/output/mesh.ply" if o3d_metrics["files"]["mesh_ply"] else None,
                "mesh_obj": f"/jobs/{job_id}/output/mesh.obj" if o3d_metrics["files"]["mesh_obj"] else None,
                "mesh_glb": f"/jobs/{job_id}/output/mesh.glb" if o3d_metrics["files"]["mesh_glb"] else None,
                "confidence_ply": f"/jobs/{job_id}/output/confidence_pcd.ply",
                "metrics_json": f"/jobs/{job_id}/output/metrics.json"
            }

            combined_metrics = {
                "job_id": job_id,
                "is_mock": mock_mode or sparse_result.get("is_mock", False),
                "dense_mode": "mock" if dense_result.get("is_mock") else (
                    "sparse_fallback" if dense_result.get("status") == "success_sparse_fallback" else "mvs"
                ),
                "dense_notice": dense_result.get("notice"),
                "registered_images": registered_count,
                "total_frames_extracted": sharp_count,
                "blurry_frames_rejected": rejected_count,
                "point_count": o3d_metrics["filtered_point_count"],
                "mesh_triangle_count": o3d_metrics["mesh_triangle_count"],
                "bounding_box": o3d_metrics["bounding_box"],
                "confidence": conf_metrics,
                "scale_factor": 1.0,
                "accuracy_grade": "uncalibrated_arbitrary_scale"
            }

            metrics_path = output_dir / "metrics.json"
            with open(metrics_path, "w", encoding="utf-8") as f:
                json.dump(combined_metrics, f, indent=2)

            self._update_job(
                job_id,
                status="COMPLETED",
                stage="COMPLETED",
                progress=100,
                outputs=outputs,
                metrics=combined_metrics,
                log="Pipeline finished successfully!"
            )

        except (ColmapNotFoundError, ColmapExecutionError) as e:
            logger.error(f"COLMAP error in job {job_id}: {e}")
            self._update_job(
                job_id,
                status="FAILED",
                stage="FAILED",
                error=str(e),
                log=f"COLMAP Error: {e}"
            )
        except Exception as e:
            logger.exception(f"Unexpected error in job {job_id}: {e}")
            self._update_job(
                job_id,
                status="FAILED",
                stage="FAILED",
                error=str(e),
                log=f"Fatal Error: {e}"
            )

    def calibrate_job(
        self,
        job_id: str,
        method: str,
        params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Applies 2-point scale calibration or GPS trajectory calibration to a completed job."""
        job = self.get_job(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found.")

        if method == "two_point":
            p1 = params["p1"]
            p2 = params["p2"]
            dist_m = float(params["known_distance_meters"])
            calib = calibrate_scale_from_two_points(p1, p2, dist_m)
        elif method == "gps":
            cam_pts = params["camera_positions"]
            gps_pts = params["gps_coordinates"]
            calib = calibrate_with_gps(cam_pts, gps_pts)
        else:
            raise ValueError(f"Unknown calibration method: {method}")

        # Update metrics
        scale_val = calib["scale_factor"]
        job["scale_factor"] = scale_val
        job["metrics"]["calibration"] = calib
        job["metrics"]["scale_factor"] = scale_val
        job["metrics"]["accuracy_grade"] = calib["accuracy_grade"]

        # Apply physical scale to point clouds and 3D triangular meshes
        output_dir = Path(job["job_dir"]) / "output"
        scaled_files = apply_metric_scale_to_outputs(str(output_dir), scale_val)
        if "scaled_mesh_ply" in scaled_files:
            job["outputs"]["scaled_mesh_ply"] = f"/jobs/{job_id}/output/scaled_mesh.ply"
        if "scaled_mesh_obj" in scaled_files:
            job["outputs"]["scaled_mesh_obj"] = f"/jobs/{job_id}/output/scaled_mesh.obj"
        if "scaled_point_cloud" in scaled_files:
            job["outputs"]["scaled_point_cloud"] = f"/jobs/{job_id}/output/scaled_point_cloud.ply"

        # Update bounding box with scaled dimensions in real meters
        if "bounding_box" in job["metrics"]:
            orig_extent = job["metrics"]["bounding_box"].get("extent", [0, 0, 0])
            job["metrics"]["scaled_bounding_box_meters"] = [round(float(v) * scale_val, 3) for v in orig_extent]

        # Persist updated metrics
        metrics_file = output_dir / "metrics.json"
        if metrics_file.exists():
            with open(metrics_file, "w", encoding="utf-8") as f:
                json.dump(job["metrics"], f, indent=2)

        self._update_job(
            job_id,
            scale_factor=scale_val,
            outputs=job["outputs"],
            metrics=job["metrics"],
            log=f"Applied metric calibration ({method}): scale={scale_val:.4f}x. Scaled mesh & point cloud regenerated."
        )

        return calib


job_manager = JobManager(settings.jobs_dir)
