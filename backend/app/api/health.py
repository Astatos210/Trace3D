import sys
import shutil
import os
import cv2
import open3d as o3d
from fastapi import APIRouter
from pipeline.colmap_runner import find_colmap_executable

router = APIRouter(tags=["Health"])


def _colmap_notice(colmap_path: str | None) -> str | None:
    if colmap_path:
        return None
    return (
        "COLMAP binary is missing from PATH. Real reconstruction will require COLMAP; "
        "Mock Mode is available for frontend UI testing."
    )
    
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

    qt_platform = os.environ.get("QT_QPA_PLATFORM", "not set")
    qt_plugin_path = os.environ.get("QT_QPA_PLATFORM_PLUGIN_PATH", "not set")
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
             "notice": _colmap_notice(colmap_path)
        },
        "qt_headless": {
            "qt_qpa_platform": qt_platform,
            "qt_platform_plugin_path": qt_plugin_path,
            "status": "ok" if qt_platform == "offscreen" else "warn",
            "notice": (
                "COLMAP runs in headless Qt mode (QT_QPA_PLATFORM=offscreen). "
                "This avoids OpenCV-Qt plugin conflicts that cause COLMAP to abort."
                if qt_platform == "offscreen"
                else "QT_QPA_PLATFORM is not set to 'offscreen'. COLMAP may fail due to Qt/OpenCV plugin conflicts in headless environments."
            )
        }
    }
