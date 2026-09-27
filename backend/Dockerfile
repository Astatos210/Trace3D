FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    colmap \
    libgl1 \
    libgomp1 \
    libglu1-mesa \
    libglib2.0-0 \
    libegl1 \
    libglx-mesa0 \
    libosmesa6 \
    libgbm1 \
    mesa-utils \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Prevent Qt plugin conflicts between opencv-contrib-python's bundled Qt
# plugins and COLMAP's Qt. Without this, COLMAP can abort with messages like:
#   "Could not load the Qt platform plugin 'xcb'"
#   or plugin version mismatches triggering an abort.
ENV QT_QPA_PLATFORM=offscreen
ENV QT_QPA_PLATFORM_PLUGIN_PATH=
ENV QT_PLUGIN_PATH=

WORKDIR /app

COPY backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY pipeline/ pipeline/
COPY data/samples/ /app/data/samples/

ENV PYTHONPATH=/app
ENV DEBUG=false

# COLMAP's Qt needs XDG_RUNTIME_DIR to initialize the GL context in headless mode.
RUN mkdir -p /tmp/runtime-root && chmod 777 /tmp/runtime-root
ENV XDG_RUNTIME_DIR=/tmp/runtime-root

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "5173"]

