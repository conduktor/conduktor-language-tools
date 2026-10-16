import { describe, expect, it } from 'vitest';
import { referenceProblems, type NameLookup } from '../src/references/problems';
import type { Resource } from '../src/resources/types';
import { snapshotCatalog } from './fixtures';

const lookup = (names: string[], checked = true, instances: Resource[] = []): NameLookup => ({
  lookup: async () => ({ names: names.map((name) => ({ name, sources: ['console'] })), checked }),
  instances: async () => instances,
});

const application = (owner: string): Resource => ({
  apiVersion: 'v1',
  kind: 'Application',
  metadata: { name: 'app' },
  spec: { title: 'T', owner },
});
const appText = (owner: string) =>
  `apiVersion: v1\nkind: Application\nmetadata: { name: app }\nspec: { title: T, owner: ${owner} }\n`;

const instance = (name: string, prefix: string): Resource => ({
  apiVersion: 'v1',
  kind: 'ApplicationInstance',
  metadata: { name, application: 'app' },
  spec: {
    cluster: 'local-kafka',
    resources: [
      { type: 'TOPIC', name: prefix, patternType: 'PREFIXED' },
      { type: 'TOPIC', name: 'x*', patternType: 'LITERAL' },
    ],
  },
});
const instanceText = (name: string, prefix: string) =>
  `apiVersion: v1\nkind: ApplicationInstance\nmetadata: { name: ${name}, application: app }\nspec:\n  cluster: local-kafka\n  resources:\n    - { type: TOPIC, name: ${prefix}, patternType: PREFIXED }\n    - { type: TOPIC, name: "x*", patternType: LITERAL }\n`;

describe('referenceProblems', () => {
  it('flags a name that exists neither in the repository nor on the Console, on the value', async () => {
    const text = appText('nope');
    const problems = await referenceProblems(text, application('nope'), snapshotCatalog, 'local', lookup(['core']));
    expect(problems.map((p) => [p.message, p.severity, text.slice(p.start, p.end)])).toEqual([
      ["Group 'nope' is not in the repository or on local.", 'warning', 'nope'],
    ]);
  });

  it('says nothing about a name while the Console has not answered', async () => {
    expect(
      await referenceProblems(appText('nope'), application('nope'), snapshotCatalog, 'local', lookup([], false)),
    ).toEqual([]);
  });

  it('flags pattern traps and resources another instance owns', async () => {
    const text = instanceText('b', 'shop.orders');
    const problems = await referenceProblems(
      text,
      instance('b', 'shop.orders'),
      snapshotCatalog,
      'local',
      lookup(['shop.orders.created'], true, [instance('a', 'shop.')]),
    );
    const messages = problems.map((p) => p.message);
    expect(messages).toContain('Overlaps TOPIC shop. (PREFIXED) owned by a.');
    expect(messages).toContain("Console rejects a name ending in *: use 'x' with patternType PREFIXED.");
  });
});
