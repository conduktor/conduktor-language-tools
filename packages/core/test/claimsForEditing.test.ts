import { describe, expect, it } from 'vitest';
import { claimsForEditing } from '../src/resources/parseDocuments';
import { snapshotCatalog } from './fixtures';

const claims = (...lines: string[]) => claimsForEditing(lines.join('\n'), snapshotCatalog);

describe('claimsForEditing', () => {
  it('takes a document as soon as it names a Console kind, before its apiVersion is written', () => {
    expect(claims('kind: Topic', 'spec:', '  ')).toBe(true);
  });

  it('takes a document with a Console apiVersion', () => {
    expect(claims('apiVersion: v2', 'kind: Topic')).toBe(true);
  });

  it('takes a file where any document is a Console resource', () => {
    expect(claims('apiVersion: v1', 'kind: ConfigMap', '---', 'kind: Topic')).toBe(true);
  });

  it('leaves Kubernetes and other tools alone, even with a kind the Console also has', () => {
    expect(claims('apiVersion: v1', 'kind: ConfigMap')).toBe(false);
    expect(claims('apiVersion: v1', 'kind: ServiceAccount', 'metadata:', '  namespace: shop')).toBe(false);
    expect(claims('apiVersion: argoproj.io/v1alpha1', 'kind: Application')).toBe(false);
    expect(claims('apiVersion: kafka.strimzi.io/v1beta2', 'kind: KafkaTopic')).toBe(false);
  });

  it('leaves YAML without a Console kind alone', () => {
    expect(claims('')).toBe(false);
    expect(claims('kind: Topi')).toBe(false);
    expect(claims('name: ci', 'on: push')).toBe(false);
  });

  it('still reads the kind of a document that is half written', () => {
    expect(claims('kind: Topic', 'spec:', '  partitions: [1')).toBe(true);
  });
});
