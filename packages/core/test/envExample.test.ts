import { describe, expect, it } from 'vitest';
import { envExample, exampleVariables } from '../src/sync/envExample';

describe('envExample', () => {
  it('lists each variable once, sorted, without values, and leaves escaped ones out', () => {
    const text = envExample([
      'spec: { password: "${CDK_SECRET_B}", user: "${CDK_SECRET_A:-admin}" }',
      'spec: { password: "${CDK_SECRET_B}", note: "$${NOT_A_VARIABLE}" }',
    ]);
    expect(text.split('\n').filter((line) => !line.startsWith('#'))).toEqual(['CDK_SECRET_A=', 'CDK_SECRET_B=', '']);
    expect(text).toMatch(/^# .*\.env/);
  });

  it('says so when nothing is needed', () => {
    expect(envExample(['kind: Topic'])).toMatch(/^# .*no variables/);
  });

  it('reads the names back, skipping comments and anything that is not one', () => {
    const text = `${envExample(['spec: { b: "${CDK_SECRET_B}", a: "${TEAM}" }'])}not a line\n9X=\n  SPACED=\n`;
    expect(exampleVariables(text)).toEqual(['CDK_SECRET_B', 'SPACED', 'TEAM']);
  });
});
