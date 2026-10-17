const INLINE_FLAGS = /^\(\?([a-z]+)\)/;
const UNICODE_SAFE_ESCAPE = /[a-z0-9^$\\.*+?()[\]{}|/-]/i;

// Console schemas carry Java regexes; JSON Schema validators compile `pattern` as a JavaScript unicode regex.
export function toJsPattern(pattern: string): string | undefined {
  if (compiles(pattern)) return pattern;
  const flags = INLINE_FLAGS.exec(pattern)?.[1] ?? '';
  const translated = translate(pattern.replace(INLINE_FLAGS, ''), flags.includes('s'));
  return compiles(translated) ? translated : undefined;
}

function translate(pattern: string, dotAll: boolean): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern.charAt(i);
    if (char === '\\') {
      const next = pattern[i + 1] ?? '';
      out += UNICODE_SAFE_ESCAPE.test(next) ? `\\${next}` : next;
      i++;
    } else if (char === '[' && !inClass) {
      inClass = true;
      out += char;
    } else if (char === ']' && inClass) {
      inClass = false;
      out += char;
    } else if (char === '.' && dotAll && !inClass) {
      out += '[\\s\\S]';
    } else {
      out += char;
    }
  }
  return out;
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern, 'u');
    return true;
  } catch {
    return false;
  }
}
