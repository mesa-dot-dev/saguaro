#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY="$PKG_DIR/src/cli/bin/index.ts"

VERSION=$(node -e "process.stdout.write(require('$PKG_DIR/package.json').version)")
OUTDIR="${1:-$PKG_DIR/dist/bin}"

mkdir -p "$OUTDIR"

echo "Building mesa v$VERSION → $OUTDIR"

bun build "$ENTRY" --compile --minify \
  --define "__MESA_VERSION__=\"$VERSION\"" \
  --target=bun-darwin-arm64 \
  --outfile "$OUTDIR/mesa-darwin-arm64"

bun build "$ENTRY" --compile --minify \
  --define "__MESA_VERSION__=\"$VERSION\"" \
  --target=bun-darwin-x64 \
  --outfile "$OUTDIR/mesa-darwin-x64"

echo ""
echo "Built:"
ls -lh "$OUTDIR"/mesa-darwin-*
echo ""
echo "Test with: $OUTDIR/mesa-darwin-arm64 --version"
