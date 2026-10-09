#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-}"
BUILD_DIR="$ROOT_DIR/.build"
BACKEND_TEMP_DIST="$BUILD_DIR/backend-dist"
PYINSTALLER_WORK_DIR="$BUILD_DIR/pyinstaller"
FINAL_BACKEND_DIST="$ROOT_DIR/backend-dist"
FRONTEND_DIST="$ROOT_DIR/frontend/dist"
DESKTOP_VERSION="$(node -p "require('$ROOT_DIR/electron/package.json').version")"

if [[ -x "$ROOT_DIR/backend/venv/bin/python" ]]; then
  BACKEND_PYTHON="$ROOT_DIR/backend/venv/bin/python"
elif [[ -x "$ROOT_DIR/backend/venv/Scripts/python.exe" ]]; then
  BACKEND_PYTHON="$ROOT_DIR/backend/venv/Scripts/python.exe"
else
  BACKEND_PYTHON="$ROOT_DIR/backend/venv/bin/python"
fi

if [[ -z "$TARGET" ]]; then
  echo "usage: scripts/build-electron.sh <mac|win|linux>" >&2
  exit 1
fi

if [[ ! -x "$BACKEND_PYTHON" ]]; then
  echo "backend venv python not found: $BACKEND_PYTHON" >&2
  exit 1
fi

if ! "$BACKEND_PYTHON" -m PyInstaller --version >/dev/null 2>&1; then
  echo "PyInstaller is not installed in backend/venv." >&2
  echo "Install it first with: backend/venv/bin/python -m pip install pyinstaller" >&2
  exit 1
fi

case "$TARGET" in
  mac)
    ELECTRON_SCRIPT="build:mac"
    ;;
  win)
    ELECTRON_SCRIPT="build:win"
    ;;
  linux)
    ELECTRON_SCRIPT="build:linux"
    ;;
  *)
    echo "unsupported target: $TARGET" >&2
    exit 1
    ;;
esac

DATA_SEPARATOR=":"
if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* || "$OSTYPE" == win32* ]]; then
  DATA_SEPARATOR=";"
fi

PYINSTALLER_ARGS=(
  --noconfirm
  --clean
  --onedir
  --name main
  --distpath "$BACKEND_TEMP_DIST"
  --workpath "$PYINSTALLER_WORK_DIR/work"
  --specpath "$PYINSTALLER_WORK_DIR/spec"
  --paths "$ROOT_DIR"
  --paths "$ROOT_DIR/backend"
  --collect-submodules shared
  --collect-submodules language_config
)

PYINSTALLER_DATA_PACKAGES=(
  stanza
  udtools
  udapi
  regex
  kiwipiepy
  kiwipiepy_model
)

# Keep the desktop bundle lean by excluding ML packages that are present in
# the venv but not used by the packaged backend entrypoints.
PYINSTALLER_EXCLUDES=(
  torchvision
  onnxruntime
  pandas
  scipy
  skimage
)

for module_name in "${PYINSTALLER_EXCLUDES[@]}"; do
  PYINSTALLER_ARGS+=(--exclude-module "$module_name")
done

for package_name in "${PYINSTALLER_DATA_PACKAGES[@]}"; do
  PYINSTALLER_ARGS+=(--collect-data "$package_name")
done

PYINSTALLER_ARGS+=(--hidden-import kiwipiepy_model)

OPTIONAL_DATA_DIRS=()

if ((${#OPTIONAL_DATA_DIRS[@]} > 0)); then
  for entry in "${OPTIONAL_DATA_DIRS[@]}"; do
    src_rel="${entry%%:*}"
    dest_rel="${entry##*:}"
    src_abs="$ROOT_DIR/$src_rel"

    if [[ -e "$src_abs" ]]; then
      PYINSTALLER_ARGS+=(--add-data "$src_abs${DATA_SEPARATOR}$dest_rel")
    else
      echo "Skipping missing optional path: $src_rel"
    fi
  done
fi

echo "[1/3] Building frontend web app"
node "$ROOT_DIR/scripts/sync-app-version.mjs"
(cd "$ROOT_DIR/frontend" && APP_VERSION_OVERRIDE="$DESKTOP_VERSION" npm run build)

echo "[2/3] Packaging backend into backend-dist"
rm -rf "$BACKEND_TEMP_DIST" "$PYINSTALLER_WORK_DIR" "$FINAL_BACKEND_DIST"
mkdir -p "$BACKEND_TEMP_DIST" "$PYINSTALLER_WORK_DIR" "$FINAL_BACKEND_DIST"

"$BACKEND_PYTHON" -m PyInstaller \
  "${PYINSTALLER_ARGS[@]}" \
  "$ROOT_DIR/backend/main.py"

cp -R "$BACKEND_TEMP_DIST/main/." "$FINAL_BACKEND_DIST/"
mkdir -p "$FINAL_BACKEND_DIST/frontend"
cp -R "$FRONTEND_DIST/." "$FINAL_BACKEND_DIST/frontend/"

echo "[3/3] Building Electron package for $TARGET"
(cd "$ROOT_DIR/electron" && npm run "$ELECTRON_SCRIPT")

echo "Done. Electron output is in: $ROOT_DIR/electron/dist-electron"
