import { firstEl } from '@/platforms/dom';
import { cleanText } from '@/utils/text';
import {
  locationFromBlob,
  parseJobMetaWindows,
  type VisibleJobMeta,
} from './jobMeta';

export interface SduiJob {
  title: string;
  company: string;
  companyUrl: string;
  description: string;
  meta: VisibleJobMeta;
}

export function extractSduiJob(doc: Document, jobId: string): Partial<SduiJob> {
  const root = jobDetailsRoot(doc, jobId);
  const aboutJob = section(doc, root, 'AboutTheJob', jobId);
  const aboutCompany = section(doc, root, 'AboutTheCompany', jobId);
  const applicantInsights = section(doc, root, 'PremiumApplicantInsights', jobId);
  const companyInsights = section(doc, root, 'PremiumCompanyInsights', jobId);
  if (!root && !aboutJob && !aboutCompany) return {};

  const scope = root ?? doc;
  const title = sduiTitle(scope, jobId);
  const companyLink = sduiCompanyLink(scope);
  const company = sduiCompanyName(companyLink);
  const companyUrl = companyLink?.href ?? '';

  const headerText = headerRegion(scope, aboutJob, title);
  const extrasText = [rawText(applicantInsights), rawText(companyInsights), rawText(aboutCompany)]
    .filter(Boolean)
    .join('\n');
  const meta = parseJobMetaWindows(headerText, extrasText, title);
  if (!meta.location) meta.location = locationFromHeaderParagraph(scope);

  return {
    title,
    company,
    companyUrl,
    description: rawText(aboutJob).replace(/^about the job\s*/i, ''),
    meta,
  };
}

function jobDetailsRoot(doc: Document, jobId: string): Element | null {
  return (
    firstEl(doc, [
      '[data-sdui-screen*="SemanticJobDetails"]',
      '[data-sdui-screen*="JobDetails"]',
    ]) ||
    (jobId
      ? doc.querySelector(`[id="JobDetails_AboutTheJob_${jobId}"]`)?.closest('[data-sdui-screen]') ??
        null
      : null)
  );
}

function section(
  doc: Document,
  root: ParentNode | null,
  name: string,
  jobId: string,
): Element | null {
  const scoped = root ?? doc;
  const selectors = [
    jobId ? `#JobDetails_${name}_${jobId}` : '',
    jobId ? `[id="JobDetails_${name}_${jobId}"]` : '',
    jobId ? `[componentkey="JobDetails_${name}_${jobId}"]` : '',
    `[id^="JobDetails_${name}"]`,
    `[componentkey^="JobDetails_${name}"]`,
  ].filter(Boolean);
  return firstEl(scoped, selectors) || firstEl(doc, selectors);
}

function sduiTitle(root: ParentNode, jobId: string): string {
  const link = jobId
    ? root.querySelector(`a[href*="/jobs/view/${jobId}"]`)
    : root.querySelector('a[href*="/jobs/view/"]');
  return cleanText(link?.textContent);
}

function sduiCompanyLink(root: ParentNode): HTMLAnchorElement | null {
  return (
    root.querySelector<HTMLAnchorElement>('a[aria-label^="Company"]') ||
    root.querySelector<HTMLAnchorElement>('a[href*="/company/"]:not([href*="insights"])')
  );
}

function sduiCompanyName(link: HTMLAnchorElement | null): string {
  if (!link) return '';
  const labeled = cleanText(link.getAttribute('aria-label')).replace(/^company[,.\s]+/i, '');
  const nested = cleanText(link.querySelector('p a, p')?.textContent);
  const raw = nested || labeled || cleanText(link.textContent);
  return raw
    .replace(/^company logo for[,.\s]*/i, '')
    .replace(/^company[,.\s]+/i, '')
    .replace(/(Inc)\.+$/i, '$1.')
    .replace(/\.{2,}$/g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

function headerRegion(root: ParentNode, aboutJob: Element | null, title: string): string {
  const full = rawText(root as Element);
  const beforeAbout = sliceBefore(full, /about the job/i, 2500);
  if (beforeAbout && /remote|hybrid|on-?site|ago|united|clicked apply/i.test(beforeAbout)) {
    return beforeAbout;
  }
  if (aboutJob) {
    const parent = rawText(aboutJob.parentElement);
    const fromParent = sliceBefore(parent, /about the job/i, 2500);
    if (fromParent) return fromParent;
  }
  if (title && full.includes(title)) {
    const at = full.indexOf(title);
    return full.slice(at, at + 900);
  }
  return beforeAbout || full.slice(0, 1500);
}

function locationFromHeaderParagraph(root: ParentNode): string {
  for (const paragraph of root.querySelectorAll('p')) {
    const text = rawText(paragraph);
    if (
      /\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago/i.test(text) &&
      /clicked apply|applicant/i.test(text)
    ) {
      return locationFromBlob(text);
    }
  }
  return '';
}

function rawText(el: Element | null | undefined): string {
  if (!el) return '';
  if ('innerText' in el && typeof el.innerText === 'string' && el.innerText.trim()) {
    return el.innerText;
  }
  return el.textContent || '';
}

function sliceBefore(text: string, landmark: RegExp, chars: number): string {
  const at = text.search(landmark);
  if (at < 0) return '';
  return text.slice(Math.max(0, at - chars), at);
}
