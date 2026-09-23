import type { ExtensionMessage, ExtensionResponse } from '@/messaging/types';

export async function sendMessage<T = ExtensionResponse>(
  message: ExtensionMessage,
): Promise<T> {
  return browser.runtime.sendMessage(message) as Promise<T>;
}
