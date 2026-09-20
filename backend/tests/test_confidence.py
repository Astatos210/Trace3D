import os
import shutil
import tempfile
import numpy as np
import pytest

from pipeline.confidence_estimator import (
    confidence_to_rgb,
    align_relative_depth_to_metric,
    compute_point_cloud_confidence
)
from pipeline.colmap_runner import write_ply_file


def test_confidence_to_rgb_color_mapping():
    """Verify confidence color categorization: Green for high, Yellow for med, Red/Orange for low."""
    r_high, g_high, b_high = confidence_to_rgb(0.95)
    assert g_high > r_high and g_high > b_high  # Predominantly green

    r_med, g_med, b_med = confidence_to_rgb(0.60)
    assert r_med > 100 and g_med > 100          # Yellow/Amber

    r_low, g_low, b_low = confidence_to_rgb(0.20)
    assert r_low > g_low and r_low > b_low      # Red/Orange


def test_align_relative_depth_to_metric():
    """Verify least-squares scale and shift fitting between relative and metric depths."""
    rel_depths = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    true_alpha = 4.2
    true_beta = 1.5
    metric_depths = true_alpha * rel_depths + true_beta

    alpha, beta = align_relative_depth_to_metric(metric_depths, rel_depths)

    assert abs(alpha - true_alpha) < 1e-4
    assert abs(beta - true_beta) < 1e-4


def test_compute_point_cloud_confidence_processing():
    """Verify point cloud confidence calculation and PLY export."""
    temp_dir = tempfile.mkdtemp()
    try:
        input_ply = os.path.join(temp_dir, "input.ply")
        np.random.seed(42)
        # Create a cluster of 150 points
        pts = np.random.normal(0, 1.0, size=(150, 3))
        colors = np.ones((150, 3), dtype=np.uint8) * 128
        write_ply_file(input_ply, pts, colors)

        stats = compute_point_cloud_confidence(
            input_ply=input_ply,
            output_dir=temp_dir,
            simulate_monocular_fill=True
        )

        assert stats["total_points"] >= 150
        assert stats["high_confidence_count"] > 0
        assert os.path.exists(stats["confidence_file"])
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
