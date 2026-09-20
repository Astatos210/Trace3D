import React, { useState } from 'react';
import { Compass, Ruler, CheckCircle2, AlertTriangle, ShieldAlert } from 'lucide-react';
import { calibrateJob, CalibrationResult } from '../services/api';

interface MetricCalibrationProps {
  jobId: string | null;
  p1: [number, number, number] | null;
  p2: [number, number, number] | null;
  currentScaleFactor: number;
  onCalibrationApplied: (result: CalibrationResult) => void;
  disabled: boolean;
}

export const MetricCalibration: React.FC<MetricCalibrationProps> = ({
  jobId,
  p1,
  p2,
  currentScaleFactor,
  onCalibrationApplied,
  disabled
}) => {
  const [knownDistance, setKnownDistance] = useState<string>('10.0');
  const [method, setMethod] = useState<'two_point' | 'gps'>('two_point');
  const [gpsLat, setGpsLat] = useState<string>('37.7749');
  const [gpsLon, setGpsLon] = useState<string>('-122.4194');
  const [gpsAlt, setGpsAlt] = useState<string>('45.0');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationSuccess, setCalibrationSuccess] = useState<CalibrationResult | null>(null);

  const handleApplyCalibration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId) return;

    setError(null);
    setIsSubmitting(true);

    try {
      let payload: any;
      if (method === 'two_point') {
        if (!p1 || !p2) {
          throw new Error('Please pick two 3D points on the model first in the 3D viewer.');
        }
        const distNum = parseFloat(knownDistance);
        if (isNaN(distNum) || distNum <= 0) {
          throw new Error('Please enter a valid positive distance in meters.');
        }
        payload = {
          method: 'two_point',
          two_point: {
            p1: p1,
            p2: p2,
            known_distance_meters: distNum
          }
        };
      } else {
        // Approximate GPS calibration test
        const latNum = parseFloat(gpsLat);
        const lonNum = parseFloat(gpsLon);
        const altNum = parseFloat(gpsAlt);

        // Synthetic 3 camera positions and GPS coordinates
        payload = {
          method: 'gps',
          gps: {
            camera_positions: [
              [-5.0, 0.0, 2.0],
              [0.0, 5.0, 2.5],
              [5.0, 0.0, 2.0]
            ],
            gps_coordinates: [
              { lat: latNum, lon: lonNum, alt: altNum },
              { lat: latNum + 0.0001, lon: lonNum, alt: altNum + 1.0 },
              { lat: latNum, lon: lonNum + 0.0001, alt: altNum }
            ]
          }
        };
      }

      const res = await calibrateJob(jobId, payload);
      setCalibrationSuccess(res.calibration);
      onCalibrationApplied(res.calibration);
    } catch (err: any) {
      setError(err.message || 'Calibration failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <Ruler size={20} color="var(--accent-blue)" />
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600 }}>4. Metric Calibration & Georeferencing</h2>
      </div>

      {error && (
        <div style={{
          background: 'rgba(239, 71, 111, 0.1)',
          border: '1px solid rgba(239, 71, 111, 0.3)',
          color: 'var(--accent-red)',
          padding: '0.75rem',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.85rem'
        }}>
          {error}
        </div>
      )}

      {/* Accuracy Disclaimer Box (Mandatory Requirement) */}
      <div style={{
        background: 'rgba(255, 209, 102, 0.08)',
        border: '1px solid rgba(255, 209, 102, 0.25)',
        borderRadius: '8px',
        padding: '0.75rem 1rem',
        marginBottom: '1.25rem',
        fontSize: '0.8rem',
        color: 'var(--text-secondary)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-yellow)', fontWeight: 600, marginBottom: '0.25rem' }}>
          <ShieldAlert size={16} />
          Geodetic Accuracy Standards Disclaimer
        </div>
        <p>
          Single-pass consumer drone GPS provides approximate georeferencing (±2 to 5m RMSE).
          <strong style={{ color: 'var(--text-primary)' }}> Centimeter-level accuracy is never claimed</strong> without RTK, PPK, or surveyed Ground Control Points (GCPs). Use the 2-point known-distance fallback for exact metric scale calibration.
        </p>
      </div>

      <form onSubmit={handleApplyCalibration}>
        {/* Method selector */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button
            type="button"
            className={`btn ${method === 'two_point' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, fontSize: '0.85rem' }}
            onClick={() => setMethod('two_point')}
            disabled={disabled}
          >
            <Ruler size={14} />
            2-Point Scale Fallback
          </button>
          <button
            type="button"
            className={`btn ${method === 'gps' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ flex: 1, fontSize: '0.85rem' }}
            onClick={() => setMethod('gps')}
            disabled={disabled}
          >
            <Compass size={14} />
            GPS Trajectory Alignment
          </button>
        </div>

        {method === 'two_point' ? (
          <div>
            <div style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              padding: '0.75rem',
              marginBottom: '1rem',
              fontSize: '0.85rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Point 1 (P₁):</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {p1 ? `[${p1[0].toFixed(2)}, ${p1[1].toFixed(2)}, ${p1[2].toFixed(2)}]` : 'Not Selected (Click in 3D View)'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Point 2 (P₂):</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>
                  {p2 ? `[${p2[0].toFixed(2)}, ${p2[1].toFixed(2)}, ${p2[2].toFixed(2)}]` : 'Not Selected (Click in 3D View)'}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                Known Real-World Distance Between P₁ and P₂ (Meters):
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={knownDistance}
                onChange={(e) => setKnownDistance(e.target.value)}
                disabled={disabled}
                placeholder="e.g. 10.0"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                Ref Latitude (°):
              </label>
              <input
                type="number"
                step="0.000001"
                value={gpsLat}
                onChange={(e) => setGpsLat(e.target.value)}
                disabled={disabled}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                Ref Longitude (°):
              </label>
              <input
                type="number"
                step="0.000001"
                value={gpsLon}
                onChange={(e) => setGpsLon(e.target.value)}
                disabled={disabled}
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>
                Ref Altitude (m):
              </label>
              <input
                type="number"
                step="0.1"
                value={gpsAlt}
                onChange={(e) => setGpsAlt(e.target.value)}
                disabled={disabled}
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center' }}
          disabled={disabled || isSubmitting || !jobId}
        >
          {isSubmitting ? 'Computing Scale Alignment...' : 'Apply Metric Calibration'}
        </button>
      </form>

      {/* Success Output */}
      {calibrationSuccess && (
        <div style={{
          marginTop: '1rem',
          background: 'rgba(6, 214, 160, 0.1)',
          border: '1px solid rgba(6, 214, 160, 0.3)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          fontSize: '0.85rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-green)', fontWeight: 600, marginBottom: '0.35rem' }}>
            <CheckCircle2 size={16} />
            Calibration Successful
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Calculated Scale Factor:</span>
            <strong style={{ color: 'var(--accent-blue)', fontFamily: 'var(--font-mono)' }}>
              {calibrationSuccess.scale_factor.toFixed(4)}x
            </strong>
          </div>
          {calibrationSuccess.georeferencing_rmse_meters !== undefined && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Georeferencing Residual RMSE:</span>
              <strong style={{ color: 'var(--accent-yellow)', fontFamily: 'var(--font-mono)' }}>
                ±{calibrationSuccess.georeferencing_rmse_meters.toFixed(2)} m
              </strong>
            </div>
          )}
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
            Grade: <span style={{ textTransform: 'uppercase', color: 'var(--text-primary)' }}>{calibrationSuccess.accuracy_grade}</span>
          </div>
        </div>
      )}
    </div>
  );
};
