import { describe, expect, it } from 'vitest';
import { expandEnvVars } from '../src/resources/envVars';

describe('expandEnvVars', () => {
  it('replaces a set variable', () => {
    expect(expandEnvVars('name: ${TOPIC}', { TOPIC: 'orders' })).toEqual({ text: 'name: orders', missing: [] });
  });

  it('uses the default when the variable is unset or empty', () => {
    expect(expandEnvVars('a: ${A:-x}\nb: ${B:-y}', { B: '' }).text).toBe('a: x\nb: y');
  });

  it('keeps a set-but-empty variable without default as empty', () => {
    expect(expandEnvVars('a: "${A}"', { A: '' })).toEqual({ text: 'a: ""', missing: [] });
  });

  it('reports unset variables without default', () => {
    expect(expandEnvVars('a: ${A}\nb: ${B}', {})).toEqual({ text: 'a: \nb: ', missing: ['A', 'B'] });
  });

  it('turns $${VAR} into a literal ${VAR} for the server', () => {
    expect(expandEnvVars('expr: $${user.name}', { 'user.name': 'nope' })).toEqual({
      text: 'expr: ${user.name}',
      missing: [],
    });
  });

  it('keeps a default that contains a colon', () => {
    expect(expandEnvVars('url: ${URL:-http://localhost:8080}', {}).text).toBe('url: http://localhost:8080');
  });
});
