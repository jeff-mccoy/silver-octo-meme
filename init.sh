#!/usr/bin/env bash
# claw init — generate the full stack from claw.yaml
#
# Usage: ./init.sh
# Prerequisites: Docker
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="$SCRIPT_DIR/generated"

echo "=== claw init ==="
echo ""

# Check for .env
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "Warning: No .env file found. Create one with at minimum:"
  echo "  ANTHROPIC_API_KEY=sk-ant-..."
  echo ""
  echo "Create $SCRIPT_DIR/.env and re-run."
  exit 1
fi

# Check for claw.yaml
if [ ! -f "$SCRIPT_DIR/claw.yaml" ]; then
  echo "Error: claw.yaml not found in $SCRIPT_DIR"
  exit 1
fi

# --- Port collision check ---
# Extract ports from claw.yaml (simple grep, works for flat YAML)
check_port() {
  local port=$1
  local name=$2
  if (echo >/dev/tcp/localhost/"$port") 2>/dev/null; then
    echo "  WARNING: Port $port ($name) is already in use!"
    return 1
  fi
  return 0
}

SYNAPSE_PORT=$(grep 'synapse:' "$SCRIPT_DIR/claw.yaml" | grep -oE '[0-9]+' | head -1)
ELEMENT_PORT=$(grep 'element:' "$SCRIPT_DIR/claw.yaml" | grep -oE '[0-9]+' | head -1)
MITMPROXY_PORT=$(grep 'mitmproxy_ui:' "$SCRIPT_DIR/claw.yaml" | grep -oE '[0-9]+' | head -1)

SYNAPSE_PORT=${SYNAPSE_PORT:-38008}
ELEMENT_PORT=${ELEMENT_PORT:-38088}
MITMPROXY_PORT=${MITMPROXY_PORT:-38081}

PORT_CONFLICT=0
check_port "$SYNAPSE_PORT" "synapse" || PORT_CONFLICT=1
check_port "$ELEMENT_PORT" "element" || PORT_CONFLICT=1
check_port "$MITMPROXY_PORT" "mitmproxy_ui" || PORT_CONFLICT=1

if [ "$PORT_CONFLICT" -eq 1 ]; then
  echo ""
  echo "  Port conflict(s) detected. Edit the ports section in claw.yaml"
  echo "  or stop the conflicting service(s), then re-run."
  echo ""
  exit 1
fi

# Build init container
echo "[1/3] Building init container..."
docker build -q -t claw-init "$SCRIPT_DIR/claw-init"

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Run generate mode
echo "[2/3] Generating stack from claw.yaml..."
docker run --rm \
  -v "$SCRIPT_DIR":/config:ro \
  -v "$OUTPUT_DIR":/output \
  claw-init generate

# Copy .env to generated dir (symlink doesn't work well with docker compose)
echo "[3/3] Linking .env..."
cp "$SCRIPT_DIR/.env" "$OUTPUT_DIR/../.env" 2>/dev/null || true

# Extract human credentials from claw.yaml
HUMAN_USER=$(grep -A5 'human:' "$SCRIPT_DIR/claw.yaml" | grep 'username:' | head -1 | sed 's/.*: *//' | tr -d '"' | tr -d "'")
HUMAN_PASS=$(grep -A5 'human:' "$SCRIPT_DIR/claw.yaml" | grep 'password:' | head -1 | sed 's/.*: *//' | tr -d '"' | tr -d "'")
HUMAN_USER=${HUMAN_USER:-user}
HUMAN_PASS=${HUMAN_PASS:-user-2026}

echo ""
echo "=== Ready! ==="
echo ""
echo "  cd $OUTPUT_DIR && docker compose up -d"
echo ""
echo "Then open Element and log in:"
echo ""
echo "  URL:         http://localhost:$ELEMENT_PORT"
echo "  Homeserver:  http://localhost:$SYNAPSE_PORT"
echo "  Username:    $HUMAN_USER"
echo "  Password:    $HUMAN_PASS"
echo ""
echo "Traffic inspector: http://localhost:$MITMPROXY_PORT"
echo ""
