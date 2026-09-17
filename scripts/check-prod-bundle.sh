#!/usr/bin/env bash
# Fails if a production build still contains dev-server / HMR runtime (SPEC §12 M4).
set -euo pipefail
dir="${1:-.output/chrome-mv3}"
if grep -rlE 'localhost|ws://|virtual:wxt|reloadContentScript|/@vite/client' "$dir"; then
  echo "::error::dev/HMR runtime found in production bundle (files above)"
  exit 1
fi
echo "production bundle clean: $dir"
