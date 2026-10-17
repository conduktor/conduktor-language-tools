import { describe, expect, it } from 'vitest';
import { closest, type TextEdit } from '../src/fixes';
import { apiVersionFixes } from '../src/resources/parseDocuments';
import { referenceProblems, type NameLookup } from '../src/references/problems';
import { parsedDocuments } from '../src/resources/parsedDocuments';
import { topicConfigProblems } from '../src/topicConfigs/editor';
import { snapshotCatalog } from './fixtures';

const apply = (text: string, { start, end, newText }: TextEdit) => text.slice(0, start) + newText + text.slice(end);

const lookup = (names: string[]): NameLookup => ({
  lookup: () => Promise.resolve({ names: names.map((name) => ({ name, sources: ['console'] })), checked: true }),
  instances: () => Promise.resolve([]),
});

async function fixesOf(text: string, names: string[]) {
  const [document] = parsedDocuments(text, snapshotCatalog);
  const problems = await referenceProblems(text, document!.resource!, snapshotCatalog, 'local', lookup(names));
  return problems.flatMap((p) => p.fixes.map((fix) => ({ title: fix.title, text: apply(text, fix.edit) })));
}

describe('quick fixes', () => {
  it('offer the closest names for one that does not exist, nearest first', async () => {
    const text = 'apiVersion: v2\nkind: Topic\nmetadata:\n  name: orders\n  cluster: loacl-kafka\n';
    const fixes = await fixesOf(text, ['local-kafka', 'prod-kafka', 'local-kafka2', 'staging']);
    expect(fixes.map((f) => f.title)).toEqual(["Change to 'local-kafka'", "Change to 'local-kafka2'"]);
    expect(fixes[0]!.text).toContain('  cluster: local-kafka\n');
  });

  it("keep a name's quotes", async () => {
    const text = "apiVersion: v2\nkind: Topic\nmetadata:\n  name: orders\n  cluster: 'loacl-kafka'\n";
    expect((await fixesOf(text, ['local-kafka']))[0]!.text).toContain("  cluster: 'local-kafka'\n");
  });

  it('turn a pattern Console would read otherwise into the one it means', async () => {
    const text =
      'apiVersion: v1\nkind: ApplicationInstance\nmetadata: { name: shop-dev, application: shop }\nspec:\n  cluster: local\n  resources:\n    - type: TOPIC\n      name: "orders.*"\n      patternType: LITERAL\n    - { type: TOPIC, name: "x*" }\n';
    const fixes = await fixesOf(text, ['orders.created', 'x1']);
    expect(fixes.map((f) => f.title)).toEqual([
      "Use 'orders.' with patternType PREFIXED",
      "Use 'x' with patternType PREFIXED",
    ]);
    expect(fixes[0]!.text).toContain('      name: "orders."\n      patternType: PREFIXED\n');
    expect(fixes[1]!.text).toContain('{ type: TOPIC, name: "x", patternType: PREFIXED }');
  });

  it("offer a topic config's closest key, the values it takes, and the quotes Console needs", () => {
    const text =
      'spec:\n  configs:\n    retention.mss: "1"\n    cleanup.policy: "sometimes"\n    unclean.leader.election.enable: true\n';
    const resource = {
      spec: {
        configs: { 'retention.mss': '1', 'cleanup.policy': 'sometimes', 'unclean.leader.election.enable': true },
      },
    };
    // Each fix with the line it leaves.
    const fixes = topicConfigProblems(text, resource).flatMap((p) =>
      p.fixes.map((fix) => {
        const line = text.slice(0, fix.edit.start).split('\n').length - 1;
        return [fix.title, apply(text, fix.edit).split('\n')[line]];
      }),
    );
    expect(fixes).toEqual([
      ["Change to 'retention.ms'", '    retention.ms: "1"'],
      ["Change to 'compact'", '    cleanup.policy: "compact"'],
      ["Change to 'delete'", '    cleanup.policy: "delete"'],
      ['Quote it: "true"', '    unclean.leader.election.enable: "true"'],
    ]);
  });

  it("add a missing apiVersion, the kind's latest, to Console documents only", () => {
    const text =
      'kind: Topic\nmetadata:\n  name: a\n---\n# b\nkind: Group\n---\nkind: Deployment\n---\napiVersion: v2\nkind: Topic\n';
    const fixes = apiVersionFixes(text, snapshotCatalog);
    expect(fixes.map(({ fix }) => fix.title)).toEqual(['Add apiVersion: v2', 'Add apiVersion: v2']);
    expect(apply(text, fixes[1]!.fix.edit)).toContain('---\n# b\napiVersion: v2\nkind: Group\n');
    expect(text.slice(fixes[0]!.start, fixes[0]!.end)).toBe('kind: Topic\nmetadata:\n  name: a\n');
  });

  it('suggest only names close enough to be a typo', () => {
    expect(closest('ordres', ['orders', 'payments', 'ORDRES'])).toEqual(['ORDRES', 'orders']);
    expect(closest('a', ['b', 'abc'])).toEqual([]);
  });
});
