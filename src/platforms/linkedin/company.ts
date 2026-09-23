import { firstHref, firstText, metaContent } from '@/platforms/dom';
import { ExtractionBuilder } from '@/platforms/builder';
import { pathOf } from '@/utils/url';

export function linkedinCompanySlug(url: string): string {
  const match = pathOf(url).match(/\/company\/([^/]+)/);
  return match?.[1] ?? '';
}

export function extractLinkedInCompany(
  builder: ExtractionBuilder,
  ctx: { url: URL; document: Document },
) {
  const { document: doc, url } = ctx;
  const name =
    firstText(doc, [
      'h1.org-top-card-summary__title',
      '.org-top-card-summary__title',
      'h1',
    ]) || metaContent(doc, ['og:title']);
  const about = firstText(doc, [
    '.org-about-module__description',
    '.break-words.white-space-pre-wrap',
    '.org-top-card-summary__tagline',
  ]);
  const extras = [...doc.querySelectorAll('.org-top-card-summary-info-list__info-item')]
    .map((el) => el.textContent?.trim() ?? '')
    .filter(Boolean);

  builder
    .setType('company')
    .set('company', name)
    .set('leadName', name)
    .set('companyUrl', url.toString())
    .set('sourceUrl', url.toString())
    .set('jobDescription', about || metaContent(doc, ['og:description']))
    .set('location', extras.find((item) => /,\s|[A-Z]{2}/.test(item)) ?? '')
    .set('platformLeadId', linkedinCompanySlug(url.toString()) || url.toString())
    .extra('industry', 'Industry', extras.find((item) => /industry|software|health|finance/i.test(item)))
    .extra('companySize', 'Company size', extras.find((item) => /employee/i.test(item)))
    .extra('website', 'Website', firstHref(doc, ['.org-page-details__definition-text a', 'a[href^="http"]'], url.toString()));

  return builder;
}
