import React, { useState, useEffect } from 'react';
import { Upload, Film, Sliders, AlertCircle, Play } from 'lucide-react';
import { SampleVideo, createJob } from '../services/api';

interface VideoUploaderProps {
  samples: SampleVideo[];
  colmapAvailable: boolean;
  onJobCreated: (jobId: string, mockMode: boolean) => void;
  disabled: boolean;
}

export const VideoUploader: React.FC<VideoUploaderProps> = ({
  samples,
  colmapAvailable,
  onJobCreated,
  disabled
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedSample, setSelectedSample] = useState<string>(samples[0]?.name || '');
  const [sourceType, setSourceType] = useState<'upload' | 'sample'>('sample');
  const [sampleFps, setSampleFps] = useState<number>(2.0);
  const [blurThreshold, setBlurThreshold] = useState<number>(100.0);
  const [voxelSize, setVoxelSize] = useState<number>(0.05);
  // Default to mock mode if COLMAP is unavailable on system
  const [mockMode, setMockMode] = useState<boolean>(!colmapAvailable);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Sync sample selection once the async sample list arrives (state was initialized empty)
  useEffect(() => {
    if (!selectedSample && samples.length > 0) {
      setSelectedSample(samples[0].name);
    }
  }, [samples, selectedSample]);

  // Sync mock-mode default once health check resolves (COLMAP availability known async)
  useEffect(() => {
    setMockMode(!colmapAvailable);
  }, [colmapAvailable]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('sample_fps', sampleFps.toString());
      formData.append('blur_threshold', blurThreshold.toString());
      formData.append('voxel_size', voxelSize.toString());
      formData.append('mock_mode', mockMode ? 'true' : 'false');

      if (sourceType === 'upload') {
        if (!selectedFile) {
          throw new Error('Please select a video file to upload.');
        }
        formData.append('file', selectedFile);
      } else {
        if (!selectedSample) {
          throw new Error('Please select a sample video.');
        }
        formData.append('sample_name', selectedSample);
      }

      const res = await createJob(formData);
      onJobCreated(res.id, mockMode);
    } catch (err: any) {
      setError(err.message || 'Failed to start processing job');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1.25rem' }}>
        <Film size={20} color="var(--accent-blue)" />
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>1. Video Ingestion & Quality Filtering</h2>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239, 71, 111, 0.1)',
          border: '1px solid rgba(239, 71, 111, 0.3)',
          color: 'var(--accent-red)',
          padding: '0.75rem',
          borderRadius: '6px',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem'
        }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Source Mode Toggle */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={`btn ${sourceType === 'sample' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => setSourceType('sample')}
            disabled={disabled}
          >
            <Film size={16} />
            Use Sample Drone Video
          </button>
          <button
            type="button"
            className={`btn ${sourceType === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1 }}
            onClick={() => setSourceType('upload')}
            disabled={disabled}
          >
            <Upload size={16} />
            Upload Video (MP4)
          </button>
        </div>

        {sourceType === 'sample' ? (
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Select Sample Clip:
            </label>
            <select
              value={selectedSample}
              onChange={(e) => setSelectedSample(e.target.value)}
              disabled={disabled}
              style={{ width: '100%' }}
            >
              {samples.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.size_mb} MB)
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ marginBottom: '1.25rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
              Select MP4 Video File:
            </label>
            <input
              type="file"
              accept="video/mp4,video/quicktime,video/x-matroska"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              disabled={disabled}
              style={{ width: '100%' }}
            />
            {selectedFile && (
              <p style={{ fontSize: '0.8rem', color: 'var(--accent-blue)', marginTop: '0.25rem' }}>
                Selected: {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
              </p>
            )}
          </div>
        )}

        {/* Pipeline Hyperparameters */}
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem' }}>
            <Sliders size={16} color="var(--accent-blue)" />
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Frame Extraction & SfM Parameters
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {/* Sampling FPS */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                <span>Sampling Rate:</span>
                <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>{sampleFps} FPS</span>
              </div>
              <input
                type="range"
                min="1.0"
                max="3.0"
                step="0.5"
                value={sampleFps}
                onChange={(e) => setSampleFps(parseFloat(e.target.value))}
                disabled={disabled}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Recommended 1-3 FPS for optimal SfM parallax
              </span>
            </div>

            {/* Blur Threshold */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                <span>Laplacian Blur Threshold:</span>
                <span style={{ color: 'var(--accent-yellow)', fontWeight: 600 }}>{blurThreshold}</span>
              </div>
              <input
                type="range"
                min="20.0"
                max="250.0"
                step="10.0"
                value={blurThreshold}
                onChange={(e) => setBlurThreshold(parseFloat(e.target.value))}
                disabled={disabled}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Rejects blurry frames using Var(∇²I)
              </span>
            </div>

            {/* Voxel Downsampling Size */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                <span>Voxel Size:</span>
                <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>{voxelSize}m</span>
              </div>
              <input
                type="range"
                min="0.02"
                max="0.20"
                step="0.01"
                value={voxelSize}
                onChange={(e) => setVoxelSize(parseFloat(e.target.value))}
                disabled={disabled}
                style={{ width: '100%' }}
              />
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Open3D spatial downsampling
              </span>
            </div>
          </div>
        </div>

        {/* Mock Mode Switch */}
        <div style={{
          background: mockMode ? 'rgba(255, 209, 102, 0.08)' : 'transparent',
          border: mockMode ? '1px solid rgba(255, 209, 102, 0.3)' : '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>Mock Reconstruction Mode</span>
              {mockMode && <span className="badge badge-yellow">MOCK</span>}
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
              Generates labeled synthetic geometry to test the full frontend, 3D viewer, and calibration when COLMAP is absent.
            </p>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={mockMode}
              onChange={(e) => setMockMode(e.target.checked)}
              disabled={disabled}
              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
            />
          </label>
        </div>

        {/* Action Button */}
        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '0.8rem' }}
          disabled={disabled || isSubmitting}
        >
          <Play size={18} />
          {isSubmitting ? 'Starting Job...' : 'Run 3D Reconstruction Pipeline'}
        </button>
      </form>
    </div>
  );
};
