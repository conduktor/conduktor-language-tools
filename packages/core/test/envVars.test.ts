import { describe, expect, it } from 'vitest';
import { expandEnvVars, referencedVariables } from '../src/resources/envVars';

describe('expandEnvVars', () => {
  it.each([
    ['replaces a set variable', 'name: ${TOPIC}', { TOPIC: 'orders' }, 'name: orders', []],
    ['uses the default when the variable is unset or empty', 'a: ${A:-x}\nb: ${B:-y}', { B: '' }, 'a: x\nb: y', []],
    ['keeps a set-but-empty variable without default as empty', 'a: "${A}"', { A: '' }, 'a: ""', []],
    ['reports unset variables without default', 'a: ${A}\nb: ${B}', {}, 'a: \nb: ', ['A', 'B']],
    [
      'turns $${VAR} into a literal ${VAR} for the server',
      'expr: $${user.name}',
      { 'user.name': 'nope' },
      'expr: ${user.name}',
      [],
    ],
    [
      'keeps a default that contains a colon',
      'url: ${URL:-http://localhost:8080}',
      {},
      'url: http://localhost:8080',
      [],
    ],
  ])('%s', (_, input, env: Record<string, string>, text, missing) => {
    expect(expandEnvVars(input, env)).toEqual({ text, missing });
  });
});

describe('referencedVariables', () => {
  it('lists the variables a file needs, once each, ignoring escaped ones', () => {
    expect(referencedVariables('a: ${A}\nb: ${B:-x}\nc: $${C}\nd: ${A}\n')).toEqual(['A', 'B']);
  });
});
