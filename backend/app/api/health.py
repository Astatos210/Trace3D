import sys
import shutil
import cv2
import open3d as o3d
from fastapi import APIRouter
from pipeline.colmap_runner import find_colmap_executable

router = APIRouter(tags=["Health"])


@router.get("/health")
def health_check():
    colmap_path = find_colmap_executable()
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        try:
            import imageio_ffmpeg
            ffmpeg_path = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ffmpeg_path = None

    return {
        "status": "online",
        "python_version": sys.version,
        "opencv_version": cv2.__version__,
        "open3d_version": o3d.__version__,
        "ffmpeg": {
            "available": ffmpeg_path is not None,
            "path": ffmpeg_path
        },
        "colmap": {
            "available": colmap_path is not None,
            "path": colmap_path,
            "notice": None if colmap_path else "COLMAP binary is missing from PATH. Real reconstruction will require COLMAP; Mock Mode is available for frontend UI testing."
        }
    }
