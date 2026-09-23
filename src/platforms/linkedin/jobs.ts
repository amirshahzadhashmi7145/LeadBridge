import {
  asString,
  firstHref,
  firstText,
  jsonLdType,
  metaContent,
  parseJsonLd,
} from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { uniqueJoin } from '@/utils/text';
import { pathOf, searchParam } from '@/utils/url';

const TITLE_SELECTORS = [
  '.job-details-jobs-unified-top-card__job-title',
  '.jobs-unified-top-card__job-title',
  'h1.t-24',
  'h1.job-title',
  'h1',
  '[class*="job-title"]',
];

const COMPANY_SELECTORS = [
  '.job-details-jobs-unified-top-card__company-name a',
  '.job-details-jobs-unified-top-card__company-name',
  '.jobs-unified-top-card__company-name a',
  '.jobs-unified-top-card__company-name',
  'a.topcard__org-name-link',
  '.topcard__org-name-link',
];

const LOCATION_SELECTORS = [
  '.job-details-jobs-unified-top-card__primary-description-container',
  '.jobs-unified-top-card__primary-description',
  '.jobs-unified-top-card__bullet',
  '.topcard__flavor--bullet',
  '[class*="job-details-jobs-unified-top-card__tertiary"]',
];

const DESCRIPTION_SELECTORS = [
  '#job-details',
  '.jobs-description__content',
  '.jobs-description-content__text',
  '.jobs-box__html-content',
  '.description__text',
  'article.jobs-description',
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
  const jsonLd = parseJsonLd(doc).find((item) => jsonLdType(item, 'JobPosting'));
  const org =
    jsonLd && typeof jsonLd.hiringOrganization === 'object'
      ? (jsonLd.hiringOrganization as Record<string, unknown>)
      : null;

  const title =
    firstText(doc, TITLE_SELECTORS) ||
    asString(jsonLd?.title) ||
    metaContent(doc, ['og:title']);
  const company =
    firstText(doc, COMPANY_SELECTORS) ||
    asString(org?.name) ||
    metaContent(doc, ['og:site_name']);
  const companyUrl = firstHref(doc, COMPANY_SELECTORS, url.toString()) || asString(org?.sameAs || org?.url);
  const location =
    firstText(doc, LOCATION_SELECTORS) ||
    asString(
      (jsonLd?.jobLocation as Record<string, unknown> | undefined)?.address ?? jsonLd?.jobLocation,
    );
  const description =
    firstText(doc, DESCRIPTION_SELECTORS) ||
    asString(jsonLd?.description) ||
    metaContent(doc, ['og:description', 'description']);

  const insights = uniqueJoin(
    [...doc.querySelectorAll(CRITERIA_SELECTORS.join(','))].map((el) => el.textContent),
  );

  const jobUrl = jobId
    ? `https://www.linkedin.com/jobs/view/${jobId}`
    : url.toString();

  builder
    .setType('job')
    .set('jobTitle', title)
    .set('company', company)
    .set('leadName', company)
    .set('companyUrl', companyUrl)
    .set('location', location)
    .set('jobDescription', description)
    .set('jobUrl', jobUrl)
    .set('sourceUrl', url.toString())
    .set('platformLeadId', jobId || jobUrl)
    .extra('employmentType', 'Employment type', asString(jsonLd?.employmentType))
    .extra('datePosted', 'Posting date', asString(jsonLd?.datePosted))
    .extra('workplaceType', 'Workplace type', workplaceFromText(`${location} ${insights}`))
    .extra('jobInsights', 'Job insights', insights);

  extractCriteria(builder, doc);
  return builder;
}

function workplaceFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/\bremote\b/.test(lower)) return 'Remote';
  if (/\bhybrid\b/.test(lower)) return 'Hybrid';
  if (/\bon-?site\b/.test(lower)) return 'On-site';
  return '';
}

function extractCriteria(builder: ExtractionBuilder, doc: Document) {
  const items = doc.querySelectorAll(
    '.description__job-criteria-item, .job-details-jobs-unified-top-card__job-insight',
  );
  items.forEach((item) => {
    const label = (
      item.querySelector('.description__job-criteria-subheader')?.textContent ||
      item.textContent ||
      ''
    ).toLowerCase();
    const value =
      item.querySelector('.description__job-criteria-text')?.textContent ||
      item.textContent ||
      '';
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
