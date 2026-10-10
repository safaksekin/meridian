#!/bin/sh
# Builds the site and publishes dist/ to the gh-pages branch (GitHub Pages).
set -e
cd "$(dirname "$0")/.."
npm run build
touch dist/.nojekyll
REMOTE=$(git remote get-url origin)
cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.name="$(git -C .. config user.name || echo deploy)" -c user.email="$(git -C .. config user.email || echo deploy@localhost)" commit -qm "Deploy $(git -C .. rev-parse --short HEAD)"
git push -q -f "$REMOTE" gh-pages
rm -rf .git
echo "Published to gh-pages"
