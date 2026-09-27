import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Eye, RotateCcw, Target, Shield, Palette, Box, Grid, Sparkles, Layers } from 'lucide-react';
import { assetUrl } from '../services/api';

interface Viewer3DProps {
  plyUrl: string | null;
  confidencePlyUrl: string | null;
  meshPlyUrl?: string | null;
  meshObjUrl?: string | null;
  onPointsSelected: (p1: [number, number, number], p2: [number, number, number]) => void;
  scaleFactor: number;
}

interface ParsedGeometry {
  positions: Float32Array;
  rgbColors: Float32Array;
  confColors: Float32Array;
  confidences: Float32Array;
  indices: Uint32Array | null;
  triangleCount: number;
  vertexCount: number;
  center: THREE.Vector3;
  extent: number;
}

export const Viewer3D: React.FC<Viewer3DProps> = ({
  plyUrl,
  confidencePlyUrl,
  meshPlyUrl,
  meshObjUrl,
  onPointsSelected,
  scaleFactor
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [viewMode, setViewMode] = useState<'mesh_surface' | 'mesh_wireframe' | 'point_cloud' | 'hybrid'>('mesh_surface');
  const [shadingStyle, setShadingStyle] = useState<'textured' | 'confidence' | 'clay'>('textured');
  const [pointSize, setPointSize] = useState<number>(0.08);
  const [pickingMode, setPickingMode] = useState<boolean>(true);
  const [selectedPoints, setSelectedPoints] = useState<THREE.Vector3[]>([]);
  const [parsedData, setParsedData] = useState<ParsedGeometry | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [applyMetricScale, setApplyMetricScale] = useState<boolean>(true);
  const [stats, setStats] = useState<{
    vertexCount: number;
    triangleCount: number;
    distance: number | null;
  }>({ vertexCount: 0, triangleCount: 0, distance: null });
  const calibratedSource = [meshPlyUrl, confidencePlyUrl, plyUrl]
    .some((url) => Boolean(url?.split('/').pop()?.startsWith('scaled_')));
  const displayScale = applyMetricScale && scaleFactor > 0
    ? (calibratedSource ? 1 : scaleFactor)
    : (calibratedSource && scaleFactor > 0 ? 1 / scaleFactor : 1);

  // Scene references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const meshObjRef = useRef<THREE.Mesh | null>(null);
  const pointsObjRef = useRef<THREE.Points | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  // Parse ASCII PLY with support for both point clouds and triangle mesh faces
  const parsePlyText = (text: string): ParsedGeometry => {
    const lines = text.split('\n');
    let headerEnded = false;
    let vertexCount = 0;
    let faceCount = 0;
    let currentElement = '';
    let vertexProperties: string[] = [];
    const posList: number[] = [];
    const rgbList: number[] = [];
    const confColorList: number[] = [];
    const confList: number[] = [];
    const indexList: number[] = [];

    let vertexLinesRead = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (!headerEnded) {
        if (line.startsWith('element ')) {
          const [, element, count] = line.split(/\s+/);
          currentElement = element;
          if (element === 'vertex') vertexCount = parseInt(count, 10);
          if (element === 'face') faceCount = parseInt(count, 10);
        } else if (line.startsWith('property ') && currentElement === 'vertex') {
          vertexProperties.push(line.split(/\s+/).pop() || '');
        } else if (line === 'end_header') {
          headerEnded = true;
        }
        continue;
      }

      // Read vertices
      if (vertexLinesRead < vertexCount) {
        const parts = line.split(/\s+/);
        if (parts.length >= 3) {
          const x = parseFloat(parts[vertexProperties.indexOf('x')]);
          const y = parseFloat(parts[vertexProperties.indexOf('y')]);
          const z = parseFloat(parts[vertexProperties.indexOf('z')]);
          if (![x, y, z].every(Number.isFinite)) {
            throw new Error(`Invalid PLY vertex at row ${vertexLinesRead + 1}`);
          }
          posList.push(x, y, z);

          // Resolve color channels by PLY property names; Open3D writes normals before RGB.
          let r = 0.8, g = 0.8, b = 0.8;
          const colorIndices = ['red', 'green', 'blue'].map((name) => vertexProperties.indexOf(name));
          if (colorIndices.every((index) => index >= 0)) {
            const channels = colorIndices.map((index) => parseFloat(parts[index]));
            const normalize = (value: number) => Math.min(1, Math.max(0, value > 1 ? value / 255 : value));
            [r, g, b] = channels.map(normalize);
          }
          rgbList.push(r, g, b);

          const confidenceIndex = vertexProperties.indexOf('confidence');
          const conf = confidenceIndex >= 0 ? parseFloat(parts[confidenceIndex]) : 0.5;
          confList.push(conf);

          // Confidence Heatmap Color
          if (conf >= 0.8) {
            confColorList.push(0.02, 0.85, 0.2); // Dense neighborhood heuristic
          } else if (conf >= 0.4) {
            confColorList.push(1.0, 0.8, 0.1);  // Moderate neighborhood density
          } else {
            confColorList.push(0.95, 0.2, 0.15); // Sparse neighborhood density
          }

          vertexLinesRead++;
        }
        continue;
      }

      // Read faces (triangular mesh faces)
      const parts = line.split(/\s+/);
      const faceVertices = parseInt(parts[0], 10);
      if (faceVertices === 3 && parts.length >= 4) {
        const face = parts.slice(1, 4).map(Number);
        if (face.every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)) indexList.push(...face);
      } else if (faceVertices === 4 && parts.length >= 5) {
        // Quad face split into two triangles
        const i0 = parseInt(parts[1], 10);
        const i1 = parseInt(parts[2], 10);
        const i2 = parseInt(parts[3], 10);
        const i3 = parseInt(parts[4], 10);
        if ([i0, i1, i2, i3].every((index) => Number.isInteger(index) && index >= 0 && index < vertexCount)) {
          indexList.push(i0, i1, i2, i0, i2, i3);
        }
      }
    }

    const positions = new Float32Array(posList);
    const rgbColors = new Float32Array(rgbList);
    const confColors = new Float32Array(confColorList);
    const confidences = new Float32Array(confList);
    const indices = indexList.length > 0 ? new Uint32Array(indexList) : null;
    const triangleCount = indexList.length / 3;

    // Compute bounding box and center
    const center = new THREE.Vector3();
    let extent = 10;
    if (positions.length > 0) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        minX = Math.min(minX, positions[i]);
        maxX = Math.max(maxX, positions[i]);
        minY = Math.min(minY, positions[i + 1]);
        maxY = Math.max(maxY, positions[i + 1]);
        minZ = Math.min(minZ, positions[i + 2]);
        maxZ = Math.max(maxZ, positions[i + 2]);
      }
      center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      const dx = maxX - minX;
      const dy = maxY - minY;
      const dz = maxZ - minZ;
      extent = Math.max(dx, dy, dz, 1);
    }

    return {
      positions,
      rgbColors,
      confColors,
      confidences,
      indices,
      triangleCount,
      vertexCount: positions.length / 3,
      center,
      extent
    };
  };

  // Fetch and parse PLY (mesh or point cloud)
  useEffect(() => {
    // Prefer triangular mesh PLY, then confidence point cloud, then raw point cloud
    const targetUrl = assetUrl(shadingStyle === 'confidence'
      ? confidencePlyUrl || meshPlyUrl || plyUrl
      : meshPlyUrl || confidencePlyUrl || plyUrl);
    if (!targetUrl) return;

    setLoading(true);
    fetch(targetUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        return res.text();
      })
      .then((text) => {
        const parsed = parsePlyText(text);
        setParsedData(parsed);
        setStats({
          vertexCount: parsed.vertexCount,
          triangleCount: parsed.triangleCount,
          distance: null
        });

        // Automatically default to mesh_surface if triangle faces are present
        if (parsed.triangleCount > 0) {
          setViewMode('mesh_surface');
        } else {
          setViewMode('point_cloud');
        }

        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load 3D model:', err);
        setLoading(false);
      });
  }, [meshPlyUrl, confidencePlyUrl, plyUrl, shadingStyle]);

  // Three.js scene setup and rendering
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = 560;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    sceneRef.current = scene;

    // Ambient and directional lighting for realistic 3D triangular surface shading
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.85);
    dirLight1.position.set(10, 20, 15);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x6699bb, 0.45);
    dirLight2.position.set(-10, -10, -10);
    scene.add(dirLight2);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(12, 12, 18);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    // Keep React-owned loading/HUD overlays intact; replaceChildren desynchronizes
    // React's child list and causes insertBefore errors on the first job update.
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Group for the 3D model (mesh and points)
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    // Marker group for calibration measurement
    const markerGroup = new THREE.Group();
    scene.add(markerGroup);
    markerGroupRef.current = markerGroup;

    // Manual Orbit Controls state
    let isDragging = false;
    let isPanning = false;
    let prevMouse = { x: 0, y: 0 };
    let cameraTarget = new THREE.Vector3(0, 0, 0);

    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 0 && !e.shiftKey) isDragging = true;
      if (e.button === 2 || e.shiftKey) isPanning = true;
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - prevMouse.x;
      const dy = e.clientY - prevMouse.y;

      if (isDragging) {
        const offset = camera.position.clone().sub(cameraTarget);
        const radius = offset.length();
        let theta = Math.atan2(offset.x, offset.z) - dx * 0.007;
        let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius))) - dy * 0.007;
        phi = Math.max(0.05, Math.min(Math.PI - 0.05, phi));

        camera.position.x = cameraTarget.x + radius * Math.sin(phi) * Math.sin(theta);
        camera.position.y = cameraTarget.y + radius * Math.cos(phi);
        camera.position.z = cameraTarget.z + radius * Math.sin(phi) * Math.cos(theta);
        camera.lookAt(cameraTarget);
      } else if (isPanning) {
        const panSpeed = 0.015;
        const right = new THREE.Vector3().crossVectors(camera.up, camera.getWorldDirection(new THREE.Vector3())).normalize();
        const up = camera.up.clone().normalize();
        const panOffset = right.clone().multiplyScalar(dx * panSpeed).add(up.clone().multiplyScalar(-dy * panSpeed));
        camera.position.add(panOffset);
        cameraTarget.add(panOffset);
        camera.lookAt(cameraTarget);
      }
      prevMouse = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
      isPanning = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomSpeed = 0.0018;
      const factor = 1 + e.deltaY * zoomSpeed;
      const offset = camera.position.clone().sub(cameraTarget).multiplyScalar(factor);
      camera.position.copy(cameraTarget).add(offset);
      camera.lookAt(cameraTarget);
    };

    const dom = renderer.domElement;
    const onContextMenu = (e: Event) => e.preventDefault();
    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    dom.addEventListener('wheel', onWheel, { passive: false });
    dom.addEventListener('contextmenu', onContextMenu);

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dom.removeEventListener('wheel', onWheel);
      dom.removeEventListener('contextmenu', onContextMenu);
      dom.remove();
      renderer.dispose();
    };
  }, []);

  // Update Geometry (Mesh & Points) whenever data, viewMode, or shadingStyle changes
  useEffect(() => {
    if (!parsedData || !modelGroupRef.current) return;

    const group = modelGroupRef.current;
    group.clear();

    const { positions, rgbColors, confColors, indices, triangleCount, center, extent } = parsedData;

    // Pick active color map
    let activeColors = rgbColors;
    if (shadingStyle === 'confidence') {
      activeColors = confColors;
    } else if (shadingStyle === 'clay') {
      const clayColors = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i += 3) {
        clayColors[i] = 0.78;
        clayColors[i + 1] = 0.82;
        clayColors[i + 2] = 0.88;
      }
      activeColors = clayColors;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(activeColors, 3));

    if (indices && indices.length > 0) {
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
      geometry.computeVertexNormals();
    }

    // 1. Triangular Mesh Object
    if (indices && indices.length > 0 && (viewMode === 'mesh_surface' || viewMode === 'mesh_wireframe' || viewMode === 'hybrid')) {
      let meshMat: THREE.Material;

      if (viewMode === 'mesh_wireframe') {
        meshMat = new THREE.MeshBasicMaterial({
          color: 0x00b4d8,
          wireframe: true
        });
      } else {
        // Solid surface with lighting and vertex color textures
        meshMat = new THREE.MeshStandardMaterial({
          vertexColors: shadingStyle !== 'clay',
          color: shadingStyle === 'clay' ? 0xd0d8e2 : 0xffffff,
          roughness: 0.55,
          metalness: 0.15,
          side: THREE.DoubleSide,
          flatShading: false
        });
      }

      const meshObj = new THREE.Mesh(geometry, meshMat);
      group.add(meshObj);
      meshObjRef.current = meshObj;
    }

    // 2. Point Cloud Object
    if (viewMode === 'point_cloud' || viewMode === 'hybrid') {
      const pointsMat = new THREE.PointsMaterial({
        size: pointSize * Math.max(0.4, extent / 25),
        vertexColors: true,
        sizeAttenuation: true
      });
      const pointsObj = new THREE.Points(geometry, pointsMat);
      group.add(pointsObj);
      pointsObjRef.current = pointsObj;
    }

    // Apply Metric Scale to the 3D model
    const currentScale = displayScale;
    group.scale.set(currentScale, currentScale, currentScale);

    // Update Ground Reference Grid
    if (sceneRef.current) {
      if (gridRef.current) {
        sceneRef.current.remove(gridRef.current);
        gridRef.current.geometry.dispose();
        gridRef.current = null;
      }
      const scaledExtent = extent * currentScale;
      const grid = new THREE.GridHelper(
        Math.ceil(scaledExtent * 1.5),
        20,
        0x2e4166,
        0x162235
      );
      grid.position.set(
        center.x * currentScale,
        (center.y - extent * 0.52) * currentScale,
        center.z * currentScale
      );
      sceneRef.current.add(grid);
      gridRef.current = grid;
    }

    // Frame camera on the model
    if (cameraRef.current) {
      const sCenter = center.clone().multiplyScalar(currentScale);
      const sExtent = extent * currentScale;
      cameraRef.current.position.set(
        sCenter.x + sExtent * 0.65,
        sCenter.y + sExtent * 0.6,
        sCenter.z + sExtent * 0.85
      );
      cameraRef.current.lookAt(sCenter);
    }
  }, [parsedData, viewMode, shadingStyle, pointSize, applyMetricScale, scaleFactor, displayScale]);

  // Click Raycaster for 2-Point Picking on Mesh Surface or Point Cloud
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickingMode || !mountRef.current || !cameraRef.current || !parsedData) return;

    const rect = mountRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.35 };
    raycaster.setFromCamera(mouse, cameraRef.current);

    const targets: THREE.Object3D[] = [];
    if (meshObjRef.current) targets.push(meshObjRef.current);
    if (pointsObjRef.current) targets.push(pointsObjRef.current);

    if (targets.length > 0) {
      const intersects = raycaster.intersectObjects(targets, false);
      if (intersects.length > 0) {
        // Obtain world coordinates of the clicked surface point
        const hitPoint = intersects[0].point.clone();
        const next = selectedPoints.length >= 2 ? [hitPoint] : [...selectedPoints, hitPoint];
        setSelectedPoints(next);
      }
    }
  };

  // Draw 3D measurement markers and connecting line
  useEffect(() => {
    const group = markerGroupRef.current;
    if (!group) return;

    group.clear();
    selectedPoints.forEach((pt, i) => {
      const markerGeo = new THREE.SphereGeometry(0.2, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: i === 0 ? 0x00b4d8 : 0x06d6a0 });
      const sphere = new THREE.Mesh(markerGeo, markerMat);
      sphere.position.copy(pt);
      group.add(sphere);
    });

    if (selectedPoints.length === 2) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints(selectedPoints);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
      const line = new THREE.Line(lineGeo, lineMat);
      group.add(line);

      const rawDist = selectedPoints[0].distanceTo(selectedPoints[1]);
      setStats((s) => ({ ...s, distance: rawDist }));

      // Calibrated artifacts are already in the displayed metric/ENU frame. The backend
      // accounts for the current scale when a later two-point calibration is submitted.
      const currentScale = calibratedSource ? 1.0 : displayScale;
      const p1Model = selectedPoints[0].clone().divideScalar(currentScale);
      const p2Model = selectedPoints[1].clone().divideScalar(currentScale);

      onPointsSelected(
        [p1Model.x, p1Model.y, p1Model.z],
        [p2Model.x, p2Model.y, p2Model.z]
      );
    } else {
      setStats((s) => ({ ...s, distance: null }));
    }
  }, [selectedPoints, scaleFactor, applyMetricScale, calibratedSource, displayScale]);

  const handleResetCamera = () => {
    if (cameraRef.current && parsedData) {
      const currentScale = displayScale;
      const c = parsedData.center.clone().multiplyScalar(currentScale);
      const e = parsedData.extent * currentScale;
      cameraRef.current.position.set(c.x + e * 0.65, c.y + e * 0.6, c.z + e * 0.85);
      cameraRef.current.lookAt(c);
    }
  };

  const hasTriangularMesh = (parsedData?.triangleCount ?? 0) > 0;

  return (
    <div className="card" style={{ padding: '1rem', position: 'relative' }}>
      {/* 3D Viewer Header Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        marginBottom: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Box size={18} color="var(--accent-blue)" />
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>3. 3D Inspection (Mesh & Point Cloud)</h2>
          {stats.triangleCount > 0 && (
            <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <Layers size={12} />
              {stats.triangleCount.toLocaleString()} Triangles
            </span>
          )}
          {stats.vertexCount > 0 && (
            <span className="badge badge-blue">
              {stats.vertexCount.toLocaleString()} Vertices
            </span>
          )}
          {scaleFactor !== 1.0 && (
            <span className="badge badge-yellow" title="Metric scale calibrated">
              Scale: {scaleFactor.toFixed(3)}x
            </span>
          )}
        </div>

        {/* View Mode Tabs */}
        <div style={{ display: 'flex', gap: '0.35rem', background: 'var(--bg-primary)', padding: '0.2rem', borderRadius: '6px', border: '1px solid var(--border-color)', flexWrap: 'wrap' }}>
          {hasTriangularMesh && (
            <>
              <button
                type="button"
                className={`btn ${viewMode === 'mesh_surface' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                onClick={() => setViewMode('mesh_surface')}
              >
                <Box size={14} />
                Triangular Mesh
              </button>
              <button
                type="button"
                className={`btn ${viewMode === 'mesh_wireframe' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
                onClick={() => setViewMode('mesh_wireframe')}
              >
                <Grid size={14} />
                Wireframe
              </button>
            </>
          )}
          <button
            type="button"
            className={`btn ${viewMode === 'point_cloud' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
            onClick={() => setViewMode('point_cloud')}
          >
            <Sparkles size={14} />
            Point Cloud
          </button>
          {hasTriangularMesh && (
            <button
              type="button"
              className={`btn ${viewMode === 'hybrid' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.35rem 0.65rem', fontSize: '0.75rem' }}
              onClick={() => setViewMode('hybrid')}
            >
              Mesh + Points
            </button>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {(viewMode === 'mesh_surface' || viewMode === 'point_cloud') && (
            <select
              value={shadingStyle}
              onChange={(e) => setShadingStyle(e.target.value as any)}
              style={{ fontSize: '0.75rem', padding: '0.3rem 0.5rem' }}
              title="Mesh Shading Style"
            >
              <option value="textured">RGB Texture</option>
              <option value="confidence">Density Support Heatmap</option>
              <option value="clay">Clay Shaded</option>
            </select>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem' }}
            onClick={handleResetCamera}
            title="Reset Camera View"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </div>

      {/* WebGL Canvas Viewport */}
      <div
        ref={mountRef}
        onClick={handleCanvasClick}
        style={{
          width: '100%',
          height: '560px',
          background: '#0a0e17',
          borderRadius: '8px',
          position: 'relative',
          cursor: pickingMode ? 'crosshair' : 'grab',
          overflow: 'hidden'
        }}
      >
        {loading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(10, 14, 23, 0.75)',
            color: 'var(--text-primary)',
            fontSize: '0.9rem',
            zIndex: 10
          }}>
            Loading 3D Triangular Model...
          </div>
        )}

        {/* Mesh & Scale Information HUD */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          background: 'rgba(19, 27, 46, 0.92)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '0.55rem 0.85rem',
          fontSize: '0.75rem',
          zIndex: 5,
          pointerEvents: 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
            <Target size={14} />
            <span>3D Triangular Model & Metric Ruler</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
            {selectedPoints.length === 0 && 'Click any two surface points on mesh to measure'}
            {selectedPoints.length === 1 && 'Click second point to compute physical distance'}
            {selectedPoints.length === 2 && stats.distance !== null && (
              <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                Measured: {stats.distance.toFixed(3)} m
                {scaleFactor !== 1.0 && ` (calibrated at ${scaleFactor.toFixed(3)}x)`}
              </span>
            )}
          </div>
        </div>

        {/* Confidence Legend Overlay */}
        {(shadingStyle === 'confidence' || viewMode === 'point_cloud') && (
          <div style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            background: 'rgba(19, 27, 46, 0.92)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '0.6rem 0.8rem',
            fontSize: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.35rem',
            zIndex: 5,
            pointerEvents: 'none'
          }}>
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.1rem' }}>LOCAL DENSITY SUPPORT</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#06d6a0' }} />
              <span>Dense neighborhood (≥ 0.8): heuristic only</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffd166' }} />
              <span>Moderate neighborhood (0.4 - 0.8)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef476f' }} />
              <span>Sparse neighborhood (&lt; 0.4): heuristic only</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
