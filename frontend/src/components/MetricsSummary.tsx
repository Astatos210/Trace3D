import React from 'react';
import { BarChart3, Download, FileText, CheckCircle, Database } from 'lucide-react';
import { JobStatus, assetUrl } from '../services/api';

interface MetricsSummaryProps {
  job: JobStatus | null;
}

export const MetricsSummary: React.FC<MetricsSummaryProps> = ({ job }) => {
  if (!job || job.status !== 'COMPLETED') return null;

  const outputs = job.outputs;

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
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Mesh Triangles</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-yellow)', fontFamily: 'var(--font-mono)' }}>
            {job.mesh_triangle_count.toLocaleString()}
          </div>
        </div>

        <div style={{ background: 'var(--bg-primary)', padding: '0.75rem', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Metric Scale Factor</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
            {job.scale_factor.toFixed(4)}x
          </div>
        </div>
      </div>

      {/* Downloadable Assets */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {outputs.dense_ply && (
          <a
            href={assetUrl(outputs.dense_ply)}
            download
            className="btn btn-secondary"
            style={{ textDecoration: 'none', fontSize: '0.8rem' }}
          >
            <Download size={14} />
            Download Point Cloud (.PLY)
          </a>
        )}

        {outputs.confidence_ply && (
          <a
            href={assetUrl(outputs.confidence_ply)}
            download
            className="btn btn-secondary"
            style={{ textDecoration: 'none', fontSize: '0.8rem' }}
          >
            <Download size={14} />
            Confidence Point Cloud (.PLY)
          </a>
        )}

        {outputs.mesh_ply && (
          <a
            href={assetUrl(outputs.mesh_ply)}
            download
            className="btn btn-secondary"
            style={{ textDecoration: 'none', fontSize: '0.8rem' }}
          >
            <Download size={14} />
            Download Mesh (.PLY)
          </a>
        )}

        {outputs.metrics_json && (
          <a
            href={assetUrl(outputs.metrics_json)}
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
            style={{ textDecoration: 'none', fontSize: '0.8rem' }}
          >
            <FileText size={14} />
            View metrics.json
          </a>
        )}
      </div>
    </div>
  );
};
