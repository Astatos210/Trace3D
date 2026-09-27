import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from backend.app.config import settings
from backend.app.api.health import router as health_router
from backend.app.api.jobs import router as jobs_router
from backend.app.api.calibration import router as calibration_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("backend.main")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Single-Pass Drone Video to Metrically Scaled 3D Model API"
)

# CORS configuration for development with Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def enforce_upload_request_limit(request, call_next):
    """Reject oversized video requests before FastAPI parses the multipart body."""
    if request.url.path == "/api/jobs" and request.method == "POST":
        length = request.headers.get("content-length")
        if length and int(length) > settings.max_upload_bytes + 4 * 1024 * 1024:
            return JSONResponse({"detail": "Request exceeds the video upload limit."}, status_code=413)
    return await call_next(request)

# Mount endpoints
app.include_router(health_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")
app.include_router(calibration_router, prefix="/api")

# Mount jobs directory as static files for downloading models, frames, and metrics
app.mount("/jobs", StaticFiles(directory=str(settings.jobs_dir)), name="jobs")


@app.get("/")
def root():
    return {
        "name": settings.app_name,
        "version": settings.version,
        "docs_url": "/docs",
        "health_check": "/api/health"
    }


# Serve the compiled React SPA (single-container deployments, e.g. Hugging Face Spaces).
# The frontend Dockerfile emits dist/ to ../frontend_dist relative to the backend WORKDIR.
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend_dist"
if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="spa")
    logger.info(f"Serving frontend SPA from {FRONTEND_DIST}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.host, port=settings.port, reload=settings.debug)
