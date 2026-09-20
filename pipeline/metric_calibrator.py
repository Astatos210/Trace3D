import json
import math
import logging
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
import numpy as np

logger = logging.getLogger("pipeline.metric_calibrator")

# WGS-84 Ellipsoid constants
WGS84_A = 6378137.0          # Semi-major axis in meters
WGS84_F = 1.0 / 298.257223563 # Flattening
WGS84_E2 = 2 * WGS84_F - WGS84_F ** 2 # First eccentricity squared


def geodetic_to_ecef(lat_deg: float, lon_deg: float, alt_m: float) -> Tuple[float, float, float]:
    """Converts Geodetic coordinates (WGS-84 lat, lon in degrees, alt in meters) to ECEF (meters)."""
    phi = math.radians(lat_deg)
    lam = math.radians(lon_deg)
    sin_phi = math.sin(phi)
    cos_phi = math.cos(phi)
    sin_lam = math.sin(lam)
    cos_lam = math.cos(lam)

    n = WGS84_A / math.sqrt(1.0 - WGS84_E2 * sin_phi ** 2)

    x = (n + alt_m) * cos_phi * cos_lam
    y = (n + alt_m) * cos_phi * sin_lam
    z = (n * (1.0 - WGS84_E2) + alt_m) * sin_phi
    return x, y, z


def ecef_to_enu(
    x: float, y: float, z: float,
    lat0_deg: float, lon0_deg: float, alt0_m: float
) -> Tuple[float, float, float]:
    """Converts ECEF coordinates (meters) to local ENU (East, North, Up) relative to reference origin."""
    x0, y0, z0 = geodetic_to_ecef(lat0_deg, lon0_deg, alt0_m)
    dx = x - x0
    dy = y - y0
    dz = z - z0

    phi0 = math.radians(lat0_deg)
    lam0 = math.radians(lon0_deg)
    sin_phi = math.sin(phi0)
    cos_phi = math.cos(phi0)
    sin_lam = math.sin(lam0)
    cos_lam = math.cos(lam0)

    east  = -sin_lam * dx + cos_lam * dy
    north = -sin_phi * cos_lam * dx - sin_phi * sin_lam * dy + cos_phi * dz
    up    =  cos_phi * cos_lam * dx + cos_phi * sin_lam * dy + sin_phi * dz
    return east, north, up


def gps_trajectory_to_enu(gps_points: List[Dict[str, float]]) -> Tuple[np.ndarray, Dict[str, float]]:
    """
    Converts a list of GPS points [{'lat': ..., 'lon': ..., 'alt': ...}] to an Nx3 local ENU numpy array.
    Origin is set to the first GPS point.
    """
    if not gps_points:
        return np.zeros((0, 3)), {}

    ref = gps_points[0]
    lat0, lon0, alt0 = ref["lat"], ref["lon"], ref.get("alt", 0.0)

    enu_coords = []
    for pt in gps_points:
        x, y, z = geodetic_to_ecef(pt["lat"], pt["lon"], pt.get("alt", 0.0))
        e, n, u = ecef_to_enu(x, y, z, lat0, lon0, alt0)
        enu_coords.append([e, n, u])

    origin = {"lat0": lat0, "lon0": lon0, "alt0": alt0}
    return np.array(enu_coords, dtype=np.float64), origin


def umeyama_similarity_transform(src: np.ndarray, dst: np.ndarray) -> Tuple[float, np.ndarray, np.ndarray, float]:
    """
    Computes optimal 7-DoF similarity transformation (scale s, rotation R 3x3, translation t 3x1)
    mapping src -> dst using the Umeyama algorithm.

    dst ≈ s * R * src + t

    Returns:
        scale (s): float
        rotation (R): 3x3 ndarray
        translation (t): 3-vector ndarray
        rmse: root-mean-square residual error
    """
    if len(src) != len(dst) or len(src) < 3:
        raise ValueError("At least 3 corresponding points are required for Umeyama alignment.")

    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    n, m = src.shape

    # 1. Centroids
    mean_src = np.mean(src, axis=0)
    mean_dst = np.mean(dst, axis=0)

    # 2. Centered coordinates
    src_c = src - mean_src
    dst_c = dst - mean_dst

    # 3. Variance of src
    var_src = np.sum(src_c ** 2) / n
    if var_src < 1e-12:
        raise ValueError("Degenerate source points (all points are identical).")

    # 4. Covariance matrix
    cov = np.dot(dst_c.T, src_c) / n

    # 5. SVD
    u, d, vt = np.linalg.svd(cov)
    v = vt.T

    # 6. Reflection check
    det = np.linalg.det(u) * np.linalg.det(v)
    s_mat = np.eye(m)
    if det < 0:
        s_mat[m - 1, m - 1] = -1.0

    # 7. Rotation
    r = np.dot(u, np.dot(s_mat, vt))

    # 8. Scale
    scale = float(np.trace(np.dot(np.diag(d), s_mat)) / var_src)

    # 9. Translation
    t = mean_dst - scale * np.dot(r, mean_src)

    # 10. Compute RMSE residual
    transformed_src = scale * np.dot(src, r.T) + t
    residual = dst - transformed_src
    rmse = float(np.sqrt(np.mean(np.sum(residual ** 2, axis=1))))

    return scale, r, t, rmse


def calibrate_scale_from_two_points(
    p1: List[float],
    p2: List[float],
    known_distance_meters: float
) -> Dict[str, Any]:
    """
    Computes scale factor from two selected 3D vertices and their known physical distance.

    Args:
        p1: [x, y, z] of first point in reconstruction coordinate frame.
        p2: [x, y, z] of second point in reconstruction coordinate frame.
        known_distance_meters: Physical real-world distance between p1 and p2 in meters.

    Returns:
        Calibration metadata dictionary.
    """
    p1_arr = np.array(p1, dtype=np.float64)
    p2_arr = np.array(p2, dtype=np.float64)

    reconstructed_dist = float(np.linalg.norm(p2_arr - p1_arr))
    if reconstructed_dist <= 1e-6:
        raise ValueError("Selected calibration points are too close together.")
    if known_distance_meters <= 0:
        raise ValueError("Known distance must be positive.")

    scale_factor = known_distance_meters / reconstructed_dist

    return {
        "method": "two_point_known_distance",
        "p1": [round(float(v), 4) for v in p1],
        "p2": [round(float(v), 4) for v in p2],
        "reconstructed_distance_units": round(reconstructed_dist, 4),
        "known_distance_meters": round(known_distance_meters, 4),
        "scale_factor": round(scale_factor, 6),
        "accuracy_grade": "surveyed_baseline_calibrated",
        "disclaimer": (
            "Metric scale derived from user-defined known distance baseline. "
            "Absolute positioning is uncalibrated unless GPS control points are also provided."
        )
    }


def calibrate_with_gps(
    camera_positions: List[List[float]],
    gps_coordinates: List[Dict[str, float]]
) -> Dict[str, Any]:
    """
    Aligns reconstructed camera trajectory to GPS coordinates using Umeyama similarity transform.

    Labels output as approximate GPS georeferencing per project rules.
    """
    if len(camera_positions) != len(gps_coordinates) or len(camera_positions) < 3:
        raise ValueError("At least 3 synchronized camera positions and GPS coordinates required.")

    enu_pts, origin = gps_trajectory_to_enu(gps_coordinates)
    cam_pts = np.array(camera_positions, dtype=np.float64)

    scale, rot, trans, rmse = umeyama_similarity_transform(cam_pts, enu_pts)

    return {
        "method": "gps_trajectory_alignment",
        "reference_origin": origin,
        "scale_factor": round(float(scale), 6),
        "rotation_matrix": [[round(float(val), 6) for val in row] for row in rot],
        "translation_vector": [round(float(v), 4) for v in trans],
        "georeferencing_rmse_meters": round(float(rmse), 4),
        "accuracy_grade": "approximate_gps",
        "disclaimer": (
            "Approximate GPS Georeferencing: Consumer drone GPS accuracy is typically ±2-5 meters. "
            "Never claim centimeter accuracy without RTK, PPK, or surveyed Ground Control Points (GCPs)."
        )
    }
