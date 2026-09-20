import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Eye, RotateCcw, Target, Shield, Palette, ZoomIn } from 'lucide-react';
import { assetUrl } from '../services/api';

interface Viewer3DProps {
  plyUrl: string | null;
  confidencePlyUrl: string | null;
  onPointsSelected: (p1: [number, number, number], p2: [number, number, number]) => void;
  scaleFactor: number;
}

interface ParsedPly {
  positions: Float32Array;
  rgbColors: Float32Array;
  confColors: Float32Array;
  confidences: Float32Array;
  center: THREE.Vector3;
  extent: number;
}

export const Viewer3D: React.FC<Viewer3DProps> = ({
  plyUrl,
  confidencePlyUrl,
  onPointsSelected,
  scaleFactor
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [colorMode, setColorMode] = useState<'rgb' | 'confidence' | 'high_only'>('confidence');
  const [pointSize, setPointSize] = useState<number>(0.08);
  const [pickingMode, setPickingMode] = useState<boolean>(true);
  const [selectedPoints, setSelectedPoints] = useState<THREE.Vector3[]>([]);
  const [parsedData, setParsedData] = useState<ParsedPly | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [stats, setStats] = useState<{ count: number; distance: number | null }>({ count: 0, distance: null });

  // Scene references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const pointsObjRef = useRef<THREE.Points | null>(null);
  const markerGroupRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);

  // Parse ASCII PLY
  const parsePlyText = (text: string): ParsedPly => {
    const lines = text.split('\n');
    let headerEnded = false;
    let vertexCount = 0;
    const posList: number[] = [];
    const rgbList: number[] = [];
    const confColorList: number[] = [];
    const confList: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (!headerEnded) {
        if (line.startsWith('element vertex')) {
          vertexCount = parseInt(line.split(' ')[2], 10);
        } else if (line === 'end_header') {
          headerEnded = true;
        }
        continue;
      }

      // Vertex line: x y z r g b [conf]
      const parts = line.split(/\s+/);
      if (parts.length >= 6) {
        const x = parseFloat(parts[0]);
        const y = parseFloat(parts[1]);
        const z = parseFloat(parts[2]);
        const r = parseFloat(parts[3]) / 255.0;
        const g = parseFloat(parts[4]) / 255.0;
        const b = parseFloat(parts[5]) / 255.0;
        const conf = parts.length >= 7 ? parseFloat(parts[6]) : 0.85;

        posList.push(x, y, z);
        rgbList.push(r, g, b);
        confList.push(conf);

        // Map confidence to Heatmap Color
        if (conf >= 0.8) {
          confColorList.push(0.02, 0.85, 0.2); // Green
        } else if (conf >= 0.4) {
          confColorList.push(1.0, 0.8, 0.1);  // Yellow
        } else {
          confColorList.push(0.95, 0.2, 0.15); // Red/Orange
        }
      }
    }

    const positions = new Float32Array(posList);
    const rgbColors = new Float32Array(rgbList);
    const confColors = new Float32Array(confColorList);
    const confidences = new Float32Array(confList);

    // Compute center + extent (bbox of the cloud, in COLMAP model units)
    const center = new THREE.Vector3();
    let extent = 20;
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
      extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    }

    return { positions, rgbColors, confColors, confidences, center, extent };
  };

  // Fetch and parse PLY — verifies the parsed vertex count against the
  // header's declared count and retries (cache-busted) if the body was
  // truncated, so a mid-write read can never poison the viewer.
  useEffect(() => {
    const base = assetUrl(confidencePlyUrl || plyUrl);
    if (!base) return;

    let cancelled = false;
    const maxAttempts = 5;

    const attemptFetch = (attempt: number): void => {
      const sep = base.includes('?') ? '&' : '?';
      const targetUrl = attempt === 0 ? base : `${base}${sep}retry=${attempt}`;
      setLoading(true);
      fetch(targetUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP error ${res.status}`);
          return res.text();
        })
        .then((text) => {
          const parsed = parsePlyText(text);
          const parsedCount = parsed.positions.length / 3;
          const headerMatch = text.match(/element vertex (\d+)/);
          const declared = headerMatch ? parseInt(headerMatch[1], 10) : parsedCount;
          if (parsedCount < declared && attempt < maxAttempts - 1) {
            setTimeout(() => { if (!cancelled) attemptFetch(attempt + 1); }, 600);
            return;
          }
          if (cancelled) return;
          setParsedData(parsed);
          setStats((prev) => ({ ...prev, count: parsedCount }));
          setLoading(false);
        })
        .catch((err) => {
          console.error('Failed to load PLY:', err);
          if (attempt < maxAttempts - 1 && !cancelled) {
            setTimeout(() => attemptFetch(attempt + 1), 600);
            return;
          }
          setLoading(false);
        });
    };
    attemptFetch(0);
    return () => { cancelled = true; };
  }, [plyUrl, confidencePlyUrl]);

  // Three.js scene setup and rendering
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = 550;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e17);
    sceneRef.current = scene;

    // Grid and Axes helpers
    const grid = new THREE.GridHelper(20, 20, 0x2e4166, 0x1a2436);
    grid.position.y = -0.01;
    scene.add(grid);
    gridRef.current = grid;

    const axes = new THREE.AxesHelper(3);
    scene.add(axes);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(10, 10, 15);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.replaceChildren(renderer.domElement);
    rendererRef.current = renderer;

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
        // Rotate around target
        const offset = camera.position.clone().sub(cameraTarget);
        const radius = offset.length();
        let theta = Math.atan2(offset.x, offset.z) - dx * 0.008;
        let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius))) - dy * 0.008;
        phi = Math.max(0.1, Math.min(Math.PI - 0.1, phi));

        camera.position.x = cameraTarget.x + radius * Math.sin(phi) * Math.sin(theta);
        camera.position.y = cameraTarget.y + radius * Math.cos(phi);
        camera.position.z = cameraTarget.z + radius * Math.sin(phi) * Math.cos(theta);
        camera.lookAt(cameraTarget);
      } else if (isPanning) {
        // Pan
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
      const zoomSpeed = 0.002;
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
      if (gridRef.current) {
        gridRef.current.geometry.dispose();
        (gridRef.current.material as THREE.Material).dispose();
        gridRef.current = null;
      }
      renderer.dispose();
    };
  }, []);

  // Update Geometry whenever parsedData or colorMode changes
  useEffect(() => {
    if (!parsedData || !sceneRef.current) return;

    const scene = sceneRef.current;
    if (pointsObjRef.current) {
      scene.remove(pointsObjRef.current);
      pointsObjRef.current.geometry.dispose();
      (pointsObjRef.current.material as THREE.Material).dispose();
      pointsObjRef.current = null;
    }

    const { positions, rgbColors, confColors, confidences, center, extent } = parsedData;

    let activePositions = positions;
    let activeColors = colorMode === 'rgb' ? rgbColors : confColors;

    // Filter "High Confidence Only"
    if (colorMode === 'high_only') {
      const highPos: number[] = [];
      const highCol: number[] = [];
      for (let i = 0; i < confidences.length; i++) {
        if (confidences[i] >= 0.8) {
          highPos.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
          highCol.push(confColors[i * 3], confColors[i * 3 + 1], confColors[i * 3 + 2]);
        }
      }
      activePositions = new Float32Array(highPos);
      activeColors = new Float32Array(highCol);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(activePositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(activeColors, 3));

    const material = new THREE.PointsMaterial({
      size: pointSize * Math.max(0.5, extent / 20),
      vertexColors: true,
      sizeAttenuation: true
    });

    const pointsObj = new THREE.Points(geometry, material);
    scene.add(pointsObj);
    pointsObjRef.current = pointsObj;

    // Resize the reference grid to the cloud and place it just below it,
    // so the ground plane reads against the points instead of floating away.
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      (gridRef.current.material as THREE.Material).dispose();
      gridRef.current = null;
    }
    const grid = new THREE.GridHelper(
      Math.ceil(extent * 1.6), 20, 0x2e4166, 0x1a2436
    );
    grid.position.set(center.x, center.y - extent / 2 - extent * 0.02, center.z);
    scene.add(grid);
    gridRef.current = grid;

    // Frame the camera from a higher angle so ground structure reads clearly
    if (cameraRef.current) {
      cameraRef.current.position.set(
        center.x + extent * 0.55,
        center.y + extent * 0.5,
        center.z + extent * 0.75
      );
      cameraRef.current.lookAt(center);
    }
  }, [parsedData, colorMode, pointSize]);

  // Click Raycaster for 2-Point Picking
  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pickingMode || !mountRef.current || !cameraRef.current || !parsedData) return;

    const rect = mountRef.current.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.3 };
    raycaster.setFromCamera(mouse, cameraRef.current);

    if (pointsObjRef.current) {
      const intersects = raycaster.intersectObject(pointsObjRef.current);
      if (intersects.length > 0) {
        const hitPoint = intersects[0].point.clone();
        // Start a fresh pair once two points are already selected.
        // Marker drawing happens in the effect below (state updaters must stay pure).
        const next = selectedPoints.length >= 2 ? [hitPoint] : [...selectedPoints, hitPoint];
        setSelectedPoints(next);
      }
    }
  };

  // Draw calibration markers & connecting line whenever the selection changes
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

      const dist = selectedPoints[0].distanceTo(selectedPoints[1]);
      setStats((s) => ({ ...s, distance: dist }));

      // Trigger calibration callback
      onPointsSelected(
        [selectedPoints[0].x, selectedPoints[0].y, selectedPoints[0].z],
        [selectedPoints[1].x, selectedPoints[1].y, selectedPoints[1].z]
      );
    } else {
      setStats((s) => ({ ...s, distance: null }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoints]);

  const handleResetCamera = () => {
    if (cameraRef.current && parsedData) {
      const c = parsedData.center;
      const e = parsedData.extent;
      cameraRef.current.position.set(c.x + e * 0.55, c.y + e * 0.5, c.z + e * 0.75);
      cameraRef.current.lookAt(c);
    }
  };

  return (
    <div className="card" style={{ padding: '1rem', position: 'relative' }}>
      {/* Viewer Header Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        marginBottom: '0.75rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Eye size={18} color="var(--accent-blue)" />
          <h2 style={{ fontSize: '1.05rem', fontWeight: 600 }}>3. 3D Inspection & Point Picker</h2>
          {stats.count > 0 && (
            <span className="badge badge-blue">{stats.count.toLocaleString()} pts</span>
          )}
        </div>

        {/* Shading Mode Tabs */}
        <div style={{ display: 'flex', gap: '0.35rem', background: 'var(--bg-primary)', padding: '0.2rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <button
            type="button"
            className={`btn ${colorMode === 'confidence' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
            onClick={() => setColorMode('confidence')}
          >
            <Shield size={14} />
            Confidence Heatmap
          </button>
          <button
            type="button"
            className={`btn ${colorMode === 'rgb' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
            onClick={() => setColorMode('rgb')}
          >
            <Palette size={14} />
            RGB Texture
          </button>
          <button
            type="button"
            className={`btn ${colorMode === 'high_only' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
            onClick={() => setColorMode('high_only')}
          >
            High Confidence Only
          </button>
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
            onClick={handleResetCamera}
            title="Reset Camera View"
          >
            <RotateCcw size={14} />
            Reset View
          </button>
        </div>
      </div>

      {/* WebGL Canvas Viewport */}
      <div
        style={{
          width: '100%',
          height: '550px',
          background: '#0a0e17',
          borderRadius: '8px',
          position: 'relative',
          cursor: pickingMode ? 'crosshair' : 'grab',
          overflow: 'hidden'
        }}
      >
        {/* Dedicated host div for the Three.js canvas. It must contain NO JSX children:
            the Three.js effect calls replaceChildren() on it, and if React-managed nodes
            (the overlays below) lived here they would be silently detached from the DOM.
            React's next insert into this container would then throw NotFoundError and
            unmount the whole app (blank page) as soon as a reconstruction finished. */}
        <div
          ref={mountRef}
          onClick={handleCanvasClick}
          style={{ position: 'absolute', inset: 0 }}
        />
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
            Loading 3D Point Cloud...
          </div>
        )}

        {/* Confidence Legend Overlay */}
        {colorMode === 'confidence' && (
          <div style={{
            position: 'absolute',
            bottom: '12px',
            left: '12px',
            background: 'rgba(19, 27, 46, 0.9)',
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
            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.1rem' }}>GEOMETRY CONFIDENCE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#06d6a0' }} />
              <span>High (≥ 0.8): Multi-View Stereo Validated</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ffd166' }} />
              <span>Medium (0.4 - 0.8): Sparse Visual Support</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef476f' }} />
              <span>Low (&lt; 0.4): Monocular Depth Fill-in</span>
            </div>
          </div>
        )}

        {/* 2-Point Picking Overlay Status */}
        <div style={{
          position: 'absolute',
          top: '12px',
          left: '12px',
          background: 'rgba(19, 27, 46, 0.9)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '0.5rem 0.75rem',
          fontSize: '0.75rem',
          zIndex: 5,
          pointerEvents: 'none'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
            <Target size={14} />
            <span>2-Point Metric Scale Picker</span>
          </div>
          <div style={{ color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            {selectedPoints.length === 0 && 'Click first 3D point on model'}
            {selectedPoints.length === 1 && 'Click second 3D point to measure'}
            {selectedPoints.length === 2 && stats.distance && (
              <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                Selected Distance: {stats.distance.toFixed(3)} units
                {scaleFactor !== 1.0 && ` (${(stats.distance * scaleFactor).toFixed(2)}m calibrated)`}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
