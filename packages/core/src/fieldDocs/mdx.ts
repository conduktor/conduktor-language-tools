// No imports: scripts/refresh-field-docs.ts runs this file directly through Node's type stripping.

export interface KindDoc {
  kind: string;
  url: string;
  summary: string;
  facts: string[];
}

export interface FieldDoc {
  kind: string;
  path: string;
  text: string;
  url: string;
  section: string;
}

const SITE = 'https://docs.conduktor.io';
const FIELD_PATH = /^[a-z][A-Za-z0-9]*(\[\])?(\.[A-Za-z0-9]+(\[\])?)*$/;
const FACT = /^- (\*\*(?:API key\(s\)|Managed with|Labels support):\*\*.*)$/;

// A bullet that starts with one or more backticked field paths, and the text after them.
function fieldBullet(content: string | undefined): { paths: string[]; rest: string } | undefined {
  const match = content === undefined ? null : /^((?:`[^`]+`(?:\s*(?:,|and)\s*)?)+)(.*)$/.exec(content);
  const paths = match ? [...match[1]!.matchAll(/`([^`]+)`/g)].map((found) => found[1]!) : [];
  return match && paths.every((path) => FIELD_PATH.test(path)) ? { paths, rest: match[2]! } : undefined;
}

/** The anchor the docs site gives a heading. */
export function headingSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/ /g, '-');
}

/**
 * The kinds and field bullets of a reference page. `headings` maps the headings that are kinds to their kind, at any
 * level (a kind can sit inside another's section); every other `##` section is skipped. A field links to the nearest
 * heading above it.
 */
export function parseReferencePage(
  mdx: string,
  page: string,
  headings: Readonly<Record<string, string>>,
): { kinds: KindDoc[]; fields: FieldDoc[] } {
  const pageUrl = `${SITE}/guide/reference/${page}`;
  const clean = (text: string) =>
    text
      .replace(/<Icon[^>]*\/>/g, '')
      .replace(/\]\(#/g, `](${pageUrl}#`)
      .replace(/\]\(\//g, `](${SITE}/`)
      .trim();
  const kinds: KindDoc[] = [];
  const fields: FieldDoc[] = [];
  let kind: KindDoc | undefined;
  let anchor = '';
  let section = '';
  let fence = false;
  let summary: 'waiting' | 'open' | 'done' = 'done';
  let bullet: FieldDoc[] | undefined;
  // The field bullets enclosing the current line, and the value of one of them that the following bullets apply to.
  let nested: { indent: number; path: string }[] = [];
  let condition: { indent: number; of: string; value: string } | undefined;

  for (const raw of mdx.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^\s*```/.test(line)) {
      fence = !fence;
      bullet = undefined;
      continue;
    }
    if (fence) continue;

    const heading = /^(#{2,4})\s+(.*?)\s*$/.exec(line);
    if (heading) {
      const [, hashes, title] = heading as unknown as [string, string, string];
      const name = headings[title];
      if (name || hashes.length === 2) {
        kind = name ? { kind: name, url: `${pageUrl}#${headingSlug(title)}`, summary: '', facts: [] } : undefined;
        if (kind) kinds.push(kind);
        summary = 'waiting';
      }
      anchor = `${pageUrl}#${headingSlug(title)}`;
      section = title;
      bullet = undefined;
      continue;
    }
    if (!kind) continue;

    const blank = line.trim() === '';
    const prose = !blank && !/^\s*[-<*|]/.test(line);
    if (summary === 'open') {
      if (prose) {
        kind.summary += ` ${clean(line)}`;
        continue;
      }
      summary = 'done';
    } else if (summary === 'waiting' && prose) {
      kind.summary = clean(line);
      summary = 'open';
      continue;
    }

    const fact = FACT.exec(line);
    if (fact) {
      kind.facts.push(fact[1]!.trimEnd());
      continue;
    }
    const top = fieldBullet(line.startsWith('- ') ? line.slice(2) : undefined);
    if (top) {
      const text = clean(top.rest);
      bullet = top.paths.map((path) => ({ kind: kind!.kind, path, text, url: anchor, section }));
      fields.push(...bullet);
      nested = [{ indent: 0, path: top.paths[0]! }];
      condition = undefined;
      continue;
    }
    if (bullet && /^\s/.test(line) && !blank) {
      const indent = /^\s*/.exec(line)![0].length;
      const item = /^\s+- (.*)$/.exec(line);
      while (nested.length > 1 && nested.at(-1)!.indent >= indent) nested.pop();
      if (condition && condition.indent >= indent) condition = undefined;
      const parent = nested.at(-1)!.path;
      if (!item) {
        // "When set to `X`:" introduces the bullets that follow it at its own indentation.
        const when = /^When set to `([^`]+)`:?$/.exec(line.trim());
        if (when) condition = { indent: indent - 1, of: parent, value: when[1]! };
        for (const doc of bullet) doc.text += `\n\n${clean(line)}`;
        continue;
      }
      const content = item[1]!;
      for (const doc of bullet) doc.text += `\n${'  '.repeat(Math.max(0, indent / 2 - 1))}- ${clean(content)}`;
      const child = fieldBullet(content);
      if (child) {
        const prefix = condition ? `When \`${condition.of}\` is \`${condition.value}\`: ` : '';
        for (const path of child.paths) {
          const full = /^(spec|metadata)\./.test(path) ? path : `${parent}.${path}`;
          fields.push({ kind: kind.kind, path: full, text: prefix + clean(child.rest), url: anchor, section });
        }
        nested.push({ indent, path: child.paths[0]! });
        continue;
      }
      const value = /^`([^`]+)`:/.exec(content);
      if (value) condition = { indent, of: parent, value: value[1]! };
      continue;
    }
    if (!blank && !/^\s/.test(line)) bullet = undefined;
  }
  return { kinds, fields };
}
