/**
 * The word being typed when the document around `offset` (between `---` lines) holds nothing else but comments: where
 * a whole new resource can be inserted.
 */
export function blankDocumentAt(text: string, offset: number): { start: number; end: number } | undefined {
  let position = 0;
  let from = 0;
  let to = text.length;
  for (const line of text.split('\n')) {
    const end = position + line.length;
    if (/^---\s*$/.test(line)) {
      if (end < offset) from = end + 1;
      else if (position >= offset) {
        to = position;
        break;
      }
    }
    position = end + 1;
  }
  const word = /[A-Za-z0-9_-]*$/.exec(text.slice(from, offset))![0];
  const start = offset - word.length;
  const rest = text.slice(from, start) + text.slice(offset, to);
  const content = rest.split('\n').some((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  return content ? undefined : { start, end: offset };
}
