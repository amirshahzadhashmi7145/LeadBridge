import { ExtractionBuilder, identityFromLead } from '@/platforms/builder';
import type { PlatformAdapter } from '@/platforms/types';
import { firstText, metaContent } from '@/platforms/dom';
import type { ExtractContext } from '@/platforms/types';

export const genericAdapter: PlatformAdapter = {
  id: 'generic',
  sourceName: 'Other',
  enabledByDefault: true,
  match() {
    return false;
  },
  detectPageType() {
    return 'unsupported';
  },
  async extract(ctx: ExtractContext) {
    const builder = new ExtractionBuilder(
      'generic',
      'Other',
      'unsupported',
      ctx.url.toString(),
    );
    builder
      .setType('page')
      .set('leadName', firstText(ctx.document, ['h1', 'title']) || ctx.document.title)
      .set('jobTitle', firstText(ctx.document, ['h1']))
      .set('jobDescription', metaContent(ctx.document, ['og:description', 'description']))
      .set('company', metaContent(ctx.document, ['og:site_name']))
      .set('sourceUrl', ctx.url.toString())
      .warn('This site has no dedicated adapter yet. Only page title and metadata were captured.');
    return builder.result('unsupported');
  },
  getLeadIdentity: identityFromLead,
};
