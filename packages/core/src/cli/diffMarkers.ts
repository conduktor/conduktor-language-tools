const ESC = '\x1b';
// What follows an ESC: a colour code, or the start of one cut off at the end of a chunk.
const CODE = /^\[([0-9;]*)m/;
const PARTIAL = /^(\[[0-9;]*)?$/;

/**
 * ctl colours its --print-diff output, a character-level diff: red what goes, green what comes. An output panel shows
 * the escapes raw, so they become word-diff markers — `[-removed-]{+added+}` — fed chunk by chunk as ctl writes.
 */
export class DiffMarkers {
  private pending = '';
  private open: '-' | '+' | undefined;
  private run = '';

  push(chunk: string): string {
    const text = this.pending + chunk;
    this.pending = '';
    let out = '';
    let at = 0;
    while (at < text.length) {
      const escape = text.indexOf(ESC, at);
      if (escape === -1) {
        out += this.text(text.slice(at));
        break;
      }
      out += this.text(text.slice(at, escape));
      const rest = text.slice(escape + 1);
      const code = CODE.exec(rest);
      if (code) {
        out += this.colour(code[1]!);
        at = escape + 1 + code[0].length;
      } else if (PARTIAL.test(rest)) {
        this.pending = text.slice(escape);
        break;
      } else at = escape + 1;
    }
    return out;
  }

  end(): string {
    this.pending = '';
    return this.close();
  }

  private text(text: string): string {
    if (this.open === undefined) return text;
    this.run += text;
    return '';
  }

  private colour(code: string): string {
    const closed = this.close();
    if (code === '31') this.open = '-';
    if (code === '32') this.open = '+';
    return closed;
  }

  private close(): string {
    const { open } = this;
    // ctl diffs a resource the Console does not have yet against a single NUL byte.
    const run = this.run.replaceAll('\0', '');
    this.open = undefined;
    this.run = '';
    if (open === undefined || run === '') return '';
    return open === '-' ? `[-${run}-]` : `{+${run}+}`;
  }
}
