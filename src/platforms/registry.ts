import type { PlatformAdapter } from '@/platforms/types';
import { genericAdapter } from '@/platforms/generic';
import { linkedinAdapter } from '@/platforms/linkedin';
import { upworkAdapter } from '@/platforms/upwork';
import { wellfoundAdapter } from '@/platforms/wellfound';
import { wwrAdapter } from '@/platforms/wwr';
import { safeUrl } from '@/utils/url';

export const PLATFORM_ADAPTERS: PlatformAdapter[] = [
  linkedinAdapter,
  upworkAdapter,
  wellfoundAdapter,
  wwrAdapter,
];

export function allAdapters(): PlatformAdapter[] {
  return [...PLATFORM_ADAPTERS];
}

export function adapterById(id: string): PlatformAdapter | undefined {
  if (id === genericAdapter.id) return genericAdapter;
  return PLATFORM_ADAPTERS.find((adapter) => adapter.id === id);
}

export function findAdapter(
  urlValue: string,
  enabledIds?: string[],
): PlatformAdapter | undefined {
  const url = safeUrl(urlValue);
  if (!url) return undefined;
  return PLATFORM_ADAPTERS.find((adapter) => {
    if (enabledIds && !enabledIds.includes(adapter.id)) return false;
    return adapter.match(url);
  });
}

export function detectFromUrl(
  urlValue: string,
  enabledIds?: string[],
): { adapter?: PlatformAdapter; unknown: boolean } {
  const adapter = findAdapter(urlValue, enabledIds);
  return { adapter, unknown: !adapter };
}

export { genericAdapter };
