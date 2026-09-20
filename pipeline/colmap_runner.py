import os
import sys
import shutil
import subprocess
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple
import struct
import numpy as np

logger = logging.getLogger("pipeline.colmap_runner")


class ColmapNotFoundError(RuntimeError):
    """Raised when COLMAP executable is not found on the system."""
    pass


class ColmapExecutionError(RuntimeError):
    """Raised when a COLMAP sub-command fails or produces insufficient reconstruction."""
    pass


def find_colmap_executable(custom_path: Optional[str] = None) -> Optional[str]:
    """
    Finds the COLMAP executable on the system PATH, from environment variable,
    or common installation locations on Windows and Linux.
    """
    if custom_path and os.path.isfile(custom_path):
        return str(Path(custom_path).resolve())

    env_path = os.environ.get("COLMAP_EXE_PATH")
    if env_path and os.path.isfile(env_path):
        return str(Path(env_path).resolve())

    which_colmap = shutil.which("colmap")
    if which_colmap:
        return str(Path(which_colmap).resolve())

    # Check repo-local portable install (tools/colmap) first.
    # Prefer the COLMAP.bat wrapper: Windows distributions ship DLLs that are
    # only resolvable when the batch wrapper has set up the environment.
    repo_root = Path(__file__).resolve().parent.parent
    local_candidates = [
        repo_root / "tools" / "colmap" / "COLMAP.bat",
        repo_root / "tools" / "colmap" / "bin" / "colmap.exe",
    ]
    for cand in local_candidates:
        if cand.is_file():
            return str(cand.resolve())

    # Check common Windows paths
    candidates = [
        r"C:\Program Files\COLMAP\COLMAP.bat",
        r"C:\Program Files\COLMAP\colmap.exe",
        r"C:\tools\COLMAP\colmap.exe",
        r"C:\tools\COLMAP\COLMAP.bat",
        os.path.expanduser(r"~\scoop\apps\colmap\current\colmap.exe"),
    ]
    for cand in candidates:
        if os.path.isfile(cand):
            return str(Path(cand).resolve())

    return None


def run_colmap_command(args: List[str], cwd: Optional[str] = None) -> str:
    """Runs a COLMAP command and captures stdout and stderr."""
    colmap_exe = args[0]
    logger.info(f"Executing COLMAP: {' '.join(args)}")
    process = subprocess.run(
        args,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    if process.returncode != 0:
        error_msg = f"COLMAP command failed with code {process.returncode}:\n{process.stderr}\n{process.stdout}"
        logger.error(error_msg)
        raise ColmapExecutionError(error_msg)
    return process.stdout


def parse_registered_images_from_model(sparse_dir: str) -> int:
    """
    Parses the number of registered images from a COLMAP sparse model directory (0/).
    Supports both images.bin and images.txt.
    """
    images_bin = Path(sparse_dir) / "images.bin"
    images_txt = Path(sparse_dir) / "images.txt"

    if images_bin.exists():
        with open(images_bin, "rb") as f:
            num_reg_images = struct.unpack("<Q", f.read(8))[0]
            return int(num_reg_images)

    if images_txt.exists():
        count = 0
        with open(images_txt, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                # In images.txt, every image has two lines: image pose, then points2D
                count += 1
        return count // 2

    return 0


def run_sparse_reconstruction(
    images_dir: str,
    output_dir: str,
    colmap_exe: Optional[str] = None,
    mock_mode: bool = False
) -> Dict[str, Any]:
    """
    Runs COLMAP sparse reconstruction pipeline:
    1. feature_extractor
    2. sequential_matcher / exhaustive_matcher
    3. mapper
    4. model_converter (to export points3D.ply)

    If mock_mode is True, generates clearly labeled synthetic reconstruction data
    strictly for frontend UI development when COLMAP is absent.
    """
    images_path = Path(images_dir).resolve()
    out_path = Path(output_dir).resolve()
    out_path.mkdir(parents=True, exist_ok=True)

    database_path = out_path / "database.db"
    sparse_out_dir = out_path / "sparse"
    sparse_out_dir.mkdir(parents=True, exist_ok=True)

    exe = find_colmap_executable(colmap_exe)

    # Explicit opt-in always wins: generate labeled synthetic geometry
    # even when a COLMAP binary is available.
    if mock_mode:
        return generate_mock_sparse_reconstruction(images_dir, output_dir)

    if not exe:
        raise ColmapNotFoundError(
            "COLMAP executable was not found on PATH or via COLMAP_EXE_PATH.\n"
            "Please install COLMAP (e.g., via winget install COLMAP.COLMAP, "
            "or download from https://github.com/colmap/colmap/releases), "
            "or set COLMAP_EXE_PATH in .env.\n"
            "To preview the frontend UI without COLMAP, enable Mock Mode."
        )

    # 1. Feature extraction
    run_colmap_command([
        exe, "feature_extractor",
        "--database_path", str(database_path),
        "--image_path", str(images_path),
        "--ImageReader.camera_model", "SIMPLE_RADIAL",
        "--ImageReader.single_camera", "1"
    ])

    # 2. Matching (Sequential matcher is ideal for drone video footage)
    run_colmap_command([
        exe, "sequential_matcher",
        "--database_path", str(database_path)
    ])

    # 3. Sparse Mapping
    run_colmap_command([
        exe, "mapper",
        "--database_path", str(database_path),
        "--image_path", str(images_path),
        "--output_path", str(sparse_out_dir)
    ])

    # In COLMAP, mapper creates sub-models (sparse/0, sparse/1, etc.) when it
    # cannot merge all views into one model. Use the largest one (most
    # registered images, tie-break on 3D points) instead of hard-coding 0.
    sub_model = _pick_largest_sub_model(sparse_out_dir)
    if sub_model is None:
        raise ColmapExecutionError(
            "COLMAP mapping failed: no reconstruction model was produced in sparse/. "
            "Frames may lack visual overlap, texture, or sufficient features."
        )

    registered_images = parse_registered_images_from_model(str(sub_model))
    if registered_images < 3:
        raise ColmapExecutionError(
            f"Insufficient registered images ({registered_images} < 3). Common causes: "
            "frames lack parallax or texture (slow/flat motion, synthetic or low-light "
            "footage), or the camera model did not fit. Try a longer clip with real "
            "3D scene depth and stronger camera movement, lower the sampling FPS, or "
            "use a higher-quality source video."
        )

    # Convert sparse model to PLY
    sparse_ply = out_path / "sparse_points.ply"
    try:
        run_colmap_command([
            exe, "model_converter",
            "--input_path", str(sub_model),
            "--output_path", str(sparse_ply),
            "--output_type", "PLY"
        ])
    except Exception as e:
        logger.warning(f"Could not convert model to PLY: {e}")

    return {
        "status": "success",
        "is_mock": False,
        "registered_images": registered_images,
        "database_path": str(database_path),
        "sparse_dir": str(sub_model),
        "sparse_ply": str(sparse_ply) if sparse_ply.exists() else None
    }


def run_dense_reconstruction(
    images_dir: str,
    sparse_dir: str,
    output_dir: str,
    colmap_exe: Optional[str] = None,
    mock_mode: bool = False
) -> Dict[str, Any]:
    """
    Runs COLMAP dense reconstruction pipeline:
    1. image_undistorter
    2. patch_match_stereo
    3. stereo_fusion
    """
    out_path = Path(output_dir).resolve()
    dense_dir = out_path / "dense"
    dense_dir.mkdir(parents=True, exist_ok=True)
    dense_ply = dense_dir / "fused.ply"

    exe = find_colmap_executable(colmap_exe)

    # Explicit opt-in always wins: generate labeled synthetic geometry
    # even when a COLMAP binary is available.
    if mock_mode:
        return generate_mock_dense_reconstruction(output_dir)

    if not exe:
        raise ColmapNotFoundError(
            "COLMAP executable is not available for dense reconstruction."
        )

    # 1. Undistort images
    run_colmap_command([
        exe, "image_undistorter",
        "--image_path", str(Path(images_dir).resolve()),
        "--input_path", str(Path(sparse_dir).resolve()),
        "--output_path", str(dense_dir),
        "--output_type", "COLMAP"
    ])

    # 2+3. PatchMatch stereo + fusion. These commands hard-require CUDA in
    # COLMAP's prebuilt binaries. On CUDA-less hosts, degrade gracefully:
    # export the sparse model as the dense-stage output so the rest of the
    # pipeline (Open3D filtering, meshing, confidence) still runs on real data.
    try:
        run_colmap_command([
            exe, "patch_match_stereo",
            "--workspace_path", str(dense_dir),
            "--workspace_format", "COLMAP",
            "--PatchMatchStereo.geom_consistency", "true"
        ])
        run_colmap_command([
            exe, "stereo_fusion",
            "--workspace_path", str(dense_dir),
            "--workspace_format", "COLMAP",
            "--input_type", "geometric",
            "--output_path", str(dense_ply)
        ])
    except ColmapExecutionError as e:
        if "CUDA" not in str(e):
            raise
        logger.warning(
            "COLMAP dense stereo requires CUDA, which is unavailable. "
            "Falling back to the sparse model for downstream processing."
        )
        fallback_ply = dense_dir / "sparse_fallback.ply"
        run_colmap_command([
            exe, "model_converter",
            "--input_path", str(dense_dir / "sparse"),
            "--output_path", str(fallback_ply),
            "--output_type", "PLY"
        ])
        if not fallback_ply.exists():
            raise ColmapExecutionError(
                "CUDA-less dense fallback failed: sparse model could not be exported."
            )
        return {
            "status": "success_sparse_fallback",
            "is_mock": False,
            "dense_dir": str(dense_dir),
            "dense_ply": str(fallback_ply),
            "notice": (
                "Dense MVS was skipped: COLMAP dense stereo requires an NVIDIA GPU "
                "(CUDA), which is unavailable. Output is built from the verified "
                "sparse reconstruction instead."
            )
        }

    if not dense_ply.exists():
        raise ColmapExecutionError(
            "COLMAP dense reconstruction completed, but fused.ply was not created."
        )

    return {
        "status": "success",
        "is_mock": False,
        "dense_dir": str(dense_dir),
        "dense_ply": str(dense_ply)
    }


def generate_mock_sparse_reconstruction(images_dir: str, output_dir: str) -> Dict[str, Any]:
    """
    Generates clearly marked mock sparse reconstruction for frontend UI development ONLY.
    Project rule compliance: Strictly tagged with is_mock = True.
    """
    out_path = Path(output_dir).resolve()
    sparse_dir = out_path / "sparse" / "0"
    sparse_dir.mkdir(parents=True, exist_ok=True)

    # List image files to determine count
    img_files = list(Path(images_dir).glob("*.jpg")) + list(Path(images_dir).glob("*.png"))
    registered_count = max(len(img_files), 5)

    # Write marker file
    marker_file = out_path / "MOCK_RECONSTRUCTION_NOTICE.txt"
    with open(marker_file, "w", encoding="utf-8") as f:
        f.write(
            "NOTICE: This sparse reconstruction was generated in MOCK MODE for frontend UI testing.\n"
            "COLMAP was not detected on the host system. This is synthetic test geometry.\n"
        )

    # Generate synthetic camera trajectory and point cloud
    sparse_ply = out_path / "sparse_points.ply"
    np.random.seed(42)
    # Generate points in a 10m x 10m bounding area
    num_pts = 1200
    pts = np.random.uniform(-5.0, 5.0, size=(num_pts, 3))
    pts[:, 2] = np.random.uniform(0.0, 3.0, size=num_pts)  # elevation
    colors = np.random.randint(100, 240, size=(num_pts, 3), dtype=np.uint8)

    write_ply_file(str(sparse_ply), pts, colors)

    return {
        "status": "success",
        "is_mock": True,
        "mock_notice": "DEMO MOCK DATA - COLMAP UNAVAILABLE",
        "registered_images": registered_count,
        "sparse_dir": str(sparse_dir),
        "sparse_ply": str(sparse_ply)
    }


def generate_mock_dense_reconstruction(output_dir: str) -> Dict[str, Any]:
    """
    Generates mock dense point cloud for frontend testing when COLMAP is absent.
    Project rule compliance: Strictly tagged with is_mock = True.
    """
    out_path = Path(output_dir).resolve()
    dense_dir = out_path / "dense"
    dense_dir.mkdir(parents=True, exist_ok=True)
    dense_ply = dense_dir / "fused.ply"

    # Generate synthetic roof/building geometry
    np.random.seed(1337)
    num_points = 15000
    x = np.random.uniform(-8.0, 8.0, num_points)
    y = np.random.uniform(-8.0, 8.0, num_points)
    # Roof ridge shape: z = 4.0 - 0.5 * abs(x)
    z = np.clip(4.0 - 0.4 * np.abs(x) + np.random.normal(0, 0.05, num_points), 0.0, 5.0)
    pts = np.stack([x, y, z], axis=1)

    # Color gradient (earthy drone scene colors)
    r = np.clip(180 - 10 * z + np.random.normal(0, 10, num_points), 40, 250).astype(np.uint8)
    g = np.clip(160 - 8 * z + np.random.normal(0, 10, num_points), 40, 250).astype(np.uint8)
    b = np.clip(130 - 15 * z + np.random.normal(0, 10, num_points), 40, 250).astype(np.uint8)
    colors = np.stack([r, g, b], axis=1)

    write_ply_file(str(dense_ply), pts, colors)

    return {
        "status": "success",
        "is_mock": True,
        "mock_notice": "DEMO MOCK DATA - COLMAP UNAVAILABLE",
        "dense_dir": str(dense_dir),
        "dense_ply": str(dense_ply)
    }


def _pick_largest_sub_model(sparse_out_dir: Path) -> Optional[Path]:
    """
    Returns the sparse sub-model (sparse/0, sparse/1, ...) with the most
    registered images, tie-broken on 3D point count. Returns None if empty.
    """
    best, best_key = None, (-1, -1)
    for sub in sorted(sparse_out_dir.glob("[0-9]*")):
        if not (sub / "images.bin").exists():
            continue
        stats = _read_model_stats(sub)
        key = (stats["images"], stats["points"])
        if key > best_key:
            best, best_key = sub, key
    return best


def _read_model_stats(model_dir: Path) -> Dict[str, int]:
    """Reads registered-image and 3D-point counts from a COLMAP binary model.

    Both images.bin and points3D.bin store their element count as a leading
    little-endian uint64, so only the headers are needed.
    """
    import struct
    stats = {"images": 0, "points": 0}
    images_bin = model_dir / "images.bin"
    if images_bin.exists():
        with open(images_bin, "rb") as f:
            stats["images"] = int(struct.unpack("<Q", f.read(8))[0])
    points_bin = model_dir / "points3D.bin"
    if points_bin.exists():
        with open(points_bin, "rb") as f:
            stats["points"] = int(struct.unpack("<Q", f.read(8))[0])
    return stats


def write_ply_file(file_path: str, points: np.ndarray, colors: np.ndarray) -> None:
    """Writes an ASCII PLY point cloud file."""
    with open(file_path, "w", encoding="utf-8") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(points)}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("property uchar red\n")
        f.write("property uchar green\n")
        f.write("property uchar blue\n")
        f.write("end_header\n")
        for p, c in zip(points, colors):
            f.write(f"{p[0]:.4f} {p[1]:.4f} {p[2]:.4f} {int(c[0])} {int(c[1])} {int(c[2])}\n")
