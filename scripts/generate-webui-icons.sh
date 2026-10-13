#!/usr/bin/env bash
# Generate PWA icon PNGs from SVG source files in src/webui/public.
# Commits the SVG sources and generated PNGs; this script makes PNGs reproducible.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v convert >/dev/null 2>&1; then
  echo "error: ImageMagick 'convert' is required to generate PNG icons" >&2
  exit 1
fi

PUBLIC="src/webui/public"
mkdir -p "$PUBLIC"

render() {
  local src="$1" size="$2" out="$3"
  convert -background none "$src" -resize "${size}x${size}" "$out"
  echo "generated $out (${size}x${size})"
}

render "$PUBLIC/icon.svg"            192 "$PUBLIC/icon-192.png"
render "$PUBLIC/icon.svg"            512 "$PUBLIC/icon-512.png"
render "$PUBLIC/icon-maskable.svg"   192 "$PUBLIC/icon-maskable-192.png"
render "$PUBLIC/icon-maskable.svg"   512 "$PUBLIC/icon-maskable-512.png"
render "$PUBLIC/icon.svg"            180 "$PUBLIC/apple-touch-icon.png"
render "$PUBLIC/icon.svg"             32 "$PUBLIC/favicon-32x32.png"
