from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.job_manager import job_manager

router = APIRouter(prefix="/jobs", tags=["Calibration"])


class TwoPointCalibrationRequest(BaseModel):
    p1: List[float] = Field(..., description="[x, y, z] of first point in 3D reconstruction")
    p2: List[float] = Field(..., description="[x, y, z] of second point in 3D reconstruction")
    known_distance_meters: float = Field(..., gt=0.0, description="Real world distance between p1 and p2 in meters")


class GpsCalibrationRequest(BaseModel):
    camera_positions: List[List[float]] = Field(..., description="List of [x, y, z] reconstructed camera centers")
    gps_coordinates: List[Dict[str, float]] = Field(..., description="List of {'lat': ..., 'lon': ..., 'alt': ...}")


class CalibrateRequest(BaseModel):
    method: str = Field(..., description="'two_point' or 'gps'")
    two_point: Optional[TwoPointCalibrationRequest] = None
    gps: Optional[GpsCalibrationRequest] = None


@router.post("/{job_id}/calibrate")
def calibrate_job_endpoint(job_id: str, request: CalibrateRequest):
    """
    Applies metric scale or local ENU georeferencing to a completed job.
    Supports 2-point known-distance scale calibration fallback,
    or GPS trajectory alignment.
    """
    job = job_manager.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found.")

    if job["status"] != "COMPLETED":
        raise HTTPException(
            status_code=400,
            detail="Job must be in COMPLETED status before performing calibration."
        )

    try:
        if request.method == "two_point":
            if not request.two_point:
                raise HTTPException(status_code=400, detail="two_point parameters are required.")
            calib_res = job_manager.calibrate_job(
                job_id=job_id,
                method="two_point",
                params=request.two_point.model_dump()
            )
        elif request.method == "gps":
            if not request.gps:
                raise HTTPException(status_code=400, detail="gps parameters are required.")
            calib_res = job_manager.calibrate_job(
                job_id=job_id,
                method="gps",
                params=request.gps.model_dump()
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported calibration method: {request.method}")

        return {
            "status": "success",
            "job_id": job_id,
            "calibration": calib_res
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
