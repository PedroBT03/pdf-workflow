#!/usr/bin/env bash
set -euo pipefail

# Build from backend directory only.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PROJECT_ROOT="$(cd "${BACKEND_DIR}/.." && pwd)"

cd "${BACKEND_DIR}"

# Activate venv if it exists
if [ -f "venv/bin/activate" ]; then
  source venv/bin/activate
fi

# Remove previous root-level runtime output.
rm -f "${PROJECT_ROOT}/pdf-workflow"
rm -rf "${PROJECT_ROOT}/_internal"

# Clean previous PyInstaller artifacts.
rm -rf dist build ./*.spec

# Build executable bundle.
pyinstaller \
  --noconfirm \
  --onedir \
  --name pdf-workflow \
  --additional-hooks-dir ../pyinstaller_hooks \
  --collect-all doclayout_yolo \
  --collect-all paddleocr \
  --collect-all pdf2data \
  --collect-all mineru \
  --collect-all docling \
  --collect-all docling_parse \
  --collect-all docling_core \
  --collect-all rapidocr \
  --collect-all pycocotools \
  --collect-all ultralytics \
  --collect-all accelerate \
  --collect-all ftfy \
  --collect-all dill \
  --collect-all omegaconf \
  --collect-all transformers \
  --collect-all torch \
  --collect-all torchvision \
  --hidden-import pycocotools \
  --hidden-import pycocotools._mask \
  --add-data "../frontend/dist:frontend/dist" \
  main.py

mv "${BACKEND_DIR}/dist/pdf-workflow/_internal" "${PROJECT_ROOT}/_internal"
chmod +x "${PROJECT_ROOT}/pdf-workflow"

# Remove non-essential build leftovers.
rm -rf "${BACKEND_DIR}/dist" "${BACKEND_DIR}/build" "${BACKEND_DIR}/"al build leftovers.
rm -rf dist build ./*.spec

echo "Build complete. Run: ${PROJECT_ROOT}/pdf-workflow"
