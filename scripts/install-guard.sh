#!/usr/bin/env bash
# Install + start the resource guard as a systemd USER service (survives reboot, linger already on).
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$HOME/.config/systemd/user"
sed "s#%h/WORKSPACE/agent-tier/scripts#$here#" "$here/systemd/at-resource-guard.service" > "$HOME/.config/systemd/user/at-resource-guard.service"
systemctl --user daemon-reload
systemctl --user enable --now at-resource-guard.service
systemctl --user --no-pager status at-resource-guard.service | head -8
echo "log: ~/.local/state/at-guard/guard.log   stop: systemctl --user disable --now at-resource-guard"
