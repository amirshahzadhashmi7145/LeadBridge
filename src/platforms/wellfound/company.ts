import { firstText, metaContent } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, uniqueJoin } from '@/utils/text';
import { pathOf } from '@/utils/url';
import {
  asText,
  derefMany,
  htmlToText,
  nodesOf,
  readApollo,
  tagName,
  type ApolloNode,
  type ApolloStore,
} from './apollo';

const COMPANY_SIZES: Record<string, string> = {
  SIZE_1_10: '1-10 employees',
  SIZE_11_50: '11-50 employees',
  SIZE_51_200: '51-200 employees',
  SIZE_201_500: '201-500 employees',
  SIZE_501_1000: '501-1000 employees',
  SIZE_1001_5000: '1001-5000 employees',
  SIZE_5001_10000: '5001-10000 employees',
  SIZE_10000_PLUS: '10000+ employees',
  SIZE_10001_PLUS: '10001+ employees',
};

export function wellfoundCompanySlug(url: string): string {
  const match = pathOf(url).match(/\/company\/([^/?#]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export function companySizeLabel(value: string): string {
  if (!value) return '';
  return COMPANY_SIZES[value] || (/\bemployee/i.test(value) ? value : '');
}

export function startupFromStore(store: ApolloStore, slug: string): ApolloNode | null {
  const startups = nodesOf(store, 'Startup');
  if (slug) {
    const hit = startups.find((node) => asText(node.slug) === slug);
    if (hit) return hit;
  }
  return startups.find((node) => asText(node.highConcept) || asText(node.productDescription)) ?? startups[0] ?? null;
}

export function extractWellfoundCompany(
  builder: ExtractionBuilder,
  ctx: { url: URL; document: Document },
) {
  const { document: doc, url } = ctx;
  const store = readApollo(doc);
  const slug = wellfoundCompanySlug(url.toString());
  const startup = startupFromStore(store, slug);
  const name =
    asText(startup?.name) ||
    firstText(doc, ['h1'])?.replace(/\s+careers$/i, '') ||
    metaContent(doc, ['og:site_name']);
  const locations = uniqueJoin([
    ...derefMany(store, startup?.locationTaggings).map(tagName),
    ...[...doc.querySelectorAll('a[href*="/l/"]')].map((el) => cleanText(el.textContent)),
  ]);
  const industry = uniqueJoin(derefMany(store, startup?.marketTaggings).map(tagName));
  const size =
    companySizeLabel(asText(startup?.companySize)) ||
    firstText(doc, ['[class*="companySize"]']) ||
    sizeFromPage(doc);
  const description = [
    asText(startup?.highConcept),
    htmlToText(asText(startup?.productDescription)),
    htmlToText(asText(startup?.atGlance)),
  ]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join('\n\n');
  const about = description || metaContent(doc, ['og:description', 'description']);
  const companyUrl = slug ? `https://wellfound.com/company/${slug}` : url.toString();
  const website = asText(startup?.companyUrl) || websiteFromDom(doc);

  builder
    .setType('company')
    .set('company', name)
    .set('leadName', name)
    .set('companyUrl', companyUrl)
    .set('sourceUrl', url.toString())
    .set('jobDescription', about)
    .set('location', locations)
    .set('platformLeadId', slug || asText(startup?.id) || url.pathname)
    .extra('companyIndustry', 'Industry', industry)
    .extra('companySize', 'Company size', size)
    .extra('companyWebsite', 'Company website', website)
    .extra('funding', 'Funding', formatFunding(startup?.totalRaisedAmount));

  return builder;
}

export function formatFunding(value: unknown): string {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(amount % 1_000_000 ? 1 : 0).replace(/\.0$/, '')}M`;
  }
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(amount % 1000 ? 1 : 0).replace(/\.0$/, '')}K`;
  }
  return `$${amount}`;
}

function sizeFromPage(doc: Document): string {
  const text = cleanText(doc.body.textContent);
  return cleanText(text.match(/\b(\d+\s*-\s*\d+\s+employees|\d{1,3}\+?\s+employees)\b/i)?.[1] || '');
}

function websiteFromDom(doc: Document): string {
  const label = [...doc.querySelectorAll('button')]
    .map((el) => cleanText(el.textContent))
    .find((text) => /\./.test(text) && !/share|follow|save|apply|hide/i.test(text));
  if (!label) return '';
  return /^https?:\/\//i.test(label) ? label : `https://${label}`;
}
