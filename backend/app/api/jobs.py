import os
import shutil
from pathlib import Path
from typing import Optional, List
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Query
from pydantic import BaseModel

from backend.app.config import settings
from backend.app.services.job_manager import job_manager

router = APIRouter(prefix="/jobs", tags=["Jobs"])


@router.post("")
async def create_job(
    file: Optional[UploadFile] = File(None),
    sample_name: Optional[str] = Form(None),
    sample_fps: float = Form(2.0),
    blur_threshold: float = Form(100.0),
    voxel_size: float = Form(0.05),
    mock_mode: bool = Form(False)
):
    """
    Creates and starts a drone video 3D reconstruction job.
    Accepts an uploaded MP4 video, or points to an existing sample video.
    """
    video_path: Optional[Path] = None

    if file:
        if not file.filename.lower().endswith((".mp4", ".mov", ".avi", ".mkv")):
            raise HTTPException(status_code=400, detail="Invalid video format. Please upload MP4/MOV.")
        
        save_filename = f"upload_{os.urandom(4).hex()}_{file.filename}"
        dest_path = settings.uploads_dir / save_filename
        with open(dest_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        video_path = dest_path

    elif sample_name:
        sample_path = settings.samples_dir / sample_name
        if not sample_path.exists():
            raise HTTPException(status_code=404, detail=f"Sample video '{sample_name}' not found.")
        video_path = sample_path

    else:
        # Check if default sample video exists
        default_sample = settings.samples_dir / "sample_drone.mp4"
        if default_sample.exists():
            video_path = default_sample
        else:
            raise HTTPException(
                status_code=400,
                detail="No video file uploaded and no sample selected. Please upload an MP4 file."
            )

    job = job_manager.create_job(
        video_path=str(video_path),
        sample_fps=sample_fps,
        blur_threshold=blur_threshold,
        voxel_size=voxel_size,
        mock_mode=mock_mode
    )

    return job


@router.get("")
def list_jobs():
    """Lists all created jobs."""
    return job_manager.list_jobs()


@router.get("/samples")
def list_samples():
    """Lists available sample video clips in data/samples."""
    samples = []
    for f in settings.samples_dir.iterdir():
        if f.suffix.lower() in [".mp4", ".mov", ".avi"]:
            samples.append({
                "name": f.name,
                "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
                "path": str(f)
            })
    return samples


@router.get("/{job_id}")
def get_job(job_id: str):
    """Retrieves full job details and metadata."""
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")
    return job


@router.get("/{job_id}/status")
def get_job_status(job_id: str):
    """
    Lightweight polling endpoint returning current status, pipeline stage,
    progress percentage, registered frame count, and recent logs.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    return {
        "id": job["id"],
        "status": job["status"],
        "stage": job["stage"],
        "progress": job["progress"],
        "registered_images": job.get("registered_images", 0),
        "point_count": job.get("point_count", 0),
        "mesh_triangle_count": job.get("mesh_triangle_count", 0),
        "scale_factor": job.get("scale_factor", 1.0),
        "error": job.get("error"),
        "recent_logs": job["logs"][-5:],
        "mock_mode": job.get("mock_mode", False),
        "outputs": job.get("outputs", {})
    }
