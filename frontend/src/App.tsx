import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { VideoUploader } from './components/VideoUploader';
import { JobProgress } from './components/JobProgress';
import { Viewer3D } from './components/Viewer3D';
import { MetricCalibration } from './components/MetricCalibration';
import { MetricsSummary } from './components/MetricsSummary';
import {
  HealthStatus,
  SampleVideo,
  JobStatus,
  CalibrationResult,
  fetchHealth,
  fetchSamples,
  fetchJobStatus
} from './services/api';

export const App: React.FC = () => {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [samples, setSamples] = useState<SampleVideo[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [activeMockMode, setActiveMockMode] = useState<boolean>(false);

  // 3D Point Picking state for Metric Calibration
  const [pickedPoint1, setPickedPoint1] = useState<[number, number, number] | null>(null);
  const [pickedPoint2, setPickedPoint2] = useState<[number, number, number] | null>(null);

  // Load initial health and sample videos
  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((err) => console.error('Health check failed:', err));

    fetchSamples()
      .then(setSamples)
      .catch((err) => console.error('Fetch samples failed:', err));
  }, []);

  // Poll job status while active
  useEffect(() => {
    if (!activeJobId) return;

    let intervalId: any;
    const poll = async () => {
      try {
        const data = await fetchJobStatus(activeJobId);
        setJobStatus(data);
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          clearInterval(intervalId);
        }
      } catch (err) {
        console.error('Error polling job status:', err);
      }
    };

    poll();
    intervalId = setInterval(poll, 1500);

    return () => clearInterval(intervalId);
  }, [activeJobId]);

  const handleJobCreated = (jobId: string, mockMode: boolean) => {
    setActiveJobId(jobId);
    setActiveMockMode(mockMode);
    setPickedPoint1(null);
    setPickedPoint2(null);
  };

  const handlePointsSelected = (p1: [number, number, number], p2: [number, number, number]) => {
    setPickedPoint1(p1);
    setPickedPoint2(p2);
  };

  const handleCalibrationApplied = (result: CalibrationResult) => {
    if (jobStatus) {
      setJobStatus({
        ...jobStatus,
        scale_factor: result.scale_factor
      });
    }
  };

  const isBusy = jobStatus?.status === 'PROCESSING' || jobStatus?.status === 'QUEUED';

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        health={health}
        activeMockMode={activeMockMode || (jobStatus?.mock_mode ?? false)}
      />

      <main className="container" style={{ flex: 1, padding: '1.5rem' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(420px, 1fr) minmax(500px, 1.4fr)',
          gap: '1.5rem',
          alignItems: 'start'
        }}>
          {/* Left Column: Controls & Pipeline Stepper */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <VideoUploader
              samples={samples}
              colmapAvailable={health?.colmap.available ?? false}
              onJobCreated={handleJobCreated}
              disabled={isBusy}
            />

            <JobProgress job={jobStatus} />

            <MetricCalibration
              jobId={activeJobId}
              p1={pickedPoint1}
              p2={pickedPoint2}
              currentScaleFactor={jobStatus?.scale_factor ?? 1.0}
              onCalibrationApplied={handleCalibrationApplied}
              disabled={isBusy || jobStatus?.status !== 'COMPLETED'}
            />

            <MetricsSummary job={jobStatus} />
          </div>

          {/* Right Column: 3D Visualization Canvas */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', position: 'sticky', top: '1.5rem' }}>
            <Viewer3D
              plyUrl={jobStatus?.outputs.scaled_point_cloud || jobStatus?.outputs.dense_ply || null}
              confidencePlyUrl={jobStatus?.outputs.confidence_ply || null}
              meshPlyUrl={jobStatus?.outputs.scaled_mesh_ply || jobStatus?.outputs.mesh_ply || null}
              meshObjUrl={jobStatus?.outputs.scaled_mesh_obj || jobStatus?.outputs.mesh_obj || null}
              onPointsSelected={handlePointsSelected}
              scaleFactor={jobStatus?.scale_factor ?? 1.0}
            />
          </div>
        </div>
      </main>

      <footer style={{
        borderTop: '1px solid var(--border-color)',
        padding: '1rem',
        textAlign: 'center',
        fontSize: '0.8rem',
        color: 'var(--text-muted)'
      }}>
        Drone3D Prototype • Single-Pass Drone Video to Metrically Scaled 3D Model • FastAPI • COLMAP • Open3D • Three.js
      </footer>
    </div>
  );
};
export default App;
