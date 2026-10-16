import { readFileSync } from 'node:fs';
import { buildSpec } from '@conduktor/core';
import { describe, expect, it } from 'vitest';
import { claimsDocument, schemaUriFor } from '../src/schema/claim';

const spec = buildSpec(
  readFileSync(new URL('../../../packages/core/snapshot/public-api-doc.yaml', import.meta.url), 'utf8'),
  'snapshot',
);

describe('claimsDocument', () => {
  it('claims a file with a catalogued kind', () => {
    expect(claimsDocument('apiVersion: v2\nkind: Topic\nmetadata:\n  name: t\n', spec)).toBe(true);
  });

  it('claims a multi-document file when any document is a catalogued kind', () => {
    expect(claimsDocument('apiVersion: v1\nkind: ConfigMap\n---\napiVersion: v1\nkind: Application\n', spec)).toBe(
      true,
    );
  });

  it('leaves Kubernetes and other YAML alone', () => {
    expect(claimsDocument('apiVersion: apps/v1\nkind: Deployment\n', spec)).toBe(false);
    expect(claimsDocument('apiVersion: v1\nkind: ConfigMap\n', spec)).toBe(false);
    expect(claimsDocument('name: ci\non: push\n', spec)).toBe(false);
  });
});

describe('schemaUriFor', () => {
  it('changes with the spec content so the YAML extension refetches', () => {
    expect(schemaUriFor(spec)).toBe(`conduktor-schema://schema/${spec.version}.json`);
  });
});
