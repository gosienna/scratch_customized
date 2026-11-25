#!/usr/bin/env bash
# Build the UNMODIFIED official Scratch GUI at the pinned upstream release, for the Level 3 browser tests.
# It is cloned fresh from scratchfoundation/scratch-editor, never built from this repository's fork.
set -euo pipefail

TAG="${OFFICIAL_SCRATCH_TAG:-v15.3.0}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HERE/.official-gui"

if [ -f "$OUT/build/index.html" ] && [ "$(cat "$OUT/.tag" 2>/dev/null)" = "$TAG" ]; then
  echo "Official GUI $TAG already built in $OUT/build"
  exit 0
fi

rm -rf "$OUT"
git clone --depth 1 --branch "$TAG" https://github.com/scratchfoundation/scratch-editor.git "$OUT/src"
cd "$OUT/src"
# Root install scripts only set up git hooks; scratch-gui's own prepare step generates files the build needs.
npm ci --ignore-scripts
npm run prepare --workspace=packages/scratch-gui
for package in task-herder scratch-storage scratch-svg-renderer scratch-render scratch-paint scratch-vm; do
  NODE_ENV=production npm run build --workspace="packages/$package"
done
npm run build:dev --workspace=packages/scratch-gui
cp -R packages/scratch-gui/build "$OUT/build"
echo "$TAG" > "$OUT/.tag"
echo "Built official GUI $TAG in $OUT/build"
