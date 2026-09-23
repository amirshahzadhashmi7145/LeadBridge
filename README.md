# LeadBridge

Chrome extension that captures structured lead data from LinkedIn and Upwork into a shared company Google Sheet. Salespeople review and edit extracted fields before saving. They do not copy/paste or switch to Sheets.

## What it does

1. Open a LinkedIn job, company page, or feed post, or an Upwork job page.
2. Click the LeadBridge icon. The side panel opens.
3. The extension detects the platform, extracts visible page data (not a screenshot), and shows a review form.
4. Edit anything that looks wrong, then click **Save / Capture**.
5. The lead is written to the configured Google Sheet, including source, URL, capturer, and timestamp.

If the same lead is already in the sheet:

- **Another teammate owns it** — save is blocked, with their name and capture time.
- **You captured it** — update the existing row, create a second entry, or cancel.

## Load the extension

```bash
npm install
npm run dev
```

`npm run dev` writes an unpacked build to `.output/chrome-mv3`. In Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** and select `.output/chrome-mv3`

For a production zip:

```bash
npm run zip
```

## Google Sheets setup

1. Create or open the shared company spreadsheet.
2. Copy the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
3. Give every salesperson edit access to that sheet.
4. In the extension, open **Settings** and paste the spreadsheet ID. Default tab name is `Leads`.
5. The first save creates the header row if the tab is empty.

Default columns include source, job/company fields, original URL, status (`Lead captured` by default), captured-by, and timestamps. Existing workflow values stay in the Status column:

Lead captured, Message sent, Application submitted, Proposal sent, Client replied, Follow-up required, Follow-up completed, Converted, Rejected/Closed.

## Google OAuth

LeadBridge uses the signed-in user's Google account. It never stores Google or platform passwords.

`Error 400: redirect_uri_mismatch` means the OAuth client is the wrong type, or the redirect URL is missing.

Use a **Web application** client (recommended for unpacked installs):

1. [Google Cloud Credentials](https://console.cloud.google.com/apis/credentials) → enable **Google Sheets API**.
2. Create OAuth client → type **Web application** (not Chrome extension, not Desktop).
3. Authorized redirect URIs — add both, then Save:
   - `https://nmcgiafjblnaeklmecclldpbcaahnign.chromiumapp.org/`
   - `https://nmcgiafjblnaeklmecclldpbcaahnign.chromiumapp.org`
4. Copy the Client ID into LeadBridge **Settings** → OAuth client ID → Save settings.
5. Sign in again.

If Chrome still shows a different extension ID on `chrome://extensions`, use the redirect URL printed in Settings instead. After changing the manifest `key`, remove the old unpacked install and load it again.

## Adding a platform later

Platforms live in `src/platforms/`. Each adapter implements:

- `id` / `sourceName`
- `match(url)`
- `detectPageType(ctx)`
- `extract(ctx)`
- `getLeadIdentity(lead)`

Register it in `src/platforms/registry.ts`. Wellfound and We Work Remotely already have starter adapters (off by default).

## Project layout

```
src/
  entrypoints/     background, content script, side panel, options
  platforms/       LinkedIn, Upwork, starter adapters, shared extractor helpers
  schema/          common lead model
  sheets/          Google Sheets I/O, column map, duplicate checks
  auth/            Google OAuth
  storage/         settings, drafts, session
```
