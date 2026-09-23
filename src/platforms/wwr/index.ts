import { ExtractionBuilder, identityFromLead } from '@/platforms/builder';
import type { PlatformAdapter } from '@/platforms/types';
import { firstText, metaContent } from '@/platforms/dom';

export const wwrAdapter: PlatformAdapter = {
  id: 'wwr',
  sourceName: 'We Work Remotely',
  enabledByDefault: false,
  match(url) {
    return /(^|\.)weworkremotely\.com$/i.test(url.hostname);
  },
  detectPageType(ctx) {
    return ctx.url.pathname.includes('/remote-') || ctx.url.pathname.includes('/jobs/')
      ? 'job'
      : 'unsupported';
  },
  async extract(ctx) {
    const type = this.detectPageType(ctx);
    const builder = new ExtractionBuilder('wwr', 'We Work Remotely', type, ctx.url.toString());
    builder
      .setType(type === 'job' ? 'job' : 'page')
      .set('jobTitle', firstText(ctx.document, ['h1']) || metaContent(ctx.document, ['og:title']))
      .set('company', firstText(ctx.document, ['.company-card h2', 'h2']))
      .set('location', firstText(ctx.document, ['.location', '[class*="location"]']))
      .set('jobDescription', firstText(ctx.document, ['.listing-container', 'article']) || metaContent(ctx.document, ['og:description']))
      .set('sourceUrl', ctx.url.toString())
      .set('jobUrl', ctx.url.toString())
      .set('platformLeadId', ctx.url.pathname)
      .warn('We Work Remotely is a starter adapter. Refine selectors before relying on it.');
    return builder.result(type);
  },
  getLeadIdentity: identityFromLead,
};
