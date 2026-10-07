import { ctlArgs } from '../cli';

export const GENERATED_MARK = 'Written by Conduktor for VS Code; Set Up GitOps Repository rewrites it.';
export const CI_SCRIPTS = { plan: 'ci/plan.sh', apply: 'ci/apply.sh' } as const;

const ENV = '${env}';

/** The script a pipeline runs to plan or apply one environment: the extension's own ctl arguments, from the repo root. */
export function ciScript(action: 'plan' | 'apply'): string {
  const ctl = ctlArgs(action, ENV)
    .map((arg) => (arg.includes(ENV) ? `"${arg}"` : arg))
    .join(' ');
  const verb = action === 'plan' ? 'Plans' : 'Applies';
  return `#!/bin/sh
# ${GENERATED_MARK}
# ${verb} one environment with the Conduktor CLI: ${CI_SCRIPTS[action]} <environment>
# The Console comes from CDK_BASE_URL and CDK_API_KEY; \${VAR} values from environments/<environment>/.env if present.
set -eu
env="\${1:?usage: ${CI_SCRIPTS[action]} <environment>}"
cd "$(dirname "$0")/.."
if [ ! -d "environments/$env" ]; then
  echo "No environments/$env folder." >&2
  exit 1
fi
# Read literally, as docker --env-file does; CDK_ settings come from the caller, never the .env.
if [ -f "environments/$env/.env" ]; then
  cr=$(printf '\\r')
  while IFS= read -r line || [ -n "$line" ]; do
    line="\${line%"$cr"}"
    line="\${line#"\${line%%[![:space:]]*}"}"
    case "$line" in '#'* | '') continue ;; *=*) ;; *) continue ;; esac
    name="\${line%%=*}"
    case "$name" in [0-9]* | *[!A-Za-z0-9_]*) continue ;; CDK_SECRET_*) ;; CDK_*) continue ;; esac
    export "$name=\${line#*=}"
  done < "environments/$env/.env"
fi
exec "\${CONDUKTOR_CLI:-conduktor}" ${ctl}
`;
}
