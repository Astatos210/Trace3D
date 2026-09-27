import os
import json
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple
import open3d as o3d
import numpy as np

logger = logging.getLogger("pipeline.open3d_processor")


def transfer_colors_to_mesh(mesh: o3d.geometry.TriangleMesh, pcd: o3d.geometry.PointCloud) -> o3d.geometry.TriangleMesh:
    """Transfers RGB vertex colors from point cloud to mesh vertices via KDTree nearest-neighbor."""
    if not pcd.has_colors() or len(mesh.vertices) == 0:
        return mesh

    pcd_tree = o3d.geometry.KDTreeFlann(pcd)
    mesh_vertices = np.asarray(mesh.vertices)
    pcd_colors = np.asarray(pcd.colors)

    vertex_colors = np.zeros_like(mesh_vertices)
    for i, v in enumerate(mesh_vertices):
        [_, idxs, _] = pcd_tree.search_knn_vector_3d(v, 1)
        if len(idxs) > 0:
            vertex_colors[i] = pcd_colors[idxs[0]]

    mesh.vertex_colors = o3d.utility.Vector3dVector(vertex_colors)
    return mesh


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
    5. Triangular surface mesh reconstruction (Poisson surface reconstruction)
    6. Transfers RGB colors to mesh vertices
    7. Exports filtered point cloud and triangular mesh (PLY and OBJ)
    8. Computes and returns metrics.
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
    mesh_vertex_count = 0
    mesh_ply_path = out_dir / "mesh.ply"
    mesh_obj_path = out_dir / "mesh.obj"
    mesh_glb_path = out_dir / "mesh.glb"

    # 5. Triangular Mesh Generation
    if generate_mesh and filtered_point_count >= 10:
        logger.info("Reconstructing triangular surface mesh using Poisson surface reconstruction...")
        try:
            # Poisson reconstruction with adaptive depth
            depth = 8 if filtered_point_count < 20000 else 9
            mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
                pcd_down, depth=depth, width=0, scale=1.1, linear_fit=False
            )

            # Filter low density vertices BEFORE cropping (to ensure matching array dimensions)
            densities_arr = np.asarray(densities)
            if len(densities_arr) > 0:
                density_threshold = np.quantile(densities_arr, 0.05)
                vertices_to_remove = densities_arr < density_threshold
                mesh.remove_vertices_by_mask(vertices_to_remove)

            # Crop mesh to bounding box with small margin
            expanded_bbox = bbox.scale(1.15, bbox.get_center())
            mesh = mesh.crop(expanded_bbox)

            # Transfer color textures from point cloud
            mesh = transfer_colors_to_mesh(mesh, pcd_down)
            mesh.compute_vertex_normals()

            mesh_triangle_count = len(mesh.triangles)
            mesh_vertex_count = len(mesh.vertices)

            # Export mesh as PLY (with triangles and colors)
            o3d.io.write_triangle_mesh(str(mesh_ply_path), mesh, write_ascii=True)

            # Export mesh as standard OBJ
            try:
                o3d.io.write_triangle_mesh(str(mesh_obj_path), mesh, write_ascii=True)
            except Exception as e:
                logger.warning(f"Could not export OBJ: {e}")

            # Export mesh as GLB if supported
            try:
                o3d.io.write_triangle_mesh(str(mesh_glb_path), mesh)
            except Exception as e:
                logger.warning(f"Could not export GLB directly from Open3D: {e}")

            logger.info(f"Generated triangular mesh: {mesh_triangle_count} triangles, {mesh_vertex_count} vertices.")

        except Exception as e:
            logger.error(f"Poisson mesh generation failed: {e}", exc_info=True)

    metrics = {
        "raw_point_count": raw_point_count,
        "clean_point_count": clean_point_count,
        "filtered_point_count": filtered_point_count,
        "outliers_removed": raw_point_count - clean_point_count,
        "voxel_size": voxel_size,
        "mesh_triangle_count": mesh_triangle_count,
        "mesh_vertex_count": mesh_vertex_count,
        "bounding_box": {
            "min": [round(v, 3) for v in min_bound],
            "max": [round(v, 3) for v in max_bound],
            "extent": [round(v, 3) for v in extent]
        },
        "files": {
            "filtered_point_cloud": str(filtered_ply_path),
            "mesh_ply": str(mesh_ply_path) if mesh_ply_path.exists() and mesh_triangle_count > 0 else None,
            "mesh_obj": str(mesh_obj_path) if mesh_obj_path.exists() and mesh_triangle_count > 0 else None,
            "mesh_glb": str(mesh_glb_path) if mesh_glb_path.exists() and mesh_triangle_count > 0 else None
        }
    }

    # Save metrics.json in output directory
    metrics_file = out_dir / "metrics.json"
    with open(metrics_file, "w", encoding="utf-8") as f:
        json.dump(metrics, f, indent=2)

    return metrics


def _transform_ascii_ply(source: Path, destination: Path, matrix: np.ndarray, translation: np.ndarray):
    lines = source.read_text(encoding="utf-8").splitlines()
    try:
        end_header = lines.index("end_header")
    except ValueError as exc:
        raise ValueError(f"Invalid ASCII PLY header: {source}") from exc
    if not any(line == "format ascii 1.0" for line in lines[:end_header]):
        raise ValueError(f"Only ASCII PLY files can be calibrated: {source}")
    vertex_count = 0
    properties = []
    in_vertices = False
    for line in lines[:end_header]:
        if line.startswith("element "):
            fields = line.split()
            in_vertices = len(fields) == 3 and fields[1] == "vertex"
            if in_vertices:
                vertex_count = int(fields[2])
                properties = []
        elif in_vertices and line.startswith("property "):
            properties.append(line.split()[-1])
    xyz_indices = [properties.index(axis) for axis in ("x", "y", "z")]
    normal_indices = ([properties.index(axis) for axis in ("nx", "ny", "nz")]
                      if all(axis in properties for axis in ("nx", "ny", "nz")) else None)
    first_vertex = end_header + 1
    for index in range(first_vertex, first_vertex + vertex_count):
        fields = lines[index].split()
        point = np.array([float(fields[i]) for i in xyz_indices])
        point = matrix @ point + translation
        for col, value in zip(xyz_indices, point):
            fields[col] = f"{value:.9g}"
        if normal_indices:
            normal = matrix @ np.array([float(fields[i]) for i in normal_indices])
            length = float(np.linalg.norm(normal))
            if length > 1e-12:
                normal /= length
            for col, value in zip(normal_indices, normal):
                fields[col] = f"{value:.9g}"
        lines[index] = " ".join(fields)
    destination.write_text("\n".join(lines) + "\n", encoding="utf-8")


def apply_metric_scale_to_outputs(
    output_dir: str,
    scale_factor: float,
    rotation: Optional[List[List[float]]] = None,
    translation: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    Scales the point cloud and triangular mesh by scale_factor so they are physically 'up to scale' in meters.
    Generates scaled_point_cloud.ply and scaled_mesh.ply / scaled_mesh.obj.
    """
    out_dir = Path(output_dir).resolve()
    if not np.isfinite(scale_factor) or scale_factor <= 0:
        raise ValueError("Scale factor must be a finite positive number.")

    scaled_files = {}
    rot = np.asarray(rotation if rotation is not None else np.eye(3), dtype=np.float64)
    trans = np.asarray(translation if translation is not None else [0.0, 0.0, 0.0], dtype=np.float64)
    if rot.shape != (3, 3) or trans.shape != (3,) or not np.isfinite(rot).all() or not np.isfinite(trans).all():
        raise ValueError("Invalid similarity transform.")
    matrix = scale_factor * rot

    for source_name, target_name, key in (
        ("point_cloud.ply", "scaled_point_cloud.ply", "scaled_point_cloud"),
        ("mesh.ply", "scaled_mesh.ply", "scaled_mesh_ply"),
        ("confidence_pcd.ply", "scaled_confidence_pcd.ply", "scaled_confidence_ply"),
    ):
        source = out_dir / source_name
        if source.is_file():
            target = out_dir / target_name
            _transform_ascii_ply(source, target, matrix, trans)
            scaled_files[key] = str(target)

    transformed_cloud = out_dir / "scaled_point_cloud.ply"
    if transformed_cloud.is_file():
        cloud = o3d.io.read_point_cloud(str(transformed_cloud))
        if len(cloud.points):
            bbox = cloud.get_axis_aligned_bounding_box()
            scaled_files["bounding_box"] = {
                "min": [round(float(v), 3) for v in bbox.get_min_bound()],
                "max": [round(float(v), 3) for v in bbox.get_max_bound()],
                "extent": [round(float(v), 3) for v in bbox.get_extent()],
            }

    obj_path = out_dir / "mesh.obj"
    if obj_path.is_file():
        transformed_obj = out_dir / "scaled_mesh.obj"
        with obj_path.open("r", encoding="utf-8") as src, transformed_obj.open("w", encoding="utf-8") as dst:
            for line in src:
                fields = line.split()
                if fields and fields[0] == "v" and len(fields) >= 4:
                    point = matrix @ np.asarray([float(v) for v in fields[1:4]]) + trans
                    line = "v " + " ".join(f"{v:.9g}" for v in point) + "\n"
                elif fields and fields[0] == "vn" and len(fields) >= 4:
                    normal = rot @ np.asarray([float(v) for v in fields[1:4]])
                    length = float(np.linalg.norm(normal))
                    if length > 1e-12:
                        normal /= length
                    line = "vn " + " ".join(f"{v:.9g}" for v in normal) + "\n"
                dst.write(line)
        scaled_files["scaled_mesh_obj"] = str(transformed_obj)

    glb_path = out_dir / "mesh.glb"
    if glb_path.is_file():
        try:
            mesh = o3d.io.read_triangle_mesh(str(glb_path))
            if len(mesh.vertices):
                transform = np.eye(4)
                transform[:3, :3] = matrix
                transform[:3, 3] = trans
                mesh.transform(transform)
                transformed_glb = out_dir / "scaled_mesh.glb"
                o3d.io.write_triangle_mesh(str(transformed_glb), mesh)
                scaled_files["scaled_mesh_glb"] = str(transformed_glb)
        except Exception as exc:
            logger.warning("Could not generate calibrated GLB: %s", exc)

    return scaled_files
