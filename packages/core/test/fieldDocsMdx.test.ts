import { describe, expect, it } from 'vitest';
import { headingSlug, parseReferencePage } from '../src/fieldDocs';

const page = `## ConsoleUser

Sets a user's permissions.

- **API key(s):** AdminToken  
- **Managed with:** CLI, API

\`\`\`yaml
# Grants everything
kind: User
\`\`\`

**Checks:**

- \`spec.permissions\` (optional) is a list of [permissions](#permissions) <Icon icon="up-right-from-square" />
  - See [Topic](/guide/reference/kafka-reference#topic)
- \`spec.firstName\` and \`spec.lastName\` (optional) are free text

### Kafka provider

- \`spec.kafkaFlavor.type\` must be one of [\`Confluent\`, \`Aiven\`]

## Permissions

- \`resourceType\` is not a kind's field
`;

describe('reference pages', () => {
  const url = 'https://docs.conduktor.io/guide/reference/console-reference';
  const read = () => parseReferencePage(page, 'console-reference', { ConsoleUser: 'User' });

  it('summarises a kind from the paragraph and facts under its heading', () => {
    expect(read().kinds).toEqual([
      {
        kind: 'User',
        url: `${url}#consoleuser`,
        summary: "Sets a user's permissions.",
        facts: ['**API key(s):** AdminToken', '**Managed with:** CLI, API'],
      },
    ]);
  });

  it('reads field bullets, their sub-bullets and the nearest heading, outside code fences and other sections', () => {
    expect(read().fields).toEqual([
      {
        kind: 'User',
        path: 'spec.permissions',
        text: `(optional) is a list of [permissions](${url}#permissions)\n- See [Topic](https://docs.conduktor.io/guide/reference/kafka-reference#topic)`,
        url: `${url}#consoleuser`,
        section: 'ConsoleUser',
      },
      {
        kind: 'User',
        path: 'spec.firstName',
        text: '(optional) are free text',
        url: `${url}#consoleuser`,
        section: 'ConsoleUser',
      },
      {
        kind: 'User',
        path: 'spec.lastName',
        text: '(optional) are free text',
        url: `${url}#consoleuser`,
        section: 'ConsoleUser',
      },
      {
        kind: 'User',
        path: 'spec.kafkaFlavor.type',
        text: 'must be one of [`Confluent`, `Aiven`]',
        url: `${url}#kafka-provider`,
        section: 'Kafka provider',
      },
    ]);
  });

  it('slugs headings the way the docs site does', () => {
    expect(headingSlug('Partner Zones')).toBe('partner-zones');
    expect(headingSlug('Confluent or Confluent-like Registry')).toBe('confluent-or-confluent-like-registry');
    expect(headingSlug('mTLS/client certificate')).toBe('mtlsclient-certificate');
  });

  it('starts a kind at a mapped heading of any level', () => {
    const nested =
      '## ApplicationInstance\n\nAn instance.\n\n- `spec.cluster` is a cluster\n\n### ApplicationInstancePermission\n\nA grant.\n\n- `spec.resource` is a resource\n';
    const read = parseReferencePage(nested, 'self-service-reference', {
      ApplicationInstance: 'ApplicationInstance',
      ApplicationInstancePermission: 'ApplicationInstancePermission',
    });
    expect(read.kinds.map((k) => [k.kind, k.summary])).toEqual([
      ['ApplicationInstance', 'An instance.'],
      ['ApplicationInstancePermission', 'A grant.'],
    ]);
    expect(read.fields.map((f) => [f.kind, f.path])).toEqual([
      ['ApplicationInstance', 'spec.cluster'],
      ['ApplicationInstancePermission', 'spec.resource'],
    ]);
  });

  it('reads nested field bullets as fields of their own, under the value that brings them in', () => {
    const nested = [
      '## Alerts',
      '',
      'An alert.',
      '',
      '- `spec.destination.type` can be `Slack` or `Webhook`. When set to:',
      '  - `Slack`: a channel ID',
      '  - `Webhook`:',
      '    - `spec.destination.url` has to be a valid URL',
      '- `spec.authorization.type` has to be `KAFKA_ACL` or `AIVEN_ACL`.',
      '',
      '  When set to `KAFKA_ACL`:',
      '',
      '  - `spec.acls[].host` (optional), will default to `*`.',
      '',
      '  When set to `AIVEN_ACL`:',
      '',
      '  - `spec.acls[].name` has to be a valid resource name.',
      '- `spec.targets` defines the topics:',
      '  - `cluster` is a valid Kafka cluster.',
      '',
    ].join('\n');
    const read = parseReferencePage(nested, 'console-reference', { Alerts: 'Alert' });
    const text = (path: string) => read.fields.find((f) => f.path === path)?.text;
    expect(read.fields.map((f) => f.path)).toEqual([
      'spec.destination.type',
      'spec.destination.url',
      'spec.authorization.type',
      'spec.acls[].host',
      'spec.acls[].name',
      'spec.targets',
      'spec.targets.cluster',
    ]);
    expect(text('spec.destination.url')).toBe('When `spec.destination.type` is `Webhook`: has to be a valid URL');
    expect(text('spec.acls[].host')).toBe('When `spec.authorization.type` is `KAFKA_ACL`: (optional), will default to `*`.');
    expect(text('spec.acls[].name')).toBe('When `spec.authorization.type` is `AIVEN_ACL`: has to be a valid resource name.');
    expect(text('spec.targets.cluster')).toBe('is a valid Kafka cluster.');
    expect(text('spec.destination.type')).toBe(
      'can be `Slack` or `Webhook`. When set to:\n- `Slack`: a channel ID\n- `Webhook`:\n  - `spec.destination.url` has to be a valid URL',
    );
  });
});
