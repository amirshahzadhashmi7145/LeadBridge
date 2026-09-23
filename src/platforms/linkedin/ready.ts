export async function waitForLinkedInJobReady(doc: Document, jobId: string): Promise<void> {
  const deadline = Date.now() + 18000;
  let coreReadyAt = 0;

  while (Date.now() < deadline) {
    expandSeeMore(doc);
    sweepJobPane(doc);
    const state = jobReadyState(doc, jobId);

    if (state.hasTitle && state.hasHeader && state.hasAbout) {
      if (!coreReadyAt) coreReadyAt = Date.now();
      if (state.hasCompany && (state.hasInsights || Date.now() - coreReadyAt >= 2500)) return;
      if (Date.now() - coreReadyAt >= 8000) return;
    }

    await sleep(250);
  }
}

export async function waitForLinkedInJobExtras(doc: Document, jobId: string): Promise<void> {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    expandSeeMore(doc);
    sweepJobPane(doc);
    const state = jobReadyState(doc, jobId);
    if (state.hasCompany && (state.hasInsights || Date.now() + 500 >= deadline)) return;
    await sleep(250);
  }
}

export function jobReadyState(doc: Document, jobId: string) {
  const root = jobRoot(doc);
  const title = jobId
    ? doc.querySelector(`a[href*="/jobs/view/${jobId}"]`)
    : doc.querySelector('a[href*="/jobs/view/"]');
  const about = sectionByName(doc, 'AboutTheJob', jobId);
  const company = sectionByName(doc, 'AboutTheCompany', jobId);
  const applicants = sectionByName(doc, 'PremiumApplicantInsights', jobId);
  const insights = sectionByName(doc, 'PremiumCompanyInsights', jobId);
  const header = headerText(root, title);

  return {
    hasTitle: Boolean(clean(title?.textContent)),
    hasHeader:
      /\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago/i.test(header) ||
      /clicked apply/i.test(header) ||
      /\b(United States|United Kingdom|Canada|Germany|France|India|Australia|Remote)\b/i.test(header),
    hasAbout: clean(about?.textContent).length > 80,
    hasCompany: /about the company|followers|employees/i.test(clean(company?.textContent)),
    hasInsights: /total|seniority|hiring trend|tenure/i.test(
      `${clean(applicants?.textContent)} ${clean(insights?.textContent)}`,
    ),
  };
}

function jobRoot(doc: Document): Element | null {
  return doc.querySelector(
    '[data-sdui-screen*="SemanticJobDetails"], [data-sdui-screen*="JobDetails"]',
  );
}

function sectionByName(doc: Document, name: string, jobId: string): Element | null {
  return (
    (jobId ? doc.querySelector(`#JobDetails_${name}_${jobId}`) : null) ||
    doc.querySelector(`[id^="JobDetails_${name}"]`) ||
    doc.querySelector(`[componentkey^="JobDetails_${name}"]`)
  );
}

function headerText(root: Element | null, title: Element | null): string {
  const scope = root ?? title?.closest('[data-sdui-screen]') ?? title?.parentElement;
  return clean(scope?.textContent).slice(0, 2500);
}

function sweepJobPane(doc: Document) {
  const root = jobRoot(doc);
  if (!root) return;

  const targets = [
    root,
    ...root.querySelectorAll('[data-testid="lazy-column"], [id^="JobDetails_"]'),
  ];
  for (const target of targets) {
    for (const scroller of scrollParents(target)) {
      const step = Math.max(240, Math.floor(scroller.clientHeight * 0.85));
      scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + step);
    }
  }

  const bottom =
    sectionByName(doc, 'AboutTheCompany', '') ||
    sectionByName(doc, 'PremiumCompanyInsights', '') ||
    sectionByName(doc, 'PremiumApplicantInsights', '');
  bottom?.scrollIntoView({ block: 'center', inline: 'nearest' });
}

function scrollParents(start: Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  let node = start.parentElement;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 16) {
      found.push(node);
    }
    node = node.parentElement;
  }
  return found;
}

function expandSeeMore(doc: Document) {
  doc.querySelectorAll('button').forEach((button) => {
    const label = `${button.getAttribute('aria-label') ?? ''} ${button.textContent ?? ''}`;
    if (/see more|show more|see full description/i.test(label) && button.getAttribute('aria-hidden') !== 'true') {
      try {
        button.click();
      } catch {
        // Ignore buttons the content script cannot click.
      }
    }
  });
}

function clean(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
