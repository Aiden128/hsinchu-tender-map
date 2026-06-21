#!/bin/bash
set -euo pipefail

REPO_DIR="$HOME/hsinchu-tender-map"
BUILD_DIR="$REPO_DIR/build"
WORKTREE_DIR="$REPO_DIR/.gh-pages-worktree"
TS=$(date '+%Y-%m-%d %H:%M')

cd "$REPO_DIR"
echo "=== $TS ==="

# ---- 1. Fetch ----
echo ">> Fetching tender data..."
node .github/scripts/fetch-tenders.mjs

# ---- 2. Prepare gh-pages via fresh worktree ----
rm -rf "$WORKTREE_DIR"
mkdir -p "$WORKTREE_DIR"
cd "$WORKTREE_DIR"
git init
git remote add origin https://github.com/Aiden128/hsinchu-tender-map.git

if git ls-remote --exit-code origin gh-pages >/dev/null 2>&1; then
  echo ">> Fetching existing gh-pages..."
  git fetch origin gh-pages
  git checkout gh-pages
  git rm -rf . 2>/dev/null || true
else
  echo ">> Creating new gh-pages branch..."
  git checkout --orphan gh-pages
  git rm -rf . 2>/dev/null || true
fi

# ---- 3. Copy build ----
cp -R "$BUILD_DIR"/* .

# ---- 4. Commit & push ----
git add -A
if git diff --cached --quiet; then
  echo ">> No changes, skipping commit"
else
  git commit -m "Deploy $TS"
  git push origin gh-pages
  echo ">> Pushed to gh-pages"
fi

# ---- 5. Cleanup ----
rm -rf "$WORKTREE_DIR"
echo "=== Done $TS ==="
