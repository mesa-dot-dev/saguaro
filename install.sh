#!/bin/sh
set -eu

REPO="mesa-dot-dev/saguaro"
INSTALL_DIR="${SAGUARO_INSTALL_DIR:-$HOME/.saguaro/bin}"

# Detect platform
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS" in
  darwin) OS="darwin" ;;
  linux)  OS="linux" ;;
  *)      echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)
    if [ "$OS" = "darwin" ]; then
      ARCH="arm64"
    else
      ARCH="x64"
    fi
    ;;
  aarch64|arm64)   ARCH="arm64" ;;
  *)               echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

TARGET="${OS}-${ARCH}"

# Get latest version from GitHub API
echo "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v([^"]+)".*/\1/')

if [ -z "$LATEST" ]; then
  echo "Failed to determine latest version" >&2
  exit 1
fi

TARBALL="saguaro-${LATEST}-${TARGET}.tar.gz"
URL="https://github.com/${REPO}/releases/download/v${LATEST}/${TARBALL}"

# Download and extract
DOWNLOAD_DIR=$(mktemp -d)
trap 'rm -rf "$DOWNLOAD_DIR"' EXIT

echo "Downloading Saguaro v${LATEST} for ${TARGET}..."
curl -fsSL "$URL" -o "${DOWNLOAD_DIR}/${TARBALL}"

echo "Installing to ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
tar -xzf "${DOWNLOAD_DIR}/${TARBALL}" -C "$INSTALL_DIR"

# Verify
if [ -x "${INSTALL_DIR}/sag" ]; then
  echo ""
  echo "Saguaro v${LATEST} installed to ${INSTALL_DIR}/sag"
else
  echo "Installation failed — binary not found at ${INSTALL_DIR}/sag" >&2
  exit 1
fi

# Check if on PATH
case ":$PATH:" in
  *":${INSTALL_DIR}:"*) ;;
  *)
    echo ""
    echo "Add Saguaro to your PATH by adding this to your shell profile:"
    echo ""
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    echo ""
    ;;
esac
