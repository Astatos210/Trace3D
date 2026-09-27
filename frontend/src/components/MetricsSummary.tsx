import React from 'react';
import { BarChart3, Download, FileText, CheckCircle, Box, Layers, Ruler } from 'lucide-react';
import { downloadArtifact, JobStatus } from '../services/api';

interface MetricsSummaryProps {
  job: JobStatus | null;
}

export const MetricsSummary: React.FC<MetricsSummaryProps> = ({ job }) => {
  if (!job || job.status !== 'COMPLETED') return null;

  const outputs = job.outputs;
  const isCalibrated = job.scale_factor !== 1.0 || Boolean(
    outputs.scaled_point_cloud || outputs.scaled_mesh_ply || outputs.scaled_mesh_glb
  );
  const download = (path: string | undefined, filename: string) => {
    if (path) void downloadArtifact(path, filename).catch((error) => window.alert(error.message));
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <BarChart3 size={20} color="var(--accent-blue)" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>5. Model Metrics & Export Assets</h2>
        </div>
        <span className="badge badge-green">
          <CheckCircle size={12} />
          Reconstruction Complete
        </span>
      </div>

      {/* Metrics Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '0.75rem',
        marginBottom: '1.25rem'
      }}>
        <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Registered Cameras</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
            {job.registered_images}
          </div>
        </div>

        <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Dense 3D Points</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-green)', fontFamily: 'var(--font-mono)' }}>
            {job.point_count.toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Layers size={12} />
            Mesh Triangles
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-yellow)', fontFamily: 'var(--font-mono)' }}>
            {job.mesh_triangle_count.toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Ruler size={12} />
            Metric Scale Factor
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: isCalibrated ? 'var(--accent-green)' : 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {job.scale_factor.toFixed(4)}x
          </div>
        </div>
      </div>

      {/* Downloadable Assets */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {/* Triangular Mesh Downloads */}
        {(outputs.scaled_mesh_ply || outputs.mesh_ply) && (
          <button
            type="button"
            onClick={() => download(outputs.scaled_mesh_ply || outputs.mesh_ply, 'drone-model.ply')}
            className="btn btn-primary"
            style={{ fontSize: '0.8rem' }}
          >
            <Box size={14} />
            {isCalibrated ? 'Download Calibrated Mesh (.PLY)' : 'Download Triangular Mesh (.PLY)'}
          </button>
        )}

        {(outputs.scaled_mesh_obj || outputs.mesh_obj) && (
          <button
            type="button"
            onClick={() => download(outputs.scaled_mesh_obj || outputs.mesh_obj, 'drone-model.obj')}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem' }}
          >
            <Download size={14} />
            Download Mesh (.OBJ)
          </button>
        )}

        {(outputs.scaled_mesh_glb || outputs.mesh_glb) && (
          <button
            type="button"
            onClick={() => download(outputs.scaled_mesh_glb || outputs.mesh_glb, 'drone-model.glb')}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem' }}
          >
            <Download size={14} />
            Download Mesh (.GLB)
          </button>
        )}

        {/* Point Cloud Downloads */}
        {outputs.dense_ply && (
          <button
            type="button"
            onClick={() => download(outputs.scaled_point_cloud || outputs.dense_ply, 'point-cloud.ply')}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem' }}
          >
            <Download size={14} />
            Point Cloud (.PLY)
          </button>
        )}

        {outputs.confidence_ply && (
          <button
            type="button"
            onClick={() => download(outputs.scaled_confidence_ply || outputs.confidence_ply, 'confidence-cloud.ply')}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem' }}
          >
            <Download size={14} />
            Density Support Cloud (.PLY)
          </button>
        )}

        {outputs.metrics_json && (
          <button
            type="button"
            onClick={() => download(outputs.metrics_json, 'metrics.json')}
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem' }}
          >
            <FileText size={14} />
            metrics.json
          </button>
        )}
      </div>
    </div>
  );
};
