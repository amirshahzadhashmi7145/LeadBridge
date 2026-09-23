import {
  asString,
  firstEl,
  firstHref,
  firstText,
  jsonLdType,
  parseJsonLd,
} from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { cleanText, flattenLines, uniqueJoin } from '@/utils/text';
import { pathOf, searchParam } from '@/utils/url';
import { extractEmbeddedJob } from './embedded';
import { locationFromBlob, parseVisibleJobMeta, type VisibleJobMeta } from './jobMeta';
import { waitForLinkedInJobReady } from './ready';
import { extractSduiJob } from './sdui';

const DETAIL_PANE_SELECTORS = [
  '[data-sdui-screen*="SemanticJobDetails"]',
  '[data-sdui-screen*="JobDetails"]',
  '.scaffold-layout__detail',
  '.jobs-search__job-details--container',
  '.jobs-search__job-details',
  '.job-view-layout',
  '.jobs-details__main-content',
  '.jobs-semantic-search-job-details-wrapper',
  'section.two-pane-serp-page__detail-view',
  '[componentkey="JobDetails"]',
  '[componentkey^="JobDetails"]:not([componentkey*="About"])',
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
  '[id^="JobDetails_AboutTheJob"]',
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

export async function extractLinkedInJob(
  builder: ExtractionBuilder,
  ctx: { url: URL; document: Document },
  options?: { skipWait?: boolean },
) {
  const { document: doc, url } = ctx;
  const jobId = linkedinJobId(url.toString());
  if (!options?.skipWait) await waitForLinkedInJobReady(doc, jobId);
  expandCollapsed(doc);

  const sdui = extractSduiJob(doc, jobId);
  const pane = detailPane(doc) ?? doc;
  const jsonLd = parseJsonLd(doc).find((item) => jsonLdType(item, 'JobPosting'));
  const org =
    jsonLd && typeof jsonLd.hiringOrganization === 'object'
      ? (jsonLd.hiringOrganization as Record<string, unknown>)
      : null;
  const embedded = extractEmbeddedJob(doc, jobId);
  const card = selectedJobCard(doc, jobId);

  const rawTitle =
    sdui.title ||
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
    cleanCompanyName(sdui.company) ||
    cleanCompanyName(firstCompanyName(pane, COMPANY_SELECTORS)) ||
    cleanCompanyName(
      firstCompanyName(card ?? pane, [
        '.job-card-container__primary-description',
        '.artdeco-entity-lockup__subtitle',
        '.job-card-container__company-name',
      ]),
    ) ||
    cleanCompanyName(cardBits.company) ||
    cleanCompanyName(embedded.company) ||
    cleanCompanyName(asString(org?.name)) ||
    cleanCompanyName(split.company);

  const facts = headerFacts(pane);
  const visible = mergeMeta(sdui.meta, parseVisibleJobMeta(doc, pane, title));
  const rawCompanyUrl =
    sdui.companyUrl ||
    firstHref(pane, COMPANY_SELECTORS, url.toString()) ||
    firstHref(card ?? pane, ['a[href*="/company/"]', 'a[href*="/school/"]'], url.toString()) ||
    companyHref(pane, company, url.toString()) ||
    companyHref(doc, company, url.toString()) ||
    embedded.companyUrl ||
    asString(org?.sameAs || org?.url) ||
    guessedCompanyUrl(company);
  const companyUrl = normalizeCompanyUrl(rawCompanyUrl);

  const location = firstRealLocation(
    sdui.meta?.location,
    visible.location,
    facts.location,
    firstText(pane, LOCATION_SELECTORS),
    embedded.location,
    asString(
      (jsonLd?.jobLocation as Record<string, unknown> | undefined)?.address ?? jsonLd?.jobLocation,
    ),
  );

  const description = cleanJobDescription(
    sdui.description ||
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
      visible.employmentType || embedded.employmentType || asString(jsonLd?.employmentType),
    )
    .extra(
      'datePosted',
      'Posting date',
      visible.posted || facts.posted || embedded.datePosted || asString(jsonLd?.datePosted),
    )
    .extra(
      'workplaceType',
      'Workplace type',
      visible.workplace ||
        facts.workplace ||
        workplaceFromText(`${location} ${insights} ${embedded.workplace ?? ''}`) ||
        embedded.workplace,
    )
    .extra(
      'jobInsights',
      'Job insights',
      uniqueJoin([
        insights,
        visible.applicants,
        visible.applicantTotal ? `${visible.applicantTotal} total applicants` : '',
        visible.applicantsPastDay ? `${visible.applicantsPastDay} applied in the past day` : '',
        visible.offLinkedIn,
      ]),
    )
    .extra('companyIndustry', 'Industry', visible.companyIndustry)
    .extra('companySize', 'Company size', visible.companySize)
    .extra('companyWebsite', 'Company website', visible.companyWebsite)
    .extra('companyFollowers', 'Company followers', visible.companyFollowers)
    .extra('linkedInHeadcount', 'Employees on LinkedIn', visible.linkedInHeadcount)
    .extra('candidateSeniority', 'Candidate seniority', visible.seniorityMix)
    .extra('candidateEducation', 'Candidate education', visible.educationMix)
    .extra('hiringTrend', 'Hiring trend', visible.hiringTrend)
    .extra('employeeTenure', 'Median employee tenure', visible.employeeTenure);

  extractCriteria(builder, pane);
  if (!title) {
    builder.warn(
      'LinkedIn did not expose the job title in the page. Click the job in the right-hand panel, wait for it to finish loading, then click Re-extract.',
    );
  } else if (!location && !visible.employmentType && !visible.workplace) {
    builder.warn(
      'Job header details were not visible. Scroll the right-hand job panel so location, Remote/On-site, and About the company are on screen, then Re-extract.',
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
  if (exact) {
    return (
      exact.closest(
        'li[data-occludable-job-id], li.jobs-search-results__list-item, div.job-card-container, article',
      ) ?? exact
    );
  }

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
    location: unique.find((line) => locationFromBlob(line)) ?? '',
  };
}

function companyHref(root: ParentNode, company: string, base: string): string {
  if (!company) return '';
  const needle = company.replace(/,?\s*(inc\.?|llc|ltd\.?)$/i, '').trim().toLowerCase();
  const links = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/company/"]')];
  const match = links.find((link) => cleanText(link.textContent).toLowerCase().includes(needle));
  return match ? match.href : firstHref(root, ['a[href*="/company/"]'], base);
}

function headerFacts(pane: ParentNode) {
  const header = visibleText(pane, 25);
  const combo = header.match(
    /([^\n·•|]{2,60}?)\s*[·•|]\s*((?:just now|today|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago))/i,
  );
  const parts = header.split(/\s*[·•|]\s*/).map((part) => cleanText(part)).filter(Boolean);
  return {
    location: locationFromBlob(combo?.[1] || ''),
    posted: (combo?.[2] || header.match(/\b(?:just now|today|\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)\b/i)?.[0] || '')
      .replace(/^(?:re)?posted\s+/i, ''),
    workplace: parts.map(workplaceFromText).find(Boolean) || workplaceFromText(header),
  };
}

function visibleText(root: ParentNode | null, maxLines: number): string {
  if (!root) return '';
  const el = root as Element;
  const raw = 'innerText' in el && typeof el.innerText === 'string' ? el.innerText : el.textContent || '';
  return raw
    .split('\n')
    .map((line) => cleanText(line))
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n');
}

function cleanJobDescription(text: string, company: string): string {
  let out = cleanText(text).replace(/^about the job\s*/i, '');
  const bare = company.replace(/,?\s*(inc\.?|llc|ltd\.?)$/i, '').trim();
  if (bare) {
    out = out.replace(new RegExp(`([a-z0-9])(${escapeRegExp(bare)})`, 'i'), '$1 $2');
    out = out.replace(new RegExp(`^${escapeRegExp(bare)}\\s*`, 'i'), '');
  }
  out = out
    .replace(/\.([A-Z])/g, '. $1')
    .replace(/:([A-Z])/g, ': $1')
    .replace(/\?([A-Z])/g, '? $1');
  out = out.replace(/([a-z])([A-Z][a-z]{3,})/g, '$1 $2');
  out = out.replace(/\s*(?:…|\.{3}|…)\s*more\s*$/i, '');
  out = out.replace(/\s*(?:see more|show more|see full description)\s*$/i, '');
  return flattenLines(out);
}

function mergeMeta(
  primary: VisibleJobMeta | undefined,
  fallback: ReturnType<typeof parseVisibleJobMeta>,
) {
  if (!primary) return fallback;
  const merged = { ...fallback };
  for (const key of Object.keys(fallback) as Array<keyof typeof fallback>) {
    if (primary[key]) merged[key] = primary[key];
  }
  return merged;
}

function firstRealLocation(...candidates: Array<string | undefined | null>): string {
  for (const candidate of candidates) {
    const location = locationFromBlob(candidate ?? '');
    if (location) return location;
  }
  return '';
}

function firstCompanyName(root: ParentNode | null, selectors: string[]): string {
  if (!root) return '';
  for (const selector of selectors) {
    try {
      for (const el of root.querySelectorAll(selector)) {
        const cleaned = cleanCompanyName(el.textContent || '');
        if (cleaned) return cleaned;
      }
    } catch {
      // Invalid selector — skip.
    }
  }
  return '';
}

function cleanCompanyName(value: string | undefined | null): string {
  let out = cleanText(value)
    .replace(/^company logo for[,.\s]*/i, '')
    .replace(/^company[,.\s]+/i, '')
    .replace(/(Inc)\.+$/i, '$1.')
    .replace(/\s+logo$/i, '');
  const lines = [...new Set(out.split(/\n+/).map((line) => cleanText(line)).filter(Boolean))];
  out = lines.find((line) => !/^company logo for/i.test(line)) || lines[0] || '';
  return cleanText(out);
}

function normalizeCompanyUrl(href: string): string {
  if (!href) return '';
  try {
    const parsed = new URL(href);
    const match = parsed.pathname.match(/^\/(?:company|school)\/([^/]+)/i);
    if (match?.[1]) {
      const kind = parsed.pathname.startsWith('/school/') ? 'school' : 'company';
      return `https://www.linkedin.com/${kind}/${match[1]}`;
    }
  } catch {
    return href;
  }
  return href;
}

function guessedCompanyUrl(company: string): string {
  const slug = company
    .toLowerCase()
    .replace(/,?\s*(inc\.?|llc|ltd\.?|corp\.?)$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug ? `https://www.linkedin.com/company/${slug}` : '';
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
