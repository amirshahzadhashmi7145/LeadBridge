import {
  clearSession,
  getConfig,
  getSession,
  saveSession,
  type GoogleUser,
  type StoredSession,
} from '@/storage/config';
import { logger } from '@/utils/logger';

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export async function getValidAccessToken(): Promise<string | null> {
  const session = await getSession();
  if (session && session.expiresAt > Date.now() + 15_000) {
    return session.accessToken;
  }

  try {
    const token = await getAuthTokenSilent();
    if (token) {
      const user = await fetchUser(token);
      await saveSession({
        accessToken: token,
        expiresAt: Date.now() + 50 * 60 * 1000,
        user,
      });
      return token;
    }
  } catch (error) {
    await logger.debug('auth', 'Silent getAuthToken failed', String(error));
  }

  return null;
}

export async function signIn(): Promise<GoogleUser> {
  const tokenFromIdentity = await getAuthTokenInteractive();
  if (tokenFromIdentity) {
    const user = await fetchUser(tokenFromIdentity);
    await saveSession({
      accessToken: tokenFromIdentity,
      expiresAt: Date.now() + 50 * 60 * 1000,
      user,
    });
    await logger.info('auth', 'Signed in with chrome.identity.getAuthToken', user.email);
    return user;
  }

  const config = await getConfig();
  if (!config.googleClientId) {
    throw new Error(
      'Add your Google OAuth Client ID in Options, or set WXT_GOOGLE_CLIENT_ID before building.',
    );
  }

  const redirectUri = browser.identity.getRedirectURL();
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(config.googleClientId)}` +
    '&response_type=token' +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
    '&prompt=select_account';

  const responseUrl = await browser.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!responseUrl) throw new Error('Google sign-in was cancelled.');

  const parsed = new URL(responseUrl.replace('#', '?'));
  const accessToken = parsed.searchParams.get('access_token');
  const expiresIn = Number(parsed.searchParams.get('expires_in') || '3600');
  if (!accessToken) throw new Error('Google did not return an access token.');

  const user = await fetchUser(accessToken);
  await saveSession({
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
    user,
  });
  await logger.info('auth', 'Signed in with launchWebAuthFlow', user.email);
  return user;
}

export async function signOut(): Promise<void> {
  const session = await getSession();
  if (session?.accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${session.accessToken}`, {
        method: 'POST',
      });
    } catch {
      // Revoke is best-effort.
    }
    try {
      chromeIdentity()?.identity?.removeCachedAuthToken({ token: session.accessToken });
    } catch {
      // Not always available.
    }
  }
  await clearSession();
  await logger.info('auth', 'Signed out');
}

export async function currentUser(): Promise<GoogleUser | null> {
  const session = await getSession();
  if (session && session.expiresAt > Date.now()) return session.user;
  const token = await getValidAccessToken();
  if (!token) return null;
  const stored = await getSession();
  return stored?.user ?? null;
}

export async function requireSession(): Promise<StoredSession> {
  const token = await getValidAccessToken();
  const session = await getSession();
  if (token && session) return session;
  const user = await signIn();
  const next = await getSession();
  if (!next) throw new Error(`Signed in as ${user.email}, but the session was not stored.`);
  return next;
}

async function getAuthTokenSilent(): Promise<string | null> {
  return identityToken(false);
}

async function getAuthTokenInteractive(): Promise<string | null> {
  return identityToken(true);
}

function chromeIdentity() {
  const root = globalThis as typeof globalThis & {
    chrome?: {
      identity?: {
        getAuthToken: (
          options: { interactive: boolean },
          callback: (token?: string) => void,
        ) => void;
        removeCachedAuthToken: (options: { token: string }) => void;
      };
      runtime?: { lastError?: { message?: string } };
    };
  };
  return root.chrome;
}

function identityToken(interactive: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const api = chromeIdentity();
    if (!api?.identity?.getAuthToken) {
      resolve(null);
      return;
    }
    api.identity.getAuthToken({ interactive }, (token) => {
      if (api.runtime?.lastError || !token) {
        resolve(null);
        return;
      }
      resolve(token);
    });
  });
}

async function fetchUser(token: string): Promise<GoogleUser> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error('Could not load the Google account profile.');
  }
  const data = (await response.json()) as {
    name?: string;
    email?: string;
    picture?: string;
  };
  return {
    name: data.name || data.email || 'Unknown user',
    email: data.email || '',
    picture: data.picture,
  };
}

export function extensionRedirectUrl(): string {
  return browser.identity.getRedirectURL();
}
