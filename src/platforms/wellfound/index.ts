import { ExtractionBuilder, identityFromLead } from '@/platforms/builder';
import type { PlatformAdapter } from '@/platforms/types';
import { firstText, metaContent } from '@/platforms/dom';

export const wellfoundAdapter: PlatformAdapter = {
  id: 'wellfound',
  sourceName: 'Wellfound',
  enabledByDefault: false,
  match(url) {
    return /(^|\.)wellfound\.com$/i.test(url.hostname) || /(^|\.)angel\.co$/i.test(url.hostname);
  },
  detectPageType(ctx) {
    return ctx.url.pathname.includes('/jobs') || ctx.url.pathname.includes('/job')
      ? 'job'
      : 'unsupported';
  },
  async extract(ctx) {
    const type = this.detectPageType(ctx);
    const builder = new ExtractionBuilder('wellfound', 'Wellfound', type, ctx.url.toString());
    builder
      .setType(type === 'job' ? 'job' : 'page')
      .set('jobTitle', firstText(ctx.document, ['h1']) || metaContent(ctx.document, ['og:title']))
      .set('jobDescription', metaContent(ctx.document, ['og:description']))
      .set('company', firstText(ctx.document, ['h2', '[class*="company"]']))
      .set('sourceUrl', ctx.url.toString())
      .set('jobUrl', ctx.url.toString())
      .set('platformLeadId', ctx.url.pathname)
      .warn('Wellfound is a starter adapter. Add page-specific selectors when you enable it for production use.');
    return builder.result(type);
  },
  getLeadIdentity: identityFromLead,
};
