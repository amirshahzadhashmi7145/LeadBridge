import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  alias: {
    '@': 'src',
  },
  // Keep the watcher only. Do not spawn a second Chrome — that IPC pipe
  // often dies with ECONNRESET on Linux. Load the unpacked folder yourself.
  webExt: {
    disabled: true,
  },
  manifest: {
    name: 'LeadBridge',
    description:
      'Capture LinkedIn and Upwork leads into Google Sheets without leaving the page.',
    version: '1.0.0',
    permissions: [
      'storage',
      'sidePanel',
      'tabs',
      'identity',
      'scripting',
      'activeTab',
    ],
    host_permissions: [
      'https://www.linkedin.com/*',
      'https://linkedin.com/*',
      'https://www.upwork.com/*',
      'https://upwork.com/*',
      'https://wellfound.com/*',
      'https://www.wellfound.com/*',
      'https://angel.co/*',
      'https://www.angel.co/*',
      'https://weworkremotely.com/*',
      'https://www.weworkremotely.com/*',
      'https://sheets.googleapis.com/*',
      'https://www.googleapis.com/*',
      'https://accounts.google.com/*',
    ],
    action: {
      default_title: 'LeadBridge',
    },
    oauth2: {
      client_id:
        process.env.WXT_GOOGLE_CLIENT_ID ||
        'YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com',
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
      ],
    },
  },
});
