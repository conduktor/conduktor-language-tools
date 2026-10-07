import { referencedVariables } from '../resources/envVars';

export const ENV_EXAMPLE = '.env.example';

export function envExample(texts: readonly string[]): string {
  const names = [...new Set(texts.flatMap(referencedVariables))].sort();
  if (names.length === 0) return '# This environment references no variables.\n';
  return [
    '# The ${VAR} values this environment needs. Copy to .env and fill in; .env is never committed.',
    ...names.map((name) => `${name}=`),
    '',
  ].join('\n');
}
