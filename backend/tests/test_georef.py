import numpy as np
import pytest

from pipeline.metric_calibrator import (
    geodetic_to_ecef,
    ecef_to_enu,
    gps_trajectory_to_enu,
    umeyama_similarity_transform,
    calibrate_scale_from_two_points
)


def test_wgs84_enu_conversion():
    """Verify that a small shift in latitude/longitude produces correct East and North displacement."""
    # Reference location (approx. San Francisco)
    lat0, lon0, alt0 = 37.7749, -122.4194, 10.0

    # Point at exactly the origin should produce (0, 0, 0)
    x0, y0, z0 = geodetic_to_ecef(lat0, lon0, alt0)
    e0, n0, u0 = ecef_to_enu(x0, y0, z0, lat0, lon0, alt0)
    assert abs(e0) < 1e-4
    assert abs(n0) < 1e-4
    assert abs(u0) < 1e-4

    # Shift altitude by +50 meters
    x_up, y_up, z_up = geodetic_to_ecef(lat0, lon0, alt0 + 50.0)
    e_up, n_up, u_up = ecef_to_enu(x_up, y_up, z_up, lat0, lon0, alt0)
    assert abs(e_up) < 1e-3
    assert abs(n_up) < 1e-3
    assert abs(u_up - 50.0) < 1e-2


def test_umeyama_similarity_transform():
    """Verify that Umeyama alignment recovers known scale, rotation, and translation with near-zero RMSE."""
    np.random.seed(42)
    # Generate 10 source points
    src = np.random.uniform(-10.0, 10.0, size=(10, 3))

    # Apply known scale s=2.5, translation t=[5.0, -3.0, 10.0], and 90 deg rotation around Z
    true_scale = 2.5
    theta = np.pi / 2.0
    true_rot = np.array([
        [np.cos(theta), -np.sin(theta), 0.0],
        [np.sin(theta),  np.cos(theta), 0.0],
        [0.0,            0.0,           1.0]
    ])
    true_trans = np.array([5.0, -3.0, 10.0])

    dst = true_scale * np.dot(src, true_rot.T) + true_trans

    rec_scale, rec_rot, rec_trans, rmse = umeyama_similarity_transform(src, dst)

    assert abs(rec_scale - true_scale) < 1e-5
    assert np.allclose(rec_rot, true_rot, atol=1e-5)
    assert np.allclose(rec_trans, true_trans, atol=1e-4)
    assert rmse < 1e-5


def test_calibrate_scale_from_two_points():
    """Verify 2-point scale calibration computation."""
    p1 = [0.0, 0.0, 0.0]
    p2 = [3.0, 4.0, 0.0] # Euclidean distance in model = 5.0
    known_meters = 15.0  # Real distance = 15.0 meters -> scale = 3.0

    res = calibrate_scale_from_two_points(p1, p2, known_meters)

    assert res["reconstructed_distance_units"] == 5.0
    assert res["known_distance_meters"] == 15.0
    assert res["scale_factor"] == 3.0
    assert "surveyed_baseline_calibrated" in res["accuracy_grade"]
