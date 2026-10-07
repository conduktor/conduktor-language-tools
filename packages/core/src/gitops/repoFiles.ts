import { stringify } from 'yaml';
import { CTL_VERSION } from '../cli';
import { CI_SCRIPTS, ciScript, GENERATED_MARK } from './scripts';

export interface RepoFile {
  /** Relative to the git top level, `/`-separated. */
  path: string;
  text: string;
  /** Set Up rewrites an owned file while it still carries the mark; any other existing file is the user's. */
  owned: boolean;
  executable?: boolean;
}

export interface RepoEnvironment {
  name: string;
  variables: string[];
}

const CLI_URL = `https://github.com/conduktor/ctl/releases/download/${CTL_VERSION}/conduktor-${CTL_VERSION}-linux-amd64.tar.gz`;

/**
 * The files that make a sync folder a GitOps repository: the ci/ scripts, a workflow that plans every environment on a
 * pull request and one that applies it on main, and a README. `prefix` is the sync root below the git top level ('' or
 * ending in '/').
 */
export function repoFiles(options: { environments: readonly RepoEnvironment[]; prefix: string }): RepoFile[] {
  const { environments, prefix } = options;
  return [
    { path: `${prefix}${CI_SCRIPTS.plan}`, text: ciScript('plan'), owned: true, executable: true },
    { path: `${prefix}${CI_SCRIPTS.apply}`, text: ciScript('apply'), owned: true, executable: true },
    { path: '.github/workflows/conduktor-plan.yml', text: workflow('plan', environments, prefix), owned: true },
    { path: '.github/workflows/conduktor-apply.yml', text: workflow('apply', environments, prefix), owned: true },
    { path: `${prefix}README.md`, text: readme(environments), owned: false },
  ];
}

export function fileAction(existing: string | undefined, file: RepoFile): 'write' | 'rewrite' | 'unchanged' | 'keep' {
  if (existing === undefined) return 'write';
  if (!file.owned || !existing.includes(GENERATED_MARK)) return 'keep';
  return existing === file.text ? 'unchanged' : 'rewrite';
}

function workflow(action: 'plan' | 'apply', environments: readonly RepoEnvironment[], prefix: string): string {
  const paths = [`${prefix}environments/**`, `${prefix}ci/**`];
  const on = action === 'plan' ? { pull_request: { paths } } : { push: { branches: ['main'], paths } };
  const verb = action === 'plan' ? 'Plan' : 'Apply';
  const ids = new Set<string>();
  const jobs = Object.fromEntries(
    environments.map((env) => {
      const id = uniqueId(`${action}_${env.name.replace(/[^A-Za-z0-9_-]/g, '_')}`, ids);
      return [
        id,
        {
          name: `${verb} ${env.name}`,
          'runs-on': 'ubuntu-latest',
          // A GitHub Environment of the same name holds its Console and its secrets.
          environment: env.name,
          // One apply at a time per environment: two merges in a row must not interleave.
          ...(action === 'apply' && {
            concurrency: { group: `conduktor-apply-${env.name}`, 'cancel-in-progress': false },
          }),
          env: Object.fromEntries(
            ['CDK_BASE_URL', 'CDK_API_KEY', ...env.variables.filter(secretName)].map((name) => [
              name,
              `\${{ secrets.${name} }}`,
            ]),
          ),
          ...(prefix && { defaults: { run: { 'working-directory': prefix.replace(/\/$/, '') } } }),
          steps: [
            { uses: 'actions/checkout@v4' },
            {
              name: `Install the Conduktor CLI ${CTL_VERSION}`,
              run: `curl -fsSL ${CLI_URL} | sudo tar -xz -C /usr/local/bin conduktor`,
            },
            { name: `${verb} ${env.name}`, run: `sh ${CI_SCRIPTS[action]} '${env.name}'` },
          ],
        },
      ];
    }),
  );
  const body = stringify({ name: `Conduktor ${action}`, on, jobs }, { lineWidth: 0 });
  return `# ${GENERATED_MARK}\n${body}`;
}

// GitHub refuses secrets named GITHUB_*, and the Console and token are set by name already; other CDK_ settings would
// change how ctl runs, so only CDK_SECRET_ ones are passed, as the extension does.
function secretName(name: string): boolean {
  if (name.startsWith('GITHUB_') || name === 'CDK_BASE_URL' || name === 'CDK_API_KEY') return false;
  return !name.startsWith('CDK_') || name.startsWith('CDK_SECRET_');
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

function readme(environments: readonly RepoEnvironment[]): string {
  const names = environments.map((env) => `\`${env.name}\``).join(', ');
  return `# Conduktor resources

The Console resources of ${names}, as files: this repository is their source of truth. Changes go through pull
requests; merging one into \`main\` applies it.

## Layout

\`\`\`
conduktor.yaml                                 environments and the kinds each one manages
environments/<env>/global/<group>/<kind>/<name>.yaml
environments/<env>/clusters/<cluster>/<group>/<kind>/[<connectCluster>/]<name>.yaml
environments/<env>/.env.example                every \${VAR} the environment needs, without values
ci/plan.sh, ci/apply.sh                        what the pipelines run
.github/workflows/                             plan on pull requests, apply on merge to main
\`\`\`

## Plan and apply

From VS Code, with the Conduktor extension: **Plan Environment with CLI** and **Apply Environment with CLI**.

From a shell, with the [Conduktor CLI](https://github.com/conduktor/ctl) installed and \`CDK_BASE_URL\` and
\`CDK_API_KEY\` set: \`ci/plan.sh <env>\`, then \`ci/apply.sh <env>\`. Values for \`\${VAR}\` placeholders come from
\`environments/<env>/.env\` (never committed; copy \`.env.example\`).

Removing a file deletes nothing on the Console. Delete the resource on the Console, then remove its file.

## Pipelines

The workflows need a Console that GitHub's runners can reach. For each environment, create a GitHub Environment of the
same name with the secrets \`CDK_BASE_URL\`, \`CDK_API_KEY\` and each variable listed in its \`.env.example\`.
`;
}
