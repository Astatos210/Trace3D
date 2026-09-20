import React from 'react';
import { Activity, Camera, Box, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { HealthStatus } from '../services/api';

interface HeaderProps {
  health: HealthStatus | null;
  activeMockMode: boolean;
}

export const Header: React.FC<HeaderProps> = ({ health, activeMockMode }) => {
  return (
    <header style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
      <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{
            background: 'linear-gradient(135deg, #0077b6, #00b4d8)',
            padding: '0.5rem',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Camera size={24} color="#ffffff" />
          </div>
          <div>
            <h1 style={{ fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Drone3D Metric Reconstruction
              <span className="badge badge-blue">Prototype v0.1</span>
            </h1>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Single-Pass Video • COLMAP SfM/MVS • Open3D • Metric Georeferencing
            </p>
          </div>
        </div>

        {/* System Health Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {health ? (
            <>
              <div className="badge badge-green" title={`Python ${health.python_version}`}>
                <CheckCircle size={12} />
                API Online
              </div>
              <div className="badge badge-green" title={`Open3D ${health.open3d_version}`}>
                <Box size={12} />
                Open3D {health.open3d_version}
              </div>
              <div
                className={`badge ${health.colmap.available ? 'badge-green' : 'badge-yellow'}`}
                title={health.colmap.notice || health.colmap.path || 'COLMAP CLI'}
              >
                {health.colmap.available ? <CheckCircle size={12} /> : <AlertTriangle size={12} />}
                COLMAP: {health.colmap.available ? 'Ready' : 'Not Found'}
              </div>
            </>
          ) : (
            <div className="badge badge-red">
              <XCircle size={12} />
              API Disconnected
            </div>
          )}
        </div>
      </div>

      {/* Mock Mode Alert Banner */}
      {activeMockMode && (
        <div style={{
          background: 'rgba(255, 209, 102, 0.1)',
          borderTop: '1px solid rgba(255, 209, 102, 0.3)',
          borderBottom: '1px solid rgba(255, 209, 102, 0.3)',
          padding: '0.5rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          fontSize: '0.85rem',
          color: 'var(--accent-yellow)',
          fontWeight: 600
        }}>
          <AlertTriangle size={16} />
          MOCK MODE ACTIVE: Using synthetic reconstruction data for frontend UI testing. COLMAP is not executed.
        </div>
      )}
    </header>
  );
};
