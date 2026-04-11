#!/bin/bash
set -euo pipefail

PNPM_VERSION="10.33.0"

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

# Install bundling dependencies
echo "📦 Installing bundling dependencies..."
run_pnpm add -D parcel @parcel/config-default parcel-resolver-tspaths html-inline

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
run_pnpm exec parcel build index.html --dist-dir dist --no-source-maps

# Inline everything into single HTML
echo "🎯 Inlining all assets into single HTML file..."
run_pnpm exec html-inline dist/index.html > bundle.html

# Get file size
FILE_SIZE=$(du -h bundle.html | cut -f1)

echo ""
echo "✅ Bundle complete!"
echo "📄 Output: bundle.html ($FILE_SIZE)"
echo ""
echo "You can now open this single HTML file directly in a browser or share it in an artifact-capable client."
echo "To test locally: open bundle.html in your browser"
