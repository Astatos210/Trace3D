import os
import shutil
import tempfile
import json
import numpy as np
import cv2
import pytest

from pipeline.frame_extractor import compute_laplacian_variance, extract_frames


def test_compute_laplacian_variance_sharp_vs_blurry():
    """Test that sharp checkerboard patterns produce a significantly higher variance of Laplacian than blurred ones."""
    # Create sharp high-contrast checkerboard image
    sharp_img = np.zeros((200, 200), dtype=np.uint8)
    sharp_img[::20, :] = 255
    sharp_img[:, ::20] = 255

    # Create heavily blurred version
    blurry_img = cv2.GaussianBlur(sharp_img, (31, 31), 10.0)

    sharp_score = compute_laplacian_variance(sharp_img)
    blurry_score = compute_laplacian_variance(blurry_img)

    assert sharp_score > blurry_score
    assert sharp_score > 500.0
    assert blurry_score < 100.0


def test_extract_frames_on_synthetic_video():
    """Test extracting frames from a synthetic MP4 video, verifying sampling rate and blur rejection."""
    temp_dir = tempfile.mkdtemp()
    try:
        video_path = os.path.join(temp_dir, "test_video.mp4")
        frames_out_dir = os.path.join(temp_dir, "extracted")

        # Synthesize a 3-second 10 FPS video (30 frames total)
        # Half the frames are sharp checkerboards, half are blurred
        fps = 10.0
        width, height = 320, 240
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(video_path, fourcc, fps, (width, height))

        for i in range(30):
            frame = np.zeros((height, width, 3), dtype=np.uint8)
            if i % 2 == 0:
                # Sharp frame: high-frequency grid
                for y in range(0, height, 16):
                    cv2.line(frame, (0, y), (width, y), (255, 255, 255), 2)
                for x in range(0, width, 16):
                    cv2.line(frame, (x, 0), (x, height), (255, 255, 255), 2)
                cv2.putText(frame, f"Frame {i}", (20, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
            else:
                # Blurry frame: low-contrast smooth color
                frame[:] = (120, 120, 120)
                frame = cv2.GaussianBlur(frame, (25, 25), 5.0)
            out.write(frame)
        out.release()

        # Run extraction at 2 FPS with blur_threshold=100.0
        # In a 3-second 10 FPS video with frame interval ~5:
        # Sampled frames will be at frame 0 (sharp), 5 (blurry), 10 (sharp), 15 (blurry), 20 (sharp), 25 (blurry)
        metadata = extract_frames(
            video_path=video_path,
            output_dir=frames_out_dir,
            sample_fps=2.0,
            blur_threshold=100.0
        )

        assert metadata["extracted_sharp_count"] > 0
        assert metadata["rejected_blurry_count"] > 0
        assert metadata["extracted_sharp_count"] + metadata["rejected_blurry_count"] == 6

        # Check metadata JSON file on disk
        meta_file = os.path.join(frames_out_dir, "frames_meta.json")
        assert os.path.exists(meta_file)
        with open(meta_file, "r") as f:
            data = json.load(f)
        assert data["extracted_sharp_count"] == metadata["extracted_sharp_count"]

        # Check saved files exist
        for frame_item in data["frames"]:
            frame_file = os.path.join(frames_out_dir, frame_item["filename"])
            assert os.path.exists(frame_file)

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
