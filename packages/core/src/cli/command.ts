import { environmentDir, STATE_DIR } from '../sync/layout';

export type CliRunnerChoice =
  { kind: 'docker'; image: string; platform: string; uid?: number; gid?: number } | { kind: 'path'; binary: string };

export interface CliCommand {
  command: string;
  args: string[];
  /** Added to the child's environment; the caller adds CDK_API_KEY there, never to the arguments. */
  env: Record<string, string>;
  cwd: string;
}

const MOUNT = '/repo';
const LOOPBACK = /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?=[:/]|$)/i;

/**
 * The ctl command that plans or applies one environment of a sync folder: every file under environments/<env>, with
 * ctl's state kept in the folder's git-ignored .conduktor/state/<env>.json so a removed file becomes a delete. The same
 * command a pipeline runs.
 */
export function cliCommand(options: {
  action: 'plan' | 'apply';
  env: string;
  syncRoot: string;
  consoleUrl: string;
  runner: CliRunnerChoice;
  envFile?: string;
}): CliCommand {
  const { action, env, syncRoot, runner } = options;
  const state = `${STATE_DIR}/state/${env}.json`;
  const ctl = (stateFile: string) => [
    'apply',
    '-r',
    '-f',
    environmentDir(env),
    // Not --print-diff: ctl fails it for any resource the Console does not have yet, so no plan could create.
    ...(action === 'plan' ? ['--dry-run'] : []),
    '--enable-state',
    '--state-file',
    stateFile,
  ];
  if (runner.kind === 'path')
    return {
      command: runner.binary,
      args: ctl(`${syncRoot.replace(/\/+$/, '')}/${state}`),
      env: { CDK_BASE_URL: options.consoleUrl },
      cwd: syncRoot,
    };
  const linux = runner.platform === 'linux';
  return {
    command: 'docker',
    args: [
      'run',
      '--rm',
      '-v',
      `${syncRoot}:${MOUNT}`,
      '-w',
      MOUNT,
      '-e',
      'CDK_BASE_URL',
      '-e',
      'CDK_API_KEY',
      ...(options.envFile ? ['--env-file', options.envFile] : []),
      // Docker Desktop names the host itself; on Linux it has to be added, and files written as the user.
      ...(linux ? ['--add-host=host.docker.internal:host-gateway'] : []),
      ...(linux && runner.uid !== undefined ? ['--user', `${runner.uid}:${runner.gid ?? runner.uid}`] : []),
      runner.image,
      ...ctl(`${MOUNT}/${state}`),
    ],
    // Inside the container, localhost is the container.
    env: { CDK_BASE_URL: options.consoleUrl.replace(LOOPBACK, '$1host.docker.internal') },
    cwd: syncRoot,
  };
}
