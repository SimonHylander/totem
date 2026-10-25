#!/usr/bin/env bash
# Compile the auth design sketch. Prints nothing and exits 0 when every type claim in sketch/checks.ts holds.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
"$here/../../../protocol/node_modules/.bin/tsc" --noEmit --strict --target es2022 --module nodenext \
  --moduleResolution nodenext --skipLibCheck "$here"/sketch/*.ts
