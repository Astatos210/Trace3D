import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import open3d as o3d
import numpy as np

logger = logging.getLogger("pipeline.confidence_estimator")


def confidence_to_rgb(confidence: float) -> Tuple[int, int, int]:
    """
    Maps confidence score in [0, 1] to RGB visualization color:
    - High confidence (0.8 - 1.0): Green (0, 220, 60)
    - Medium confidence (0.4 - 0.8): Yellow/Amber (240, 200, 20)
    - Sparse local neighborhood (0.0 - 0.4): Red/Orange (230, 60, 40)
    """
    c = np.clip(confidence, 0.0, 1.0)
    if c >= 0.8:
        # Green gradient
        factor = (c - 0.8) / 0.2
        r = int(50 * (1 - factor))
        g = int(200 + 40 * factor)
        b = int(50 * (1 - factor))
    elif c >= 0.4:
        # Yellow to Green gradient
        factor = (c - 0.4) / 0.4
        r = int(240 - 150 * factor)
        g = int(180 + 40 * factor)
        b = int(20)
    else:
        # Red to Yellow gradient
        factor = c / 0.4
        r = int(230)
        g = int(50 + 130 * factor)
        b = int(30)
    return r, g, b


def align_relative_depth_to_metric(
    sparse_mvs_depths: np.ndarray,
    monocular_relative_depths: np.ndarray
) -> Tuple[float, float]:
    """
    Fits affine scale (alpha) and shift (beta) between relative monocular depth
    and sparse multi-view metric depths via least squares:
    d_metric ≈ alpha * d_rel + beta
    """
    if len(sparse_mvs_depths) < 2 or len(monocular_relative_depths) < 2:
        return 1.0, 0.0

    A = np.vstack([monocular_relative_depths, np.ones_like(monocular_relative_depths)]).T
    try:
        alpha, beta = np.linalg.lstsq(A, sparse_mvs_depths, rcond=None)[0]
        # Keep scale strictly positive
        if alpha <= 0:
            alpha = 1.0
            beta = float(np.mean(sparse_mvs_depths) - np.mean(monocular_relative_depths))
        return float(alpha), float(beta)
    except Exception as e:
        logger.warning(f"Depth alignment failed: {e}. Using identity scale/shift.")
        return 1.0, 0.0


def compute_point_cloud_confidence(
    input_ply: str,
    output_dir: str,
    simulate_monocular_fill: bool = False
) -> Dict[str, Any]:
    """
    Evaluates geometry confidence for each 3D point and exports a confidence-colored point cloud.

    Scores local point density only. It does not perform monocular inference or prove multi-view
    validation because camera visibility and stereo residuals are not available here.

    Args:
        input_ply: Path to input point cloud PLY.
        output_dir: Destination directory for confidence PLY and metadata.
        simulate_monocular_fill: Retained for compatibility; synthetic geometry is never added.

    Returns:
        Confidence statistics and output file paths.
    """
    in_path = Path(input_ply).resolve()
    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    pcd = o3d.io.read_point_cloud(str(in_path))
    points = np.asarray(pcd.points)

    if len(points) == 0:
        raise ValueError(f"No points in {input_ply} to evaluate confidence.")

    # Compute local neighborhood density as a support heuristic, not MVS reliability.
    pcd_tree = o3d.geometry.KDTreeFlann(pcd)
    num_pts = len(points)

    # Estimate average nearest-neighbor distance
    sample_indices = np.linspace(0, num_pts - 1, min(num_pts, 500), dtype=int)
    nn_distances = []
    for idx in sample_indices:
        [k, idxs, dists] = pcd_tree.search_knn_vector_3d(points[idx], 6)
        if len(dists) > 1:
            nn_distances.append(np.mean(np.sqrt(dists[1:])))
    avg_dist = float(np.median(nn_distances)) if nn_distances else 0.1
    search_radius = max(avg_dist * 2.5, 0.05)

    # Assign scores from neighborhood density only.
    confidences = []
    for i in range(num_pts):
        [k, idxs, dists] = pcd_tree.search_radius_vector_3d(points[i], search_radius)
        raw_score = min(k, 30) / 30.0
        confidences.append(float(raw_score))

    confidences = np.array(confidences, dtype=np.float32)

    all_points = points
    all_confidences = confidences

    # Assign RGB colors based on confidence
    colors = np.zeros((len(all_points), 3), dtype=np.uint8)
    for i, c in enumerate(all_confidences):
        colors[i] = confidence_to_rgb(float(c))

    # Export confidence PLY file
    out_ply = out_dir / "confidence_pcd.ply"
    with open(out_ply, "w", encoding="utf-8") as f:
        f.write("ply\n")
        f.write("format ascii 1.0\n")
        f.write(f"element vertex {len(all_points)}\n")
        f.write("property float x\n")
        f.write("property float y\n")
        f.write("property float z\n")
        f.write("property uchar red\n")
        f.write("property uchar green\n")
        f.write("property uchar blue\n")
        f.write("property float confidence\n")
        f.write("end_header\n")
        for p, c, conf in zip(all_points, colors, all_confidences):
            f.write(f"{p[0]:.4f} {p[1]:.4f} {p[2]:.4f} {c[0]} {c[1]} {c[2]} {conf:.3f}\n")

    high_conf_count = int(np.sum(all_confidences >= 0.8))
    med_conf_count = int(np.sum((all_confidences >= 0.4) & (all_confidences < 0.8)))
    low_conf_count = int(np.sum(all_confidences < 0.4))

    stats = {
        "total_points": len(all_points),
        "high_confidence_count": high_conf_count,
        "medium_confidence_count": med_conf_count,
        "low_confidence_count": low_conf_count,
        "high_confidence_pct": round(high_conf_count / len(all_points) * 100, 2),
        "medium_confidence_pct": round(med_conf_count / len(all_points) * 100, 2),
        "low_confidence_pct": round(low_conf_count / len(all_points) * 100, 2),
        "confidence_method": "local_neighborhood_density_heuristic",
        "confidence_file": str(out_ply),
        "legend": {
            "green": "Dense local neighborhood (≥ 0.8); heuristic only",
            "yellow": "Moderate local neighborhood (0.4 - 0.8)",
            "orange_red": "Sparse local neighborhood (< 0.4); heuristic only"
        }
    }

    # Save to json
    conf_json = out_dir / "confidence_metrics.json"
    with open(conf_json, "w", encoding="utf-8") as f:
        json.dump(stats, f, indent=2)

    return stats
