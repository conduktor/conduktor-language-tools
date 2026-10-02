#!/usr/bin/env bash
set -euo pipefail
console_repo="${1:-../console}"
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/packages/core/snapshot" "$root/packages/core/test/fixtures"
cp "$console_repo/public-api-doc.yaml" "$root/packages/core/snapshot/public-api-doc.yaml"
cp "$console_repo/cliKind/v0.3.4.json" "$root/packages/core/test/fixtures/cliKind-v0.3.4.json"
git -C "$console_repo" rev-parse HEAD > "$root/packages/core/snapshot/console-commit"
