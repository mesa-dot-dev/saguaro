#!/usr/bin/env bash
set -euo pipefail

# Simulate what `brew install mesa-dot-dev/tap/code-review` does locally.
# Builds, packs, extracts, and installs deps — the result in .release/brew-simulate/
# is exactly what a Homebrew user gets.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIMULATE_DIR="$ROOT/.release/brew-simulate"
VERSION=$(node -e 'process.stdout.write(require("./package.json").version)')

echo "==> Building @mesadev/code-review v$VERSION"
cd "$ROOT"
bun run build

echo "==> Packing npm tarball"
TARBALL=$(npm pack --pack-destination "$ROOT/.release" 2>/dev/null)
TARBALL="$ROOT/.release/$TARBALL"

echo "==> Extracting to $SIMULATE_DIR"
rm -rf "$SIMULATE_DIR"
mkdir -p "$SIMULATE_DIR"
tar xzf "$TARBALL" -C "$SIMULATE_DIR"

echo "==> Installing dependencies (simulating Homebrew npm install)"
cd "$SIMULATE_DIR/package"
npm install --production 2>&1 | tail -1

echo ""
echo "==> Verifying WASM files"
WASM_OK=true
for f in \
  node_modules/web-tree-sitter/tree-sitter.wasm \
  node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm \
  node_modules/tree-sitter-wasms/out/tree-sitter-go.wasm \
  node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm \
  node_modules/tree-sitter-wasms/out/tree-sitter-java.wasm \
  node_modules/tree-sitter-wasms/out/tree-sitter-kotlin.wasm; do
  if [ -f "$f" ]; then
    echo "  OK  $f"
  else
    echo "  MISSING  $f"
    WASM_OK=false
  fi
done

if [ "$WASM_OK" = false ]; then
  echo ""
  echo "FAIL: Missing WASM files. The tree-sitter indexer will not work."
  exit 1
fi

echo ""
echo "==> Smoke tests"
MESA="$SIMULATE_DIR/package/dist/cli/bin.js"

echo "  mesa --help"
node "$MESA" --help > /dev/null
echo "  OK"

echo ""
echo "==> Simulation complete"
echo "  Version:  $VERSION"
echo "  Tarball:  $TARBALL"
echo "  Install:  $SIMULATE_DIR/package/"
echo ""
echo "  Inspect the install tree:"
echo "    ls $SIMULATE_DIR/package/"
echo "    ls $SIMULATE_DIR/package/node_modules/web-tree-sitter/"
echo "    node $SIMULATE_DIR/package/dist/cli/bin.js --help"
