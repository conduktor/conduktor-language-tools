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
const FIELD_PATH = /^[a-z][A-Za-z0-9]*(?:\[\])?(?:\.[A-Za-z0-9]+(?:\[\])?)*$/;
const FACT = /^- (\*\*(?:API key\(s\)|Managed with|Labels support):\*\*.*)$/;
const HEADING = /^#{2,4}(?=\s)/;
// Backticked field paths, each with the comma or "and" before the next.
const LEADING_PATHS = /^(?:`[^`]+`(?:\s*(?:,|and)\s*)?)+/;
// One line as `.*$` reads it: no stray \r, U+2028 or U+2029 inside.
const ONE_LINE = /^.*$/;

type FieldPaths = [string, ...string[]];

// A bullet that starts with one or more backticked field paths, and the text after them.
function fieldBullet(content: string | undefined): { paths: FieldPaths; rest: string } | undefined {
  if (content === undefined) return undefined;
  const lead = LEADING_PATHS.exec(content)?.[0] ?? '';
  const rest = content.slice(lead.length);
  const [first, ...others] = (lead.match(/`[^`]+`/g) ?? []).map((quoted) => quoted.slice(1, -1));
  if (first === undefined || !ONE_LINE.test(rest)) return undefined;
  const paths: FieldPaths = [first, ...others];
  return paths.every((path) => FIELD_PATH.test(path)) ? { paths, rest } : undefined;
}

// A `##` to `####` heading: its level and its one-line text.
function headingOf(line: string): { level: number; title: string } | undefined {
  const hashes = HEADING.exec(line)?.[0];
  if (hashes === undefined) return undefined;
  const title = line.slice(hashes.length).trim();
  return ONE_LINE.test(title) ? { level: hashes.length, title } : undefined;
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
  // The top-level field bullet: its docs, and the first path its sub-bullets belong to.
  let bullet: { docs: FieldDoc[]; path: string } | undefined;
  // The nested field bullets enclosing the current line, and the value of one of them that the following bullets
  // apply to.
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

    const heading = headingOf(line);
    if (heading) {
      const { level, title } = heading;
      const name = headings[title];
      if (name || level === 2) {
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

    const [, fact] = FACT.exec(line) ?? [];
    if (fact !== undefined) {
      kind.facts.push(fact.trimEnd());
      continue;
    }
    const top = fieldBullet(line.startsWith('- ') ? line.slice(2) : undefined);
    if (top) {
      const { kind: name } = kind;
      const text = clean(top.rest);
      const docs = top.paths.map((path) => ({ kind: name, path, text, url: anchor, section }));
      bullet = { docs, path: top.paths[0] };
      fields.push(...docs);
      nested = [];
      condition = undefined;
      continue;
    }
    if (bullet && /^\s/.test(line) && !blank) {
      const indent = line.length - line.trimStart().length;
      const [, content] = /^\s+- (.*)$/.exec(line) ?? [];
      // Nested bullets are pushed deeper and deeper, so the ones that still enclose this line are a prefix.
      nested = nested.filter((enclosing) => enclosing.indent < indent);
      if (condition && condition.indent >= indent) condition = undefined;
      const parent = nested.at(-1)?.path ?? bullet.path;
      if (content === undefined) {
        // "When set to `X`:" introduces the bullets that follow it at its own indentation.
        const [, value] = /^When set to `([^`]+)`:?$/.exec(line.trim()) ?? [];
        if (value !== undefined) condition = { indent: indent - 1, of: parent, value };
        for (const doc of bullet.docs) doc.text += `\n\n${clean(line)}`;
        continue;
      }
      for (const doc of bullet.docs) doc.text += `\n${'  '.repeat(Math.max(0, indent / 2 - 1))}- ${clean(content)}`;
      const child = fieldBullet(content);
      if (child) {
        const prefix = condition ? `When \`${condition.of}\` is \`${condition.value}\`: ` : '';
        for (const path of child.paths) {
          const full = /^(?:spec|metadata)\./.test(path) ? path : `${parent}.${path}`;
          fields.push({ kind: kind.kind, path: full, text: prefix + clean(child.rest), url: anchor, section });
        }
        nested.push({ indent, path: child.paths[0] });
        continue;
      }
      const [, value] = /^`([^`]+)`:/.exec(content) ?? [];
      if (value !== undefined) condition = { indent, of: parent, value };
      continue;
    }
    if (!blank && !/^\s/.test(line)) bullet = undefined;
  }
  return { kinds, fields };
}
