import React from 'react';
import { Loader2, CheckCircle2, AlertOctagon, Terminal, Eye, Layers, ShieldCheck } from 'lucide-react';
import { JobStatus } from '../services/api';

interface JobProgressProps {
  job: JobStatus | null;
}

const STAGES = [
  { key: 'EXTRACTING_FRAMES', label: '1. Frame Extraction & Blur Filter' },
  { key: 'SPARSE_RECONSTRUCTION', label: '2. COLMAP Sparse Mapping' },
  { key: 'DENSE_RECONSTRUCTION', label: '3. COLMAP Dense Stereo' },
  { key: 'OPEN3D_PROCESSING', label: '4. Open3D Filtering & Meshing' },
  { key: 'CONFIDENCE_SCORING', label: '5. Confidence Layer' }
];

export const JobProgress: React.FC<JobProgressProps> = ({ job }) => {
  if (!job) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
        <Layers size={36} style={{ margin: '0 auto 1rem', opacity: 0.5 }} />
        <h3 style={{ fontSize: '1rem', fontWeight: 500 }}>No Active Job</h3>
        <p style={{ fontSize: '0.85rem' }}>Select a video clip and run the pipeline above to start 3D reconstruction.</p>
      </div>
    );
  }

  const isCompleted = job.status === 'COMPLETED';
  const isFailed = job.status === 'FAILED';
  const isProcessing = job.status === 'PROCESSING' || job.status === 'QUEUED';

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>2. Reconstruction Pipeline</h2>
          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>ID: {job.id}</span>
        </div>

        <div>
          {isCompleted && <span className="badge badge-green"><CheckCircle2 size={12} /> Completed</span>}
          {isProcessing && <span className="badge badge-blue"><Loader2 size={12} className="spin" /> Processing ({job.progress}%)</span>}
          {isFailed && <span className="badge badge-red"><AlertOctagon size={12} /> Failed</span>}
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{
        background: 'var(--bg-primary)',
        height: '10px',
        borderRadius: '5px',
        overflow: 'hidden',
        border: '1px solid var(--border-color)',
        marginBottom: '1.25rem'
      }}>
        <div style={{
          height: '100%',
          width: `${job.progress}%`,
          background: isFailed ? 'var(--accent-red)' : 'linear-gradient(90deg, #0077b6, #00b4d8, #06d6a0)',
          transition: 'width 0.4s ease'
        }} />
      </div>

      {/* Pipeline Stage Indicators */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '1.25rem' }}>
        {STAGES.map((s, idx) => {
          const stageIndex = STAGES.findIndex((st) => st.key === job.stage);
          const isCurrent = job.stage === s.key;
          const isPast = isCompleted || (stageIndex > idx && !isFailed);

          return (
            <div
              key={s.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.5rem 0.75rem',
                borderRadius: '6px',
                background: isCurrent ? 'rgba(0, 180, 216, 0.1)' : 'transparent',
                border: isCurrent ? '1px solid rgba(0, 180, 216, 0.3)' : '1px solid transparent'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                {isPast ? (
                  <CheckCircle2 size={16} color="var(--accent-green)" />
                ) : isCurrent ? (
                  <Loader2 size={16} color="var(--accent-blue)" style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <div style={{ width: '16px', height: '16px', borderRadius: '50%', border: '1px solid var(--border-color)' }} />
                )}
                <span style={{ color: isCurrent ? 'var(--text-primary)' : isPast ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
                  {s.label}
                </span>
              </div>

              {s.key === 'SPARSE_RECONSTRUCTION' && job.registered_images > 0 && (
                <span className="badge badge-blue" style={{ fontSize: '0.7rem' }}>
                  {job.registered_images} Cameras Registered
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Error Notice */}
      {isFailed && job.error && (
        <div style={{
          background: 'rgba(239, 71, 111, 0.1)',
          border: '1px solid rgba(239, 71, 111, 0.4)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          color: 'var(--text-primary)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--accent-red)', fontWeight: 600, marginBottom: '0.5rem' }}>
            <AlertOctagon size={18} />
            Pipeline Halted: Unresolved Component Error
          </div>
          <pre style={{
            fontSize: '0.8rem',
            whiteSpace: 'pre-wrap',
            background: 'var(--bg-primary)',
            padding: '0.75rem',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            color: '#ff85a1'
          }}>
            {job.error}
          </pre>
        </div>
      )}

      {/* Live Log Stream */}
      <div style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-color)',
        borderRadius: '8px',
        padding: '0.75rem 1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          <Terminal size={14} />
          <span>EXECUTION LOG</span>
        </div>
        <div style={{
          maxHeight: '140px',
          overflowY: 'auto',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem'
        }}>
          {job.recent_logs.map((log, i) => (
            <div key={i} style={{ fontFamily: 'var(--font-mono)' }}>{log}</div>
          ))}
        </div>
      </div>
    </div>
  );
};
