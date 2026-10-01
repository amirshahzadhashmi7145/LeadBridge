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
      'alarms',
      'sidePanel',
      'tabs',
      'identity',
      'identity.email',
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
      'https://script.google.com/*',
      'https://script.googleusercontent.com/*',
      'https://*.googleusercontent.com/*',
    ],
    action: {
      default_title: 'LeadBridge',
    },
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAur7YE3+u5kep8Zkt6F/sk5lDJZ1tMgITQXVYgYvLTIqmIL61OK39rq8yPFi2Maiq/cxm+mPP0rEJuSyuQZaLZmYd9QCodF+TxqVIH9EIjXewVm/898Eo/2g/Z1CHU4HuMKGRHKNptkS1JSlr4378dXWCksbwDoOtP9gV6REYijlMExrKS0ygtvVs1KIJ65C/YOrFEHHmG3iOSdLxTYk/6dx7VHDUUqwisZlIaOJQ4TLIX00BvZe29T1P+MkwErkj038tRk4xV+R9N9hWZYE4uGDA+RSEXOW4Ufe4iMdv60RViaH3cSitxxU5AcA/URFqpCp7qXTVi4AAR0VJtcNiDQIDAQAB',
  },
});
