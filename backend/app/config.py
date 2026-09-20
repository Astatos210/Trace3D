import os
from pathlib import Path
from pydantic import BaseModel
from pipeline.colmap_runner import find_colmap_executable

# Base directories
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = DATA_DIR / "uploads"
SAMPLES_DIR = DATA_DIR / "samples"
JOBS_DIR = BASE_DIR / "jobs"

UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
JOBS_DIR.mkdir(parents=True, exist_ok=True)


class Settings(BaseModel):
    app_name: str = "Drone 3D Reconstruction API"
    version: str = "1.0.0"
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", 5173))
    debug: bool = os.getenv("DEBUG", "True").lower() in ("true", "1")

    # Storage paths
    base_dir: Path = BASE_DIR
    data_dir: Path = DATA_DIR
    uploads_dir: Path = UPLOADS_DIR
    samples_dir: Path = SAMPLES_DIR
    jobs_dir: Path = JOBS_DIR

    # Tool paths
    colmap_path: str = find_colmap_executable() or ""


settings = Settings()
