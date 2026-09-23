import {
  asString,
  firstEl,
  firstHref,
  firstText,
  jsonLdType,
  parseJsonLd,
} from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, uniqueJoin } from '@/utils/text';
import { pathOf, searchParam } from '@/utils/url';
import { extractEmbeddedJob } from './embedded';

const DETAIL_PANE_SELECTORS = [
  '.scaffold-layout__detail',
  '.jobs-search__job-details--container',
  '.jobs-search__job-details',
  '.job-view-layout',
  '.jobs-details__main-content',
  '[componentkey^="JobDetails"]',
  '.jobs-semantic-search-job-details-wrapper',
  'section.two-pane-serp-page__detail-view',
];

const TITLE_SELECTORS = [
  '.job-details-jobs-unified-top-card__job-title',
  '.jobs-unified-top-card__job-title',
  '[componentkey*="JobTitle"]',
  '[componentkey*="jobTitle"]',
  'h1.t-24',
  'h2.t-24',
  'h1.job-title',
  '.top-card-layout__title',
  'a[href*="/jobs/view/"] h2',
  'a[href*="/jobs/view/"] strong',
];

const COMPANY_SELECTORS = [
  '.job-details-jobs-unified-top-card__company-name a',
  '.job-details-jobs-unified-top-card__company-name',
  '.jobs-unified-top-card__company-name a',
  '.jobs-unified-top-card__company-name',
  'a.topcard__org-name-link',
  '.topcard__org-name-link',
  'a[href*="/company/"]',
  '[componentkey*="Company"] a[href*="/company/"]',
];

const LOCATION_SELECTORS = [
  '.job-details-jobs-unified-top-card__primary-description-container',
  '.job-details-jobs-unified-top-card__tertiary-description-container',
  '.jobs-unified-top-card__primary-description',
  '.jobs-unified-top-card__bullet',
  '.job-details-jobs-unified-top-card__bullet',
  '.topcard__flavor--bullet',
  '[class*="job-details-jobs-unified-top-card__tertiary"]',
];

const DESCRIPTION_SELECTORS = [
  '[componentkey^="JobDetails_AboutTheJob"]',
  '#job-details',
  '.jobs-description__content',
  '.jobs-description-content__text',
  '.jobs-box__html-content',
  '.description__text',
  'article.jobs-description',
  '.show-more-less-html__markup',
];

const CRITERIA_SELECTORS = [
  '.job-details-fit-level-preferences',
  '.description__job-criteria-item',
  '.jobs-unified-top-card__job-insight',
  'li.job-details-jobs-unified-top-card__job-insight',
  '.job-details-jobs-unified-top-card__job-insight',
];

export function linkedinJobId(url: string): string {
  const current = searchParam(url, 'currentJobId');
  if (current) return current;
  const view = pathOf(url).match(/\/jobs\/view\/(\d+)/);
  if (view?.[1]) return view[1];
  const slug = pathOf(url).match(/-(\d+)(?:\/|$)/);
  return slug?.[1] ?? '';
}

export function extractLinkedInJob(builder: ExtractionBuilder, ctx: { url: URL; document: Document }) {
  const { document: doc, url } = ctx;
  const jobId = linkedinJobId(url.toString());
  expandCollapsed(doc);

  const pane = detailPane(doc) ?? doc;
  const jsonLd = parseJsonLd(doc).find((item) => jsonLdType(item, 'JobPosting'));
  const org =
    jsonLd && typeof jsonLd.hiringOrganization === 'object'
      ? (jsonLd.hiringOrganization as Record<string, unknown>)
      : null;
  const embedded = extractEmbeddedJob(doc, jobId);
  const card = selectedJobCard(doc, jobId);

  const rawTitle =
    firstText(pane, TITLE_SELECTORS) ||
    firstText(card ?? pane, [
      '.job-card-list__title',
      '.artdeco-entity-lockup__title',
      'strong',
    ]) ||
    embedded.title ||
    asString(jsonLd?.title) ||
    titleFromDocument(doc, jobId);
  const split = splitHeading(rawTitle);
  const cardBits = readCardLines(card);

  const title = split.title || cardBits.title || rawTitle;
  const company =
    firstText(pane, COMPANY_SELECTORS) ||
    firstText(card ?? pane, [
      '.job-card-container__primary-description',
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__company-name',
    ]) ||
    cardBits.company ||
    embedded.company ||
    asString(org?.name) ||
    split.company;

  const companyUrl =
    firstHref(pane, COMPANY_SELECTORS, url.toString()) ||
    firstHref(card ?? pane, ['a[href*="/company/"]'], url.toString()) ||
    companyHref(pane, company, url.toString()) ||
    embedded.companyUrl ||
    asString(org?.sameAs || org?.url);

  const location =
    firstText(pane, LOCATION_SELECTORS) ||
    firstText(card ?? pane, [
      '.job-card-container__metadata-item',
      '.artdeco-entity-lockup__caption',
    ]) ||
    cardBits.location ||
    embedded.location ||
    asString(
      (jsonLd?.jobLocation as Record<string, unknown> | undefined)?.address ?? jsonLd?.jobLocation,
    ) ||
    locationFromText(((pane as Element).textContent || '').slice(0, 500));

  const description = cleanJobDescription(
    firstText(pane, DESCRIPTION_SELECTORS) ||
      firstText(doc, DESCRIPTION_SELECTORS) ||
      embedded.description ||
      asString(jsonLd?.description),
    company,
  );

  const insights = uniqueJoin(
    [...pane.querySelectorAll(CRITERIA_SELECTORS.join(','))].map((el) => el.textContent),
  );

  const jobUrl = jobId ? `https://www.linkedin.com/jobs/view/${jobId}` : url.toString();

  builder
    .setType('job')
    .set('jobTitle', title)
    .set('company', company)
    .set('leadName', company || title)
    .set('companyUrl', companyUrl)
    .set('location', location)
    .set('jobDescription', description)
    .set('jobUrl', jobUrl)
    .set('sourceUrl', url.toString())
    .set('platformLeadId', jobId || jobUrl)
    .extra(
      'employmentType',
      'Employment type',
      embedded.employmentType || asString(jsonLd?.employmentType),
    )
    .extra('datePosted', 'Posting date', embedded.datePosted || asString(jsonLd?.datePosted))
    .extra(
      'workplaceType',
      'Workplace type',
      workplaceFromText(`${location} ${insights} ${embedded.workplace ?? ''}`) || embedded.workplace,
    )
    .extra('jobInsights', 'Job insights', insights);

  extractCriteria(builder, pane);
  if (!title) {
    builder.warn(
      'LinkedIn did not expose the job title in the page. Click the job in the right-hand panel, wait for it to finish loading, then click Re-extract.',
    );
  }
  return builder;
}

function detailPane(doc: Document): ParentNode | null {
  return firstEl(doc, DETAIL_PANE_SELECTORS);
}

function selectedJobCard(doc: Document, jobId: string): Element | null {
  if (!jobId) return null;
  const exact = firstEl(doc, [
    `[data-occludable-job-id="${jobId}"]`,
    `[data-job-id="${jobId}"]`,
    `li[data-occludable-job-id="${jobId}"]`,
    `a[href*="/jobs/view/${jobId}"]`,
  ]);
  if (exact) return exact.closest('li, [role="button"], article, div.job-card-container') ?? exact;

  const selected = doc.querySelector(
    '[aria-current="page"], [aria-selected="true"], [class*="job-card-container--selected"]',
  );
  return selected;
}

function titleFromDocument(doc: Document, jobId: string): string {
  const labeled = doc.querySelector(`[aria-label*="${jobId}"]`);
  const fromLabel = cleanText(labeled?.getAttribute('aria-label') || '');
  if (fromLabel && !/linkedin/i.test(fromLabel)) return fromLabel.split('|')[0]?.trim() ?? fromLabel;

  const title = cleanText(doc.title).replace(/\s*\|\s*LinkedIn.*$/i, '');
  if (!title || /jobs?\s*search|search-results/i.test(title)) return '';
  return title;
}

function expandCollapsed(doc: Document) {
  doc.querySelectorAll('button').forEach((button) => {
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`;
    if (/see more|show more|see full description/i.test(label)) {
      try {
        button.click();
      } catch {
        // Ignore buttons that cannot be clicked from the content script.
      }
    }
  });
}

function splitHeading(raw: string): { title: string; company: string } {
  const cleaned = cleanText(raw).replace(/\s*\|\s*LinkedIn.*$/i, '');
  const parts = cleaned.split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const company = parts[parts.length - 1] ?? '';
    const title = parts.slice(0, -1).join(' | ');
    if (looksLikeCompany(company)) return { title, company };
  }
  return { title: cleaned, company: '' };
}

function looksLikeCompany(value: string): boolean {
  if (!value || value.length > 80) return false;
  if (/linkedin|search-results|jobs?/i.test(value) && value.split(' ').length > 4) return false;
  return (
    /\b(inc|llc|ltd|corp|co\.|company|labs|technologies|systems|group)\b\.?/i.test(value) ||
    value.includes(',') ||
    /^[A-Z][\w.&'’ -]{1,50}$/.test(value)
  );
}

function readCardLines(card: Element | null): { title: string; company: string; location: string } {
  if (!card) return { title: '', company: '', location: '' };
  const lines = [...card.querySelectorAll('p, strong, span, a')]
    .map((el) => cleanText(el.textContent))
    .filter((text) => text && text.length < 90 && !/easy apply|promoted|viewed/i.test(text));
  const unique: string[] = [];
  for (const line of lines) {
    if (!unique.some((item) => item.toLowerCase() === line.toLowerCase())) unique.push(line);
  }
  return {
    title: unique[0] ?? '',
    company: unique[1] ?? '',
    location: unique.find((line) => locationFromText(line)) ?? unique[2] ?? '',
  };
}

function companyHref(root: ParentNode, company: string, base: string): string {
  if (!company) return '';
  const needle = company.replace(/,?\s*(inc\.?|llc|ltd\.?)$/i, '').trim().toLowerCase();
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]')];
  const match = links.find((link) => cleanText(link.textContent).toLowerCase().includes(needle));
  return match ? match.href : firstHref(root, ['a[href*="/company/"]'], base);
}

function cleanJobDescription(text: string, company: string): string {
  let out = cleanText(text).replace(/^about the job\s*/i, '');
  if (company) {
    const bare = company.replace(/,?\s*(inc\.?|llc|ltd\.?)$/i, '').trim();
    if (bare) out = out.replace(new RegExp(`^${escapeRegExp(bare)}\\s*`, 'i'), '');
  }
  return cleanText(out);
}

function locationFromText(text: string): string {
  const cleaned = cleanText(text);
  const workplace = cleaned.match(/\b(Remote|Hybrid|On-?site)\b[^\n·•|]{0,40}/i);
  const city = cleaned.match(
    /\b([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){0,2}),\s*([A-Z]{2}|[A-Z][a-zA-Z]+)(?:\s*[·•,]\s*(Remote|Hybrid|On-?site))?/,
  );
  if (city) return cleanText(city[0]);
  if (workplace) return cleanText(workplace[0]);
  return '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function workplaceFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/\bremote\b/.test(lower)) return 'Remote';
  if (/\bhybrid\b/.test(lower)) return 'Hybrid';
  if (/\bon-?site\b/.test(lower)) return 'On-site';
  return '';
}

function extractCriteria(builder: ExtractionBuilder, root: ParentNode) {
  const items = root.querySelectorAll(
    '.description__job-criteria-item, .job-details-jobs-unified-top-card__job-insight',
  );
  items.forEach((item) => {
    const label = (
      item.querySelector('.description__job-criteria-subheader')?.textContent ||
      item.textContent ||
      ''
    ).toLowerCase();
    const value =
      item.querySelector('.description__job-criteria-text')?.textContent || item.textContent || '';
    if (label.includes('seniority') || label.includes('experience')) {
      builder.extra('experienceLevel', 'Experience level', value);
    } else if (label.includes('employment')) {
      builder.extra('employmentType', 'Employment type', value);
    } else if (label.includes('function')) {
      builder.extra('jobFunction', 'Job function', value);
    } else if (label.includes('industr')) {
      builder.extra('industry', 'Industry', value);
    }
  });
}
