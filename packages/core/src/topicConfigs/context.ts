export type TopicConfigContext =
  | { where: 'configKey'; start: number; end: number; present: string[] }
  | { where: 'configValue'; key: string; start: number; end: number }
  | { where: 'configKeyName'; key: string; start: number; end: number }
  | { where: 'specKey'; start: number; end: number };

interface Line {
  start: number;
  text: string;
  indent: number;
  blank: boolean;
}

/**
 * Where the cursor sits in one Topic document, read by indentation so a half-typed line still counts: a key or value in
 * `spec.configs`, an existing config key, or a key directly under `spec`.
 */
export function topicConfigContext(text: string, offset: number): TopicConfigContext | undefined {
  const lines = splitLines(text);
  const index = lines.findIndex((line) => offset >= line.start && offset <= line.start + line.text.length);
  const line = lines[index];
  if (!line) return undefined;
  const specAt = lines.findIndex((l) => /^spec:\s*(?:#.*)?$/.test(l.text));
  if (specAt === -1 || index <= specAt) return undefined;
  const specEnd = blockEnd(lines, specAt, 0);
  if (index >= specEnd) return undefined;
  const column = offset - line.start;
  const before = line.text.slice(0, column);
  const childIndent = lines.slice(specAt + 1, specEnd).find((l) => !l.blank && !comment(l))?.indent ?? 2;
  const indentation = leadingSpace(before);

  const configsAt = lines.findIndex(
    (l, i) => i > specAt && i < specEnd && l.indent === childIndent && /^\s*configs:\s*(?:#.*)?$/.test(l.text),
  );
  const inConfigs = configsAt !== -1 && index > configsAt && index < blockEnd(lines, configsAt, childIndent);
  // A blank line inside the configs block belongs to spec when the cursor sits at spec's indentation.
  if (inConfigs && indentation > childIndent) {
    const colon = line.text.indexOf(':');
    if (colon !== -1 && column > colon) {
      const valueStart = line.start + colon + 1 + leadingSpace(line.text.slice(colon + 1));
      return {
        where: 'configValue',
        key: line.text.slice(0, colon).trim(),
        start: Math.min(valueStart, offset),
        end: line.start + line.text.length,
      };
    }
    if (colon !== -1) {
      const keyStart = line.start + indentation;
      return {
        where: 'configKeyName',
        key: line.text.slice(0, colon).trim(),
        start: keyStart,
        end: line.start + colon,
      };
    }
    const word = /\S*$/.exec(before)?.[0] ?? '';
    return {
      where: 'configKey',
      start: offset - word.length,
      end: offset,
      present: presentKeys(lines, configsAt, childIndent),
    };
  }

  if (!before.includes(':') && /^\s*[a-z]*$/i.test(before) && /^\s*$/.test(line.text.slice(column))) {
    if (indentation === childIndent) {
      const word = /[a-z]*$/i.exec(before)?.[0] ?? '';
      return { where: 'specKey', start: offset - word.length, end: offset };
    }
  }
  return undefined;
}

function splitLines(text: string): Line[] {
  let start = 0;
  return text.split('\n').map((raw) => {
    const value = raw.replace(/\r$/, '');
    const line = { start, text: value, indent: leadingSpace(value), blank: value.trim() === '' };
    start += raw.length + 1;
    return line;
  });
}

// The first line after `at` indented at or above `indent` (ignoring blank and comment lines).
function blockEnd(lines: Line[], at: number, indent: number): number {
  const end = lines.findIndex((line, i) => i > at && !line.blank && !comment(line) && line.indent <= indent);
  return end === -1 ? lines.length : end;
}

function leadingSpace(text: string): number {
  return text.length - text.trimStart().length;
}

function comment(line: Line): boolean {
  return line.text.trim().startsWith('#');
}

function presentKeys(lines: Line[], configsAt: number, childIndent: number): string[] {
  const end = blockEnd(lines, configsAt, childIndent);
  return lines
    .slice(configsAt + 1, end)
    .map((line) => /^\s*([^\s:#][^:]*):/.exec(line.text)?.[1]?.trim())
    .filter((key): key is string => !!key);
}
