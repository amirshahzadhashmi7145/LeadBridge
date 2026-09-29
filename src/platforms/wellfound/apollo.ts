import { cleanText } from '@/utils/text';

export type ApolloNode = Record<string, unknown>;
export type ApolloStore = Record<string, ApolloNode>;

export function readApollo(doc: Document): ApolloStore {
  const script = doc.querySelector('#__NEXT_DATA__');
  if (!script?.textContent) return {};
  try {
    const parsed = JSON.parse(script.textContent) as {
      props?: { pageProps?: { apolloState?: { data?: ApolloStore } } };
    };
    return parsed.props?.pageProps?.apolloState?.data ?? {};
  } catch {
    return {};
  }
}

export function nodesOf(store: ApolloStore, type: string): ApolloNode[] {
  return Object.values(store).filter((node) => node?.__typename === type);
}

export function deref(store: ApolloStore, value: unknown): ApolloNode | null {
  if (!value) return null;
  if (typeof value === 'object' && value && '__ref' in value) {
    const key = String((value as { __ref: string }).__ref);
    return store[key] ?? null;
  }
  if (typeof value === 'object') return value as ApolloNode;
  if (typeof value === 'string' && store[value]) return store[value] ?? null;
  return null;
}

export function derefMany(store: ApolloStore, value: unknown): ApolloNode[] {
  if (!Array.isArray(value)) {
    const one = deref(store, value);
    return one ? [one] : [];
  }
  return value.map((item) => deref(store, item)).filter((node): node is ApolloNode => Boolean(node));
}

export function asText(value: unknown): string {
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export function tagName(node: ApolloNode | null): string {
  if (!node) return '';
  return asText(node.displayName) || asText(node.name);
}

export function htmlToText(value: string): string {
  if (!value) return '';
  return cleanText(
    value
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>'),
  );
}
