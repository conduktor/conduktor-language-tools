export function splitPolicyMessages(message: string): string[] {
  const [first = '', ...rest] = message.split('\n');
  const bulletStart = first.indexOf('- ');
  if (rest.length === 0 || bulletStart === -1 || !rest.every((line) => line.trimStart().startsWith('- '))) {
    return [message];
  }
  const heading = first.slice(0, bulletStart).trim();
  const rules = [first.slice(bulletStart), ...rest].map((line) => line.trimStart().slice(2).trim());
  return rules.map((rule) => (heading ? `${heading} ${rule}` : rule));
}
