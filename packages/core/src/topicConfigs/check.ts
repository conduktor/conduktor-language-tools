import type { TopicConfigDoc } from './kafkaDocs';
import { topicConfig } from './lookup';

export interface TopicConfigProblem {
  message: string;
  severity: 'error' | 'warning';
  /** Values that would do instead, as text. */
  replacements?: string[];
}

/** A config value checked against Kafka's docs: its type and the valid-value forms the docs use. */
export function checkTopicConfig(key: string, value: unknown): TopicConfigProblem | undefined {
  const config = topicConfig(key);
  if (!config)
    return { message: `${key} is not a Kafka topic config (a broker may still accept it).`, severity: 'warning' };
  const error = (message: string, replacements?: string[]): TopicConfigProblem => ({
    message,
    severity: 'error',
    ...(replacements && { replacements }),
  });
  // Console sends a config as a JSON long or a string; YAML booleans, decimals and numbers past 2^53 are neither.
  if (typeof value === 'boolean' || (typeof value === 'number' && !Number.isSafeInteger(value)))
    return error(`${key} must be a whole number or a string; quote it: "${String(value)}".`, [String(value)]);
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
      if (text !== 'true' && text !== 'false') return error(`${key} is true or false.`, ['true', 'false']);
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
    const problem = outsideValid(key, item, config);
    // In a list, the item alone changes.
    const replacements = configChoices(config)?.map((choice) => [
      ...new Set(items.map((other) => (other === item ? choice : other))),
    ]);
    if (problem)
      return error(
        problem,
        replacements?.map((replacement) => replacement.join(',')),
      );
  }
  return undefined;
}

/** The values a config takes when Kafka lists them (`[compact, delete]`), not a range or an open list. */
export function configChoices(config: TopicConfigDoc | undefined): string[] | undefined {
  const [range = ''] = config?.validValues?.split(/\s+or\s+/) ?? [];
  const [, choices] = /^\[([^\]]*)\]$/.exec(range.trim()) ?? [];
  if (choices === undefined || choices.includes('...')) return undefined;
  return choices.split(',').map((value) => value.trim());
}

// The forms Kafka's ConfigDef prints: [min,...], [min,...,max], [a, b, c], each optionally "or <value>".
function outsideValid(key: string, value: string, config: TopicConfigDoc): string | undefined {
  if (!config.validValues) return undefined;
  const [range = '', extra] = config.validValues.split(/\s+or\s+/).map((part) => part.trim());
  if (extra !== undefined && value === extra) return undefined;
  const orExtra = extra === undefined ? '' : ` (or ${extra})`;
  const [, min, max] = /^\[(-?[\d.]+),\.\.\.(?:,(-?[\d.]+))?\]$/.exec(range) ?? [];
  if (min !== undefined) {
    const number = Number(value);
    if (number < Number(min)) return `${key} is at least ${min}${orExtra}.`;
    if (max !== undefined && number > Number(max)) return `${key} is at most ${max}${orExtra}.`;
    return undefined;
  }
  const options = configChoices(config);
  if (options && !options.includes(value)) return `${key} takes ${options.join(', ')}; ${value} is not one of them.`;
  return undefined;
}
