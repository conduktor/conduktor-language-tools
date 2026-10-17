// No imports: scripts/refresh-topic-configs.ts runs this file with Node directly.

export interface TopicConfigDoc {
  key: string;
  doc: string;
  type: string;
  default?: string;
  defaultNote?: string;
  validValues?: string;
  importance?: string;
  url: string;
}

const ENTRY = /<li><h4><a id=([^>\s]+)><\/a><a id=topicconfigs_[^\s>]+ href=[^>]+>[^<]+<\/a><\/h4>(.*?)<\/li>/gs;
const ROW = /<tr><th>([^<]+):<\/th><td>(.*?)<\/td><\/tr>/gs;

/** The topic configs of a Kafka docs page, as Kafka's ConfigDef renders them. */
export function parseKafkaTopicConfigs(html: string, url: string): TopicConfigDoc[] {
  return [...html.matchAll(ENTRY)].flatMap(([, key, body]) => {
    if (key === undefined || body === undefined) return [];
    const rows = Object.fromEntries(
      [...body.matchAll(ROW)].flatMap(([, name, value]): [string, string][] =>
        name === undefined || value === undefined ? [] : [[name, text(value)]],
      ),
    );
    // Durations and sizes carry a reading in brackets: "604800000 (7 days)".
    const [, value, note] = /^(.*?)(?: \(([^)]*)\))?$/.exec(rows.Default ?? '') ?? [];
    return {
      key,
      doc: text(/<p>(.*?)<\/p>/s.exec(body)?.[1] ?? ''),
      type: rows.Type ?? 'string',
      ...(value && { default: value }),
      ...(note && { defaultNote: note }),
      ...(rows['Valid Values'] && { validValues: rows['Valid Values'] }),
      ...(rows.Importance && { importance: rows.Importance }),
      url: `${url}#topicconfigs_${key}`,
    };
  });
}

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
