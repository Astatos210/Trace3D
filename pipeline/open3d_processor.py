import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
import open3d as o3d
import numpy as np

logger = logging.getLogger("pipeline.open3d_processor")


def process_point_cloud(
    input_ply: str,
    output_dir: str,
    voxel_size: float = 0.05,
    outlier_nb_neighbors: int = 20,
    outlier_std_ratio: float = 2.0,
    generate_mesh: bool = True
) -> Dict[str, Any]:
    """
    Processes a reconstructed point cloud with Open3D:
    1. Reads input PLY point cloud
    2. Statistical outlier removal
    3. Voxel downsampling
    4. Normal estimation
    5. Surface mesh reconstruction (Poisson surface reconstruction or Ball-Pivoting)
    6. Export filtered point cloud and mesh
    7. Computes and returns metrics.

    Args:
        input_ply: Path to dense fused.ply or sparse PLY.
        output_dir: Directory where processed point cloud and mesh are saved.
        voxel_size: Leaf size for voxel grid downsampling in model units.
        outlier_nb_neighbors: Number of neighbors to analyze for statistical outlier removal.
        outlier_std_ratio: Standard deviation ratio threshold for outliers.
        generate_mesh: Whether to reconstruct a triangle surface mesh.

    Returns:
        Dictionary of point cloud and mesh metrics.
    """
    in_path = Path(input_ply).resolve()
    if not in_path.exists():
        raise FileNotFoundError(f"Point cloud file not found: {input_ply}")

    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load point cloud
    logger.info(f"Loading point cloud from: {in_path}")
    pcd = o3d.io.read_point_cloud(str(in_path))
    raw_point_count = len(pcd.points)

    if raw_point_count == 0:
        raise ValueError(f"Input point cloud in {input_ply} contains 0 points. Reconstruction failed.")

    # 2. Statistical Outlier Removal
    logger.info(f"Applying statistical outlier removal (neighbors={outlier_nb_neighbors}, std_ratio={outlier_std_ratio})...")
    cl, ind = pcd.remove_statistical_outlier(
        nb_neighbors=outlier_nb_neighbors,
        std_ratio=outlier_std_ratio
    )
    pcd_clean = pcd.select_by_index(ind)
    clean_point_count = len(pcd_clean.points)

    # 3. Voxel Downsampling
    if voxel_size > 0.0:
        logger.info(f"Downsampling point cloud with voxel size {voxel_size}...")
        pcd_down = pcd_clean.voxel_down_sample(voxel_size=voxel_size)
    else:
        pcd_down = pcd_clean
    filtered_point_count = len(pcd_down.points)

    # 4. Normal Estimation
    logger.info("Estimating normals...")
    search_param = o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 4.0 if voxel_size > 0 else 0.2, max_nn=30)
    pcd_down.estimate_normals(search_param=search_param)
    pcd_down.orient_normals_consistent_tangent_plane(k=15)

    # Export filtered point cloud
    filtered_ply_path = out_dir / "point_cloud.ply"
    o3d.io.write_point_cloud(str(filtered_ply_path), pcd_down, write_ascii=True)

    # Compute bounding box
    bbox = pcd_down.get_axis_aligned_bounding_box()
    min_bound = bbox.get_min_bound().tolist()
    max_bound = bbox.get_max_bound().tolist()
    extent = (bbox.get_max_bound() - bbox.get_min_bound()).tolist()

    mesh_triangle_count = 0
    mesh_ply_path = out_dir / "mesh.ply"
    mesh_glb_path = out_dir / "mesh.glb"

    # 5. Mesh Generation
    if generate_mesh and filtered_point_count >= 10:
        logger.info("Reconstructing surface mesh using Poisson surface reconstruction...")
        try:
            # Poisson reconstruction
            mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
                pcd_down, depth=8, width=0, scale=1.1, linear_fit=False
            )
            # Crop mesh to bounding box of point cloud
            mesh = mesh.crop(bbox)
            # Remove low density vertices
            densities_arr = np.asarray(densities)
            density_threshold = np.quantile(densities_arr, 0.05)
            vertices_to_remove = densities_arr < density_threshold
            mesh.remove_vertices_by_mask(vertices_to_remove)

            mesh.compute_vertex_normals()
            mesh_triangle_count = len(mesh.triangles)

            # Export mesh as PLY
            o3d.io.write_triangle_mesh(str(mesh_ply_path), mesh, write_ascii=True)

            # Export mesh as GLB / OBJ if supported
            try:
                o3d.io.write_triangle_mesh(str(mesh_glb_path), mesh)
            except Exception as e:
                logger.warning(f"Could not export GLB directly from Open3D (saving PLY): {e}")

        except Exception as e:
            logger.warning(f"Poisson mesh generation encountered an issue: {e}")

    metrics = {
        "raw_point_count": raw_point_count,
        "clean_point_count": clean_point_count,
        "filtered_point_count": filtered_point_count,
        "outliers_removed": raw_point_count - clean_point_count,
        "voxel_size": voxel_size,
        "mesh_triangle_count": mesh_triangle_count,
        "bounding_box": {
            "min": [round(v, 3) for v in min_bound],
            "max": [round(v, 3) for v in max_bound],
            "extent": [round(v, 3) for v in extent]
        },
        "files": {
            "filtered_point_cloud": str(filtered_ply_path),
            "mesh_ply": str(mesh_ply_path) if mesh_ply_path.exists() else None,
            "mesh_glb": str(mesh_glb_path) if mesh_glb_path.exists() else None
        }
    }

    # Save metrics.json in output directory
    metrics_file = out_dir / "metrics.json"
    with open(metrics_file, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    logger.info(
        f"Open3D processing finished: {filtered_point_count} points, "
        f"{mesh_triangle_count} triangles saved."
    )

    return metrics
