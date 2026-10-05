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
    const field = /^- ((?:`[^`]+`(?:\s*(?:,|and)\s*)?)+)(.*)$/.exec(line);
    const paths = field ? [...field[1]!.matchAll(/`([^`]+)`/g)].map((match) => match[1]!) : [];
    if (field && paths.every((path) => FIELD_PATH.test(path))) {
      const text = clean(field[2]!);
      bullet = paths.map((path) => ({ kind: kind!.kind, path, text, url: anchor, section }));
      fields.push(...bullet);
      continue;
    }
    const sub = /^\s+- (.*)$/.exec(line);
    if (sub && bullet) {
      for (const doc of bullet) doc.text += `\n${clean(sub[1]!)}`;
      continue;
    }
    if (!blank && !/^\s/.test(line)) bullet = undefined;
  }
  return { kinds, fields };
}
