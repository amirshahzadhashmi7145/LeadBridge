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

const PLACEHOLDER_CLIENT = 'YOUR_CHROME_EXTENSION_CLIENT_ID';

export async function getValidAccessToken(): Promise<string | null> {
  const session = await getSession();
  if (session && session.expiresAt > Date.now() + 15_000) {
    return session.accessToken;
  }

  try {
    if (hasRealManifestClientId()) {
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
    }
  } catch (error) {
    await logger.debug('auth', 'Silent getAuthToken failed', String(error));
  }

  return null;
}

export async function signIn(): Promise<GoogleUser> {
  if (hasRealManifestClientId()) {
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
  }

  const config = await getConfig();
  if (!config.googleClientId) {
    throw new Error(
      'Add a Google OAuth Client ID in Settings first. Create a Web application client in Google Cloud, then paste the client ID here.',
    );
  }

  const redirectUri = extensionRedirectUrl();
  await logger.info('auth', 'Starting Google sign-in', {
    redirectUri,
    extensionId: browser.runtime.id,
  });
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth' +
    `?client_id=${encodeURIComponent(config.googleClientId.trim())}` +
    '&response_type=token' +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES.join(' '))}` +
    '&prompt=consent' +
    '&include_granted_scopes=true';

  try {
    const responseUrl = await launchWebAuth(authUrl);
    if (!responseUrl) throw new Error('Google sign-in was cancelled.');

    const parsed = new URL(responseUrl.replace('#', '?'));
    const oauthError = parsed.searchParams.get('error');
    if (oauthError) {
      throw new Error(oauthHelp(oauthError, redirectUri));
    }
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(oauthHelp(message, redirectUri));
  }
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

function hasRealManifestClientId(): boolean {
  const manifest = chromeIdentity()?.runtime
    ? (browser.runtime.getManifest() as { oauth2?: { client_id?: string } })
    : { oauth2: { client_id: '' } };
  const clientId = manifest.oauth2?.client_id ?? '';
  return Boolean(clientId) && !clientId.includes(PLACEHOLDER_CLIENT);
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
        getRedirectURL: (path?: string) => string;
        launchWebAuthFlow: (
          options: { url: string; interactive: boolean },
          callback: (responseUrl?: string) => void,
        ) => void;
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

async function getAuthTokenSilent(): Promise<string | null> {
  return identityToken(false);
}

async function getAuthTokenInteractive(): Promise<string | null> {
  return identityToken(true);
}

function launchWebAuth(url: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const api = chromeIdentity();
    if (api?.identity?.launchWebAuthFlow) {
      api.identity.launchWebAuthFlow({ url, interactive: true }, (responseUrl) => {
        if (api.runtime?.lastError) {
          reject(new Error(api.runtime.lastError.message || 'Google sign-in failed.'));
          return;
        }
        resolve(responseUrl);
      });
      return;
    }
    browser.identity
      .launchWebAuthFlow({ url, interactive: true })
      .then(resolve)
      .catch((error) => reject(error instanceof Error ? error : new Error(String(error))));
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
  const api = chromeIdentity();
  if (api?.identity?.getRedirectURL) {
    return api.identity.getRedirectURL();
  }
  return browser.identity.getRedirectURL();
}

export function oauthHelp(raw: string, redirectUri: string): string {
  const text = raw.toLowerCase();
  if (
    text.includes('redirect_uri') ||
    text.includes('redirect uri') ||
    text.includes('invalid_request') ||
    text.includes('blocked')
  ) {
    return (
      `Google rejected the sign-in redirect (redirect_uri_mismatch). ` +
      `In Google Cloud Console, open your OAuth client. It must be type “Web application”. ` +
      `Under Authorized redirect URIs add exactly:\n${redirectUri}\n` +
      `Also add the same URL without a trailing slash if Google still blocks it. ` +
      `Save the client, put its Client ID in LeadBridge Settings, then try again.`
    );
  }
  if (text.includes('access_denied') || text.includes('cancelled') || text.includes('canceled')) {
    return 'Google sign-in was cancelled.';
  }
  return raw;
}
