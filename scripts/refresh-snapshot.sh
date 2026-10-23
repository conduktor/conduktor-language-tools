#!/usr/bin/env bash
# Refreshes the OpenAPI the extension bundles, from a running Console (CDK_BASE_URL), and the conduktor CLI's kind
# index the catalog test checks it against, from the CLI release the extension pins (CTL_VERSION in core).
# Usage: CDK_BASE_URL=http://localhost:8080 scripts/refresh-snapshot.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
ctl="$(sed -n "s/^export const CTL_VERSION = '\(v[0-9.]*\)';/\1/p" "$root/packages/core/src/cli/command.ts")"
[ -n "$ctl" ] || { echo "CTL_VERSION not found in packages/core/src/cli/command.ts" >&2; exit 1; }
curl -fsS "${CDK_BASE_URL:?Set CDK_BASE_URL to a running Console}/api/public/docs/docs.yaml" \
  -o "$root/packages/core/snapshot/public-api-doc.yaml"
curl -fsS "https://raw.githubusercontent.com/conduktor/ctl/$ctl/pkg/schema/default_schema/console.json" |
  jq '.Kind' > "$root/packages/core/test/fixtures/ctl-console-kinds.json"
