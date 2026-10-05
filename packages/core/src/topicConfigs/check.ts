import { topicConfig } from './lookup';

export interface TopicConfigProblem {
  message: string;
  severity: 'error' | 'warning';
}

/** A config value checked against Kafka's docs: its type and the valid-value forms the docs use. */
export function checkTopicConfig(key: string, value: unknown): TopicConfigProblem | undefined {
  const config = topicConfig(key);
  if (!config)
    return { message: `${key} is not a Kafka topic config (a broker may still accept it).`, severity: 'warning' };
  const error = (message: string): TopicConfigProblem => ({ message, severity: 'error' });
  // Console sends a config as a JSON long or a string; YAML booleans, decimals and numbers past 2^53 are neither.
  if (typeof value === 'boolean' || (typeof value === 'number' && !Number.isSafeInteger(value)))
    return error(`${key} must be a whole number or a string; quote it: "${String(value)}".`);
  const text = String(value).trim();
  switch (config.type) {
    case 'int':
    case 'long': {
      const limit = config.type === 'int' ? 2n ** 31n : 2n ** 63n;
      const name = config.type === 'int' ? 'an int' : 'a long';
      if (!/^-?\d+$/.test(text)) return error(`${key} is ${name} (a whole number).`);
      if (BigInt(text) >= limit || BigInt(text) < -limit) return error(`${key} is ${name}, at most ${limit - 1n}.`);
      break;
    }
    case 'double':
      if (text === '' || !Number.isFinite(Number(text))) return error(`${key} is a number.`);
      break;
    case 'boolean':
      if (text !== 'true' && text !== 'false') return error(`${key} is true or false.`);
      break;
  }
  const items =
    config.type === 'list'
      ? text
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : [text];
  for (const item of items) {
    const problem = outsideValid(key, item, config.validValues);
    if (problem) return error(problem);
  }
  return undefined;
}

// The forms Kafka's ConfigDef prints: [min,...], [min,...,max], [a, b, c], each optionally "or <value>".
function outsideValid(key: string, value: string, valid: string | undefined): string | undefined {
  if (!valid) return undefined;
  const [range, extra] = valid.split(/\s+or\s+/).map((part) => part.trim());
  if (extra !== undefined && value === extra) return undefined;
  const orExtra = extra === undefined ? '' : ` (or ${extra})`;
  const bounds = /^\[(-?[\d.]+),\.\.\.(?:,(-?[\d.]+))?\]$/.exec(range!);
  if (bounds) {
    const number = Number(value);
    if (number < Number(bounds[1])) return `${key} is at least ${bounds[1]}${orExtra}.`;
    if (bounds[2] !== undefined && number > Number(bounds[2])) return `${key} is at most ${bounds[2]}${orExtra}.`;
    return undefined;
  }
  const choices = /^\[([^\]]*)\]$/.exec(range!);
  if (choices && !choices[1]!.includes('...')) {
    const options = choices[1]!.split(',').map((option) => option.trim());
    if (!options.includes(value)) return `${key} takes ${options.join(', ')}; ${value} is not one of them.`;
  }
  return undefined;
}
