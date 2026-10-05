// Regenerates packages/core/snapshot/field-docs.json from a conduktor-docs checkout (the repository is private):
// `node scripts/refresh-field-docs.ts <conduktor-docs checkout> [ref]`. The pages are read at the ref (default
// origin/main) with `git show`, so the checkout's own branch and working tree are left alone.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseReferencePage, type FieldDoc, type KindDoc } from '../packages/core/src/fieldDocs/mdx.ts';

const HEADINGS: Record<string, Record<string, string>> = {
  'console-reference': {
    ConsoleGroup: 'Group',
    ConsoleUser: 'User',
    KafkaCluster: 'KafkaCluster',
    KafkaConnectCluster: 'KafkaConnectCluster',
    KsqlDBCluster: 'KsqlDBCluster',
    Integrations: 'Integration',
    Alerts: 'Alert',
    'Partner Zones': 'PartnerZone',
    DataQualityRule: 'DataQualityRule',
    DataQualityPolicy: 'DataQualityPolicy',
  },
  'kafka-reference': {
    Topic: 'Topic',
    Subject: 'Subject',
    GlueSchema: 'GlueSchema',
    Connector: 'Connector',
    'Service account': 'ServiceAccount',
  },
  'self-service-reference': {
    Application: 'Application',
    ApplicationInstance: 'ApplicationInstance',
    ApplicationInstancePermission: 'ApplicationInstancePermission',
    ApplicationGroup: 'ApplicationGroup',
    ResourcePolicy: 'ResourcePolicy',
    TopicPolicy: 'TopicPolicy',
    TopicTemplate: 'TopicTemplate',
    ConnectorTemplate: 'ConnectorTemplate',
    ApplicationGroupTemplate: 'ApplicationGroupTemplate',
  },
};

const [checkout, ref = 'origin/main'] = process.argv.slice(2);
if (!checkout) throw new Error('Usage: node scripts/refresh-field-docs.ts <conduktor-docs checkout> [ref]');
const git = (...args: string[]) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' });

const kinds: KindDoc[] = [];
const fields: FieldDoc[] = [];
for (const [page, headings] of Object.entries(HEADINGS)) {
  const read = parseReferencePage(git('show', `${ref}:guide/reference/${page}.mdx`), page, headings);
  const missing = Object.values(headings).filter((kind) => !read.kinds.some((doc) => doc.kind === kind));
  if (missing.length > 0) throw new Error(`${page}: no section for ${missing.join(', ')}`);
  kinds.push(...read.kinds);
  fields.push(...read.fields);
}
if (fields.length < 100) throw new Error(`Only ${fields.length} field bullets read; has the page layout changed?`);

const byKind = (a: { kind: string }, b: { kind: string }) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
const snapshot = {
  source: 'conduktor-docs guide/reference',
  commit: git('rev-parse', '--short', ref).trim(),
  kinds: kinds.sort(byKind),
  fields: fields.sort(byKind),
};
writeFileSync('packages/core/snapshot/field-docs.json', `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`${kinds.length} kinds, ${fields.length} fields from ${snapshot.commit}`);
