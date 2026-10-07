import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { CTL_VERSION } from '../src/cli';
import { ciScript, fileAction, GENERATED_MARK, repoFiles } from '../src/gitops';

interface Job {
  environment: string;
  env: Record<string, string>;
  steps: { run?: string; uses?: string }[];
  concurrency?: unknown;
  defaults?: { run: { 'working-directory': string } };
}

const envs = [
  { name: 'dev', variables: ['TEAM'] },
  { name: 'team.a', variables: ['GITHUB_TOKEN', 'CDK_SECRET_PW', 'CDK_DEBUG'] },
  { name: 'team_a', variables: [] },
  { name: '9x', variables: [] },
];
const byPath = (prefix = '') => new Map(repoFiles({ environments: envs, prefix }).map((f) => [f.path, f]));
const workflow = (files: ReturnType<typeof byPath>, name: string) =>
  parse(files.get(`.github/workflows/${name}.yml`)!.text) as {
    on: Record<string, unknown>;
    jobs: Record<string, Job>;
  };
const jobFor = (jobs: Record<string, Job>, env: string) => Object.values(jobs).find((job) => job.environment === env)!;

describe('repoFiles', () => {
  it('plans on pull requests and applies on main, one job per environment with its own secrets', () => {
    const files = byPath();
    const plan = workflow(files, 'conduktor-plan');
    const apply = workflow(files, 'conduktor-apply');
    expect(plan.on).toEqual({ pull_request: { paths: ['environments/**', 'ci/**'] } });
    expect(apply.on).toEqual({ push: { branches: ['main'], paths: ['environments/**', 'ci/**'] } });
    const ids = Object.keys(plan.jobs);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_-]*$/);
    const dev = jobFor(plan.jobs, 'dev');
    expect(dev.env).toEqual({
      CDK_BASE_URL: '${{ secrets.CDK_BASE_URL }}',
      CDK_API_KEY: '${{ secrets.CDK_API_KEY }}',
      TEAM: '${{ secrets.TEAM }}',
    });
    expect(dev.steps.at(-1)!.run).toBe("sh ci/plan.sh 'dev'");
    expect(dev.defaults).toBeUndefined();
    expect(JSON.stringify(dev.steps)).toContain(
      `releases/download/${CTL_VERSION}/conduktor-${CTL_VERSION}-linux-amd64.tar.gz`,
    );
    expect(Object.keys(jobFor(plan.jobs, 'team.a').env)).toEqual(['CDK_BASE_URL', 'CDK_API_KEY', 'CDK_SECRET_PW']);
    expect(jobFor(apply.jobs, 'dev').concurrency).toEqual({
      group: 'conduktor-apply-dev',
      'cancel-in-progress': false,
    });
    expect(jobFor(apply.jobs, 'dev').steps.at(-1)!.run).toBe("sh ci/apply.sh 'dev'");
    expect(files.get('.github/workflows/conduktor-plan.yml')!.text.startsWith(`# ${GENERATED_MARK}\n`)).toBe(true);
    expect(files.get('ci/plan.sh')).toMatchObject({ text: ciScript('plan'), owned: true, executable: true });
    expect(files.get('ci/apply.sh')).toMatchObject({ text: ciScript('apply'), owned: true, executable: true });
    expect(files.get('README.md')!.owned).toBe(false);
  });

  it('runs in the sync root when it sits below the repository top level', () => {
    const files = byPath('gitops/');
    expect(files.has('gitops/ci/apply.sh')).toBe(true);
    expect(files.has('gitops/README.md')).toBe(true);
    const plan = workflow(files, 'conduktor-plan');
    expect(plan.on).toEqual({ pull_request: { paths: ['gitops/environments/**', 'gitops/ci/**'] } });
    for (const job of Object.values(plan.jobs)) expect(job.defaults!.run['working-directory']).toBe('gitops');
  });
});

describe('fileAction', () => {
  const owned = { path: 'ci/plan.sh', text: `# ${GENERATED_MARK}\nnew\n`, owned: true };
  it('writes what is missing, rewrites its own, keeps everything else', () => {
    expect(fileAction(undefined, owned)).toBe('write');
    expect(fileAction(owned.text, owned)).toBe('unchanged');
    expect(fileAction(`# ${GENERATED_MARK}\nold\n`, owned)).toBe('rewrite');
    expect(fileAction('#!/bin/sh\nmine\n', owned)).toBe('keep');
    expect(fileAction('# Our repo\n', { path: 'README.md', text: 'x', owned: false })).toBe('keep');
    expect(fileAction('x', { path: 'README.md', text: 'x', owned: false })).toBe('unchanged');
  });
});
