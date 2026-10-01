import { clearSession, type GoogleUser } from '@/storage/config';
import { logger } from '@/utils/logger';

const FALLBACK_USER: GoogleUser = { name: 'LeadBridge', email: '' };

export async function signIn(): Promise<GoogleUser> {
  return requireUser();
}

export async function signOut(): Promise<void> {
  await clearSession();
}

export async function currentUser(): Promise<GoogleUser | null> {
  return chromeProfileUser();
}

export async function requireUser(): Promise<GoogleUser> {
  return (await chromeProfileUser()) ?? FALLBACK_USER;
}

function chromeProfileUser(): Promise<GoogleUser | null> {
  return new Promise((resolve) => {
    const identity = (
      globalThis as typeof globalThis & {
        chrome?: {
          identity?: {
            getProfileUserInfo: (
              options: { accountStatus?: string },
              callback: (info: { email?: string; id?: string }) => void,
            ) => void;
          };
          runtime?: { lastError?: { message?: string } };
        };
      }
    ).chrome;
    if (!identity?.identity?.getProfileUserInfo) {
      resolve(null);
      return;
    }
    identity.identity.getProfileUserInfo({ accountStatus: 'ANY' }, (info) => {
      if (identity.runtime?.lastError || !info?.email) {
        resolve(null);
        return;
      }
      resolve({
        name: info.email.split('@')[0] || info.email,
        email: info.email,
      });
      void logger.debug('auth', 'Using Chrome profile', info.email);
    });
  });
}
