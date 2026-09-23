import { cleanText } from '@/utils/text';
import { absoluteUrl } from '@/utils/url';

export function firstEl(
  root: ParentNode,
  selectors: string[],
): Element | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // Invalid selector — skip.
    }
  }
  return null;
}

export function firstText(root: ParentNode, selectors: string[]): string {
  const el = firstEl(root, selectors);
  return cleanText(el?.textContent);
}

export function firstAttr(
  root: ParentNode,
  selectors: string[],
  attr: string,
): string {
  const el = firstEl(root, selectors);
  return cleanText(el?.getAttribute(attr));
}

export function firstHref(root: ParentNode, selectors: string[], base: string): string {
  const href = firstAttr(root, selectors, 'href');
  return href ? absoluteUrl(href, base) : '';
}

export function allText(root: ParentNode, selectors: string[]): string[] {
  const values: string[] = [];
  for (const selector of selectors) {
    try {
      root.querySelectorAll(selector).forEach((el) => {
        const text = cleanText(el.textContent);
        if (text) values.push(text);
      });
    } catch {
      // Invalid selector — skip.
    }
  }
  return values;
}

export function metaContent(doc: Document, names: string[]): string {
  for (const name of names) {
    const el =
      doc.querySelector(`meta[property="${name}"]`) ||
      doc.querySelector(`meta[name="${name}"]`);
    const content = cleanText(el?.getAttribute('content'));
    if (content) return content;
  }
  return '';
}

export function parseJsonLd(doc: Document): Record<string, unknown>[] {
  const items: Record<string, unknown>[] = [];
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const parsed = JSON.parse(script.textContent || '');
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          items.push(record);
          const graph = record['@graph'];
          if (Array.isArray(graph)) {
            for (const node of graph) {
              if (node && typeof node === 'object') {
                items.push(node as Record<string, unknown>);
              }
            }
          }
        }
      }
    } catch {
      // Ignore broken JSON-LD blocks.
    }
  });
  return items;
}

export function jsonLdType(item: Record<string, unknown>, type: string): boolean {
  const raw = item['@type'];
  if (typeof raw === 'string') return raw.toLowerCase() === type.toLowerCase();
  if (Array.isArray(raw)) {
    return raw.some((value) => String(value).toLowerCase() === type.toLowerCase());
  }
  return false;
}

export function asString(value: unknown): string {
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return asString(record.name ?? record.title ?? record.text ?? record.value);
  }
  return '';
}

export function visibleOverlap(el: Element): number {
  const rect = el.getBoundingClientRect();
  const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  if (rect.height <= 0) return 0;
  return Math.max(0, visible);
}

export function isMostlyVisible(el: Element, minPx = 120): boolean {
  return visibleOverlap(el) >= minPx;
}
