import time
import pytest
from fastapi.testclient import TestClient
from backend.app.main import app

client = TestClient(app)


def test_health_check_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "opencv_version" in data
    assert "open3d_version" in data
    assert "colmap" in data


def test_list_samples_endpoint():
    response = client.get("/api/jobs/samples")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert any(s["name"] == "sample_drone.mp4" for s in data)


def test_create_and_process_job_mock_mode():
    """Test full job execution end-to-end in mock mode (used when COLMAP is absent)."""
    response = client.post(
        "/api/jobs",
        data={
            "sample_name": "sample_drone.mp4",
            "sample_fps": 2.0,
            "blur_threshold": 50.0,
            "mock_mode": True
        }
    )
    assert response.status_code == 200
    job = response.json()
    job_id = job["id"]
    assert job["mock_mode"] is True

    # Poll status until COMPLETED or FAILED
    max_wait = 15
    start = time.time()
    completed = False
    while time.time() - start < max_wait:
        status_resp = client.get(f"/api/jobs/{job_id}/status")
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        if status_data["status"] == "COMPLETED":
            completed = True
            break
        elif status_data["status"] == "FAILED":
            pytest.fail(f"Job failed with error: {status_data.get('error')}")
        time.sleep(0.5)

    assert completed, "Job did not complete within timeout"
    assert status_data["progress"] == 100
    assert status_data["point_count"] > 0

    # Test calibration endpoint on completed job
    calib_resp = client.post(
        f"/api/jobs/{job_id}/calibrate",
        json={
            "method": "two_point",
            "two_point": {
                "p1": [-2.0, 0.0, 1.0],
                "p2": [2.0, 0.0, 1.0],
                "known_distance_meters": 12.0
            }
        }
    )
    assert calib_resp.status_code == 200
    calib_data = calib_resp.json()
    assert calib_data["calibration"]["scale_factor"] == 3.0
