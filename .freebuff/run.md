# Drone3D — Preview Run Doc

Two processes: FastAPI backend (port 5173) + Vite dev server (port 3000, proxies `/api`, `/jobs`, `/data` to the backend via `frontend/vite.config.ts`).

## Reproduce artifacts (fresh checkout)

1. No env files needed (no `.env` is required for dev; `backend/.env.example` is optional and unused by the default config).
2. Backend deps (repo root, Python 3.10+):
   ```
   python -m pip install -r backend/requirements.txt
   ```
3. Frontend deps:
   ```
   cd frontend && npm ci
   ```
4. No build step needed for dev preview. `data/samples/sample_drone.mp4` ships with the repo (it is gitignored-exempt).

## Run servers (Windows, detached)

Start the backend first from the repo root (must run from root so `backend.*` / `pipeline.*` imports resolve):

```
powershell -NoProfile -Command "(Start-Process -FilePath 'C:\Python314\python.exe' -ArgumentList '-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','5173' -WorkingDirectory 'G:\Coding\Projects\3D_drone' -RedirectStandardOutput '.freebuff\backend.log' -RedirectStandardError '.freebuff\backend.log.err' -WindowStyle Hidden -PassThru).Id"
```

Then the frontend (stderr MUST go to a different file than stdout; PowerShell rejects same-file redirects):

```
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory 'G:\Coding\Projects\3D_drone\frontend' -RedirectStandardOutput '<preview log>' -RedirectStandardError '<preview log>.err' -WindowStyle Hidden -PassThru).Id"
```

- The launcher shell may print the pid but hang the calling tool — wait and verify with `netstat -ano | findstr ":3000 :5173"` and `Get-Process -Id <pid>` instead of assuming failure.
- Preview URL: http://localhost:3000 (default port; free unless another dev server holds it — if taken, start Vite with `-- --port <free>` and register that URL).
- Confirm health: `GET http://localhost:5173/api/health` → 200 before loading the UI.
- COLMAP ships portable in `tools/colmap` (pinned 3.9.1 no-cuda; 4.2.0 crashes with 0xC0000409 on this machine). Detection is automatic via `pipeline/colmap_runner.py`; to reinstall: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup_colmap.ps1`. Real (non-mock) runs are slow on this 2-core CPU — Mock Mode stays available via the UI checkbox.
