#!/bin/bash
set -euo pipefail

PNPM_VERSION="10.33.0"
ALLOWED_BUILD_PACKAGES=("@parcel/watcher" "@swc/core" "lmdb" "msgpackr-extract")

function configure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    PNPM_CMD=("pnpm")
    echo "✅ Using pnpm from PATH"
    return 0
  fi

  if command -v bun >/dev/null 2>&1; then
    PNPM_CMD=("bun" "x" "pnpm@${PNPM_VERSION}")
    echo "✅ Using pnpm via bun x"
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    echo "📦 pnpm not found. Installing pnpm..."
    npm install -g "pnpm@${PNPM_VERSION}"
    PNPM_CMD=("pnpm")
    echo "✅ Using pnpm installed via npm"
    return 0
  fi

  echo "❌ Error: pnpm is unavailable and no Bun or npm fallback was found." >&2
  return 1
}

function run_pnpm() {
  "${PNPM_CMD[@]}" "$@"
}

function run_local_binary() {
  local binary_name="$1"
  shift
  local binary_path="./node_modules/.bin/$binary_name"
  if [ ! -x "$binary_path" ]; then
    echo "❌ Error: Expected local binary at $binary_path" >&2
    exit 1
  fi
  "$binary_path" "$@"
}

function replay_filtered_stderr() {
  local stderr_file="$1"
  while IFS= read -r line; do
    if [[ "$line" == *"/dev/tty"* ]]; then
      continue
    fi
    echo "$line" >&2
  done < "$stderr_file"
}

function run_with_filtered_stderr() {
  local stderr_file
  stderr_file="$(mktemp)"
  if "$@" 2>"$stderr_file"; then
    replay_filtered_stderr "$stderr_file"
    rm -f "$stderr_file"
    return 0
  fi

  local status=$?
  replay_filtered_stderr "$stderr_file"
  rm -f "$stderr_file"
  return "$status"
}

function run_pnpm_quiet() {
  run_with_filtered_stderr "${PNPM_CMD[@]}" --silent "$@"
}

function run_pnpm_allow_build() {
  local allow_build_args=()
  local package_name
  for package_name in "${ALLOWED_BUILD_PACKAGES[@]}"; do
    allow_build_args+=(--allow-build="$package_name")
  done
  run_with_filtered_stderr "${PNPM_CMD[@]}" --silent "$@" "${allow_build_args[@]}"
}

function package_has_dependency() {
  local package_name="$1"
  node -e '
const fs = require("fs");
const packageName = process.argv[1];
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
process.exit(deps[packageName] ? 0 : 1);
' "$package_name"
}

function ensure_bundle_dependencies() {
  local packages=(
    "parcel"
    "@parcel/config-default"
    "parcel-resolver-tspaths"
    "html-inline"
  )

  for package_name in "${packages[@]}"; do
    if ! package_has_dependency "$package_name"; then
      echo "📦 Installing missing bundling dependencies..."
      run_pnpm_allow_build add -D parcel @parcel/config-default parcel-resolver-tspaths html-inline
      return 0
    fi
  done

  echo "✅ Reusing existing bundling dependencies"
}

declare -a PNPM_CMD
configure_pnpm

echo "📦 Bundling React app to single HTML artifact..."

# Check if we're in a project directory
if [ ! -f "package.json" ]; then
  echo "❌ Error: No package.json found. Run this script from your project root."
  exit 1
fi

# Check if index.html exists
if [ ! -f "index.html" ]; then
  echo "❌ Error: No index.html found in project root."
  echo "   This script requires an index.html entry point."
  exit 1
fi

# Install bundling dependencies only when missing
ensure_bundle_dependencies

# Create Parcel config with tspaths resolver
if [ ! -f ".parcelrc" ]; then
  echo "🔧 Creating Parcel configuration with path alias support..."
  cat > .parcelrc << 'EOF'
{
  "extends": "@parcel/config-default",
  "resolvers": ["parcel-resolver-tspaths", "..."]
}
EOF
fi

# Clean previous build
echo "🧹 Cleaning previous build..."
rm -rf dist bundle.html

# Build with Parcel
echo "🔨 Building with Parcel..."
run_with_filtered_stderr run_local_binary parcel build index.html --dist-dir dist --no-source-maps --log-level error

if [ ! -s "dist/index.html" ]; then
  echo "❌ Error: Parcel did not produce dist/index.html" >&2
  exit 1
fi

# Inline everything into single HTML
echo "🎯 Inlining all assets into single HTML file..."
run_with_filtered_stderr run_local_binary html-inline dist/index.html > bundle.html

if [ ! -s "bundle.html" ]; then
  echo "❌ Error: Bundled artifact is empty" >&2
  exit 1
fi

# Get file size
FILE_SIZE=$(du -h bundle.html | cut -f1)

echo ""
echo "✅ Bundle complete!"
echo "📄 Output: bundle.html ($FILE_SIZE)"
echo ""
echo "You can now open this single HTML file directly in a browser or share it in an artifact-capable client."
echo "To test locally: open bundle.html in your browser"
