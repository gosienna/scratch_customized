#!/usr/bin/env bash
# Build the editor as a static site for GitHub Pages into dist-pages/.
# The playground build uses relative asset URLs, so it works under any path (e.g. /scratch_customized/).
# Optional build variables: GOOGLE_CLIENT_ID (enables Google Drive), GIT_CORS_PROXY (for pushing history).
set -euo pipefail
cd "$(dirname "$0")/.."

for package in task-herder scratch-storage scratch-svg-renderer scratch-render scratch-paint scratch-vm platform; do
  NODE_ENV=production npm run build --workspace="packages/$package"
done
rm -rf packages/scratch-gui/build
(cd packages/scratch-gui && NODE_ENV=production BUILD_TYPE=dev npx webpack)

rm -rf dist-pages
cp -R packages/scratch-gui/build dist-pages
# Only the editor is published: drop source maps and the other upstream playground pages.
find dist-pages -name '*.map' -delete
rm -f dist-pages/{blocksonly,compatibilitytesting,player,guistandalone}.js \
  dist-pages/{blocks-only,compatibility-testing,player,standalone}.html
cp dist-pages/index.html dist-pages/404.html
touch dist-pages/.nojekyll
echo "Built the site in dist-pages/ ($(du -sh dist-pages | cut -f1))"
