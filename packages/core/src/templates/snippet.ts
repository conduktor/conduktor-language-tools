import { stringify } from 'yaml';
import type { JsonSchema } from '../openapi/types';
import { scalarRanges } from '../resources/yamlPaths';
import { nextChoice, type Answers } from './variants';

const TEXT = /[$}\\]/g;
const CHOICE = /[,|\\]/g;

/**
 * A skeleton as a VS Code snippet: tab stops on metadata.name, a choice for each path in `choices`, and every empty
 * quoted placeholder; everything else is escaped so it is inserted as written.
 */
export function snippetOf(text: string, choices: Readonly<Record<string, readonly string[]>>): string {
  const stops = scalarRanges(text).filter((scalar) => {
    const key = scalar.path.join('.');
    return key === 'metadata.name' || key in choices || (scalar.value === '' && scalar.quoted);
  });
  let snippet = '';
  let at = 0;
  stops.forEach((stop, i) => {
    const n = i + 1;
    snippet += text.slice(at, stop.start).replace(TEXT, '\\$&');
    // Choices and defaults are written as YAML scalars, so a name like `true` or `1e3` keeps its quotes.
    const options = (choices[stop.path.join('.')] ?? []).filter((option) => option !== '');
    if (options.length > 0)
      snippet += `\${${n}|${options.map((option) => yamlScalar(option).replace(CHOICE, '\\$&')).join(',')}|}`;
    else if (stop.quoted && stop.value === '') snippet += `"\${${n}}"`;
    else snippet += `\${${n}:${text.slice(stop.start, stop.end).replace(TEXT, '\\$&')}}`;
    at = stop.end;
  });
  return snippet + text.slice(at).replace(TEXT, '\\$&');
}

/** The variant sets worth a snippet: the default, and each option of every union directly under spec. */
export function snippetVariants(root: JsonSchema): { label?: string; answers: Answers }[] {
  const defaults = defaultAnswers(root, {});
  const labelled: { label: string; answers: Answers }[] = [];
  // A spec that is itself a union is labelled by its own types only: a nested union's label would hide which type it
  // inserts.
  const keys = 'spec' in defaults ? ['spec'] : Object.keys(defaults).filter((k) => k.split('.').length <= 2);
  for (const key of keys) {
    const choice = nextChoice(root, withoutKey(defaults, key));
    if (choice?.path.join('.') !== key) continue;
    for (const option of choice.options)
      labelled.push({
        label: key === 'spec' ? option : `${key.slice('spec.'.length)} ${option}`,
        answers: defaultAnswers(root, { [key]: option }),
      });
  }
  // The default is left out when a labelled variant already is it (a required union takes its first option).
  const same = (answers: Answers) => JSON.stringify(sorted(answers)) === JSON.stringify(sorted(defaults));
  return labelled.some((variant) => same(variant.answers)) ? labelled : [{ answers: defaults }, ...labelled];
}

function defaultAnswers(root: JsonSchema, fixed: Answers): Record<string, string | null> {
  const answers: Record<string, string | null> = { ...fixed };
  for (let c = nextChoice(root, answers); c; c = nextChoice(root, answers))
    answers[c.path.join('.')] = c.optional ? null : c.options[0];
  return answers;
}

function sorted(answers: Answers): [string, string | null][] {
  return Object.entries(answers).sort(([a], [b]) => a.localeCompare(b));
}

function yamlScalar(value: string): string {
  return stringify(value).trimEnd();
}

function withoutKey(answers: Answers, key: string): Answers {
  return Object.fromEntries(Object.entries(answers).filter(([k]) => k !== key && !k.startsWith(`${key}.`)));
}
