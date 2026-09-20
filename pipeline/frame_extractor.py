import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import cv2
import numpy as np

logger = logging.getLogger("pipeline.frame_extractor")


def compute_laplacian_variance(image_gray: np.ndarray) -> float:
    """
    Computes the variance of the Laplacian of a grayscale image.
    Higher values correspond to sharper images; lower values correspond to blurry images.
    """
    if image_gray is None or image_gray.size == 0:
        return 0.0
    laplacian = cv2.Laplacian(image_gray, cv2.CV_64F)
    variance = float(laplacian.var())
    return variance


def extract_frames(
    video_path: str,
    output_dir: str,
    sample_fps: float = 2.0,
    blur_threshold: float = 100.0,
    max_frames: Optional[int] = None
) -> Dict[str, Any]:
    """
    Extracts frames from an MP4 drone video at a target sampling rate (1-3 FPS recommended).
    Filters out blurry frames using the variance of the Laplacian.

    Args:
        video_path: Path to the input video file.
        output_dir: Directory where extracted sharp frames will be saved.
        sample_fps: Target number of frames to extract per second of video.
        blur_threshold: Minimum variance of Laplacian to consider a frame sharp.
        max_frames: Optional upper limit on extracted sharp frames.

    Returns:
        Dictionary containing extraction statistics and metadata list.
    """
    video_path_obj = Path(video_path)
    if not video_path_obj.exists():
        raise FileNotFoundError(f"Video file not found: {video_path}")

    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path_obj))
    if not cap.isOpened():
        raise ValueError(f"OpenCV could not open video file: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    native_fps = float(cap.get(cv2.CAP_PROP_FPS))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    duration_sec = total_frames / native_fps if native_fps > 0 else 0.0

    if sample_fps <= 0:
        sample_fps = 2.0

    # Interval in native video frames between sampled frames
    frame_interval = max(1, int(round(native_fps / sample_fps))) if native_fps > 0 else 1

    extracted_frames: List[Dict[str, Any]] = []
    rejected_blurry: List[Dict[str, Any]] = []

    frame_idx = 0
    saved_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            timestamp = frame_idx / native_fps if native_fps > 0 else 0.0
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            blur_score = compute_laplacian_variance(gray)

            is_sharp = blur_score >= blur_threshold
            frame_filename = f"frame_{saved_count:05d}.jpg"
            save_path = out_path / frame_filename

            frame_info = {
                "frame_index": frame_idx,
                "saved_index": saved_count if is_sharp else None,
                "timestamp_sec": round(timestamp, 3),
                "blur_score": round(blur_score, 2),
                "blur_threshold": blur_threshold,
                "is_sharp": is_sharp,
                "filename": frame_filename if is_sharp else None,
                "width": width,
                "height": height
            }

            if is_sharp:
                cv2.imwrite(str(save_path), frame, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
                extracted_frames.append(frame_info)
                saved_count += 1
                if max_frames and saved_count >= max_frames:
                    break
            else:
                rejected_blurry.append(frame_info)

        frame_idx += 1

    cap.release()

    metadata = {
        "video_path": str(video_path_obj.resolve()),
        "duration_sec": round(duration_sec, 2),
        "native_fps": round(native_fps, 2),
        "total_video_frames": total_frames,
        "sample_fps": sample_fps,
        "blur_threshold": blur_threshold,
        "width": width,
        "height": height,
        "extracted_sharp_count": len(extracted_frames),
        "rejected_blurry_count": len(rejected_blurry),
        "frames": extracted_frames
    }

    # Save metadata JSON into the output directory
    meta_file = out_path / "frames_meta.json"
    with open(meta_file, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    logger.info(
        f"Frame extraction complete: {len(extracted_frames)} sharp frames saved, "
        f"{len(rejected_blurry)} blurry frames rejected."
    )

    return metadata
