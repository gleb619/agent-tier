#!/usr/bin/env bash
# reload-at-web.sh — rebuild at-web and reload Tunnelstack AgentTier services.
#
# Rebuilds the Go at-web backend from the current agent-tier repo, regenerates
# the systemd user service files so they point at this repo, and restarts
# at-web.service + at-gateway.service.
#
# Usage: scripts/reload-at-web.sh [OPTIONS] [TUNNELSTACK_PROJECT]
#
# Arguments:
#   TUNNELSTACK_PROJECT   Path to the Tunnelstack project (default: /home/boris/tunnelstack)
#
# Options:
#   --no-build            Skip `pnpm run build:go` (expect bin/at-web to exist)
#   --dry-run             Generate service files but do not build or restart systemd units
#   --systemd-dir <dir>   Write service files here instead of ~/.config/systemd/user
#   -h, --help            Show this help
#
# Env:
#   TUNNELSTACK_PROJECT   Default Tunnelstack project path
#   SYSTEMD_USER_DIR      Default systemd user unit directory
#   AT_WEB_HOST           at-web bind host (default: 127.0.0.1)
#   AT_WEB_PORT           at-web bind port (default: 7800)
#   AT_GATEWAY_PORT       at-gateway bind port (default: 7801)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TUNNELSTACK_PROJECT="${TUNNELSTACK_PROJECT:-/home/boris/tunnelstack}"
SYSTEMD_USER_DIR="${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"
AT_WEB_HOST="${AT_WEB_HOST:-127.0.0.1}"
AT_WEB_PORT="${AT_WEB_PORT:-7800}"
AT_GATEWAY_PORT="${AT_GATEWAY_PORT:-7801}"
AT_WEB_BIN="${AT_WEB_BIN:-$ROOT/bin/at-web}"
SKIP_BUILD=0
DRY_RUN=0
MAX_WAIT_SECS=30

usage() {
  sed -n '2,21p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) SKIP_BUILD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --systemd-dir)
      if [ $# -lt 2 ]; then
        echo "reload-at-web: --systemd-dir requires an argument" >&2
        usage >&2
        exit 2
      fi
      SYSTEMD_USER_DIR="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "reload-at-web: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) TUNNELSTACK_PROJECT="$1" ;;
  esac
  shift
done

if [ ! -d "$TUNNELSTACK_PROJECT" ]; then
  echo "reload-at-web: tunnelstack project not found: $TUNNELSTACK_PROJECT" >&2
  exit 1
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] would run: pnpm run build:go"
  else
    cd "$ROOT"
    pnpm run build:go
  fi
fi

if [ ! -x "$AT_WEB_BIN" ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[dry-run] warning: at-web binary missing or not executable: $AT_WEB_BIN"
  else
    echo "reload-at-web: at-web binary missing or not executable: $AT_WEB_BIN" >&2
    exit 1
  fi
fi

mkdir -p "$SYSTEMD_USER_DIR"

web_service="$SYSTEMD_USER_DIR/at-web.service"
gateway_service="$SYSTEMD_USER_DIR/at-gateway.service"

cat > "$web_service" <<EOF
[Unit]
Description=AgentTier web backend (at-web, real filesystem, no Docker)
After=network.target
ConditionPathExists=!$TUNNELSTACK_PROJECT/.tunnelstack-paused

[Service]
Type=simple
WorkingDirectory=$ROOT
Environment=HOME=$HOME
Environment=PATH=/home/boris/.nvm/versions/node/v22.20.0/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$AT_WEB_BIN --host $AT_WEB_HOST --port $AT_WEB_PORT --static $ROOT/src/webui/dist
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

cat > "$gateway_service" <<EOF
[Unit]
Description=AgentTier /at gateway for Tunnelstack (prefix rewrite + no-2fa auth)
After=at-web.service
Wants=at-web.service
ConditionPathExists=!$TUNNELSTACK_PROJECT/.tunnelstack-paused

[Service]
Type=simple
WorkingDirectory=$TUNNELSTACK_PROJECT
ExecStart=/usr/bin/python3 $TUNNELSTACK_PROJECT/projects/agenttier/at_gateway.py --host 0.0.0.0 --port $AT_GATEWAY_PORT --upstream $AT_WEB_HOST:$AT_WEB_PORT
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] wrote $web_service"
  echo "[dry-run] wrote $gateway_service"
  echo "[dry-run] would run: systemctl --user daemon-reload"
  echo "[dry-run] would run: systemctl --user restart at-web.service at-gateway.service"
  exit 0
fi

systemctl --user daemon-reload
systemctl --user restart at-web.service at-gateway.service

for i in $(seq 1 "$MAX_WAIT_SECS"); do
  if curl -fsS "http://127.0.0.1:$AT_GATEWAY_PORT/at/" >/dev/null 2>&1; then
    echo "reload-at-web: at-gateway responding on port $AT_GATEWAY_PORT"
    exit 0
  fi
  sleep 1
done

echo "reload-at-web: at-gateway did not respond on port $AT_GATEWAY_PORT within ${MAX_WAIT_SECS}s" >&2
exit 1
