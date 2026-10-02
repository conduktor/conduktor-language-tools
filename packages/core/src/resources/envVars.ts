const ENV_VAR = /(\$\$|\$)\{([^}]+)\}/g;

export interface EnvExpansion {
  text: string;
  missing: string[];
}

export function expandEnvVars(input: string, env: Readonly<Record<string, string | undefined>>): EnvExpansion {
  const missing: string[] = [];
  const text = input.replace(ENV_VAR, (match, dollars: string, body: string) => {
    if (dollars === '$$') return match.slice(1);
    const separator = body.indexOf(':-');
    const name = separator === -1 ? body : body.slice(0, separator);
    const defaultValue = separator === -1 ? '' : body.slice(separator + 2);
    const value = env[name];
    if ((value === undefined || value === '') && defaultValue !== '') return defaultValue;
    if (value === undefined) {
      missing.push(name);
      return '';
    }
    return value;
  });
  return { text, missing };
}
