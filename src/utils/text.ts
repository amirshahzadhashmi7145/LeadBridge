export function cleanText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function firstLine(value: string, max = 140): string {
  const line = cleanText(value).split('\n')[0] ?? '';
  if (line.length <= max) return line;
  return `${line.slice(0, max - 1)}…`;
}

export function uniqueJoin(values: Array<string | undefined | null>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out.join(', ');
}

export function hashId(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
