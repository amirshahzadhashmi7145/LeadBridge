# LeadBridge

Chrome extension that captures structured lead data from LinkedIn, Upwork, and Wellfound into a shared company Google Sheet. Salespeople review and edit extracted fields before saving. They do not copy/paste or switch to Sheets.

## What it does

1. Open a LinkedIn job, company page, or feed post; an Upwork job page; or a Wellfound job or company page.
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

## Connect your own Google Sheet

Team sheet credentials are **not** in this repo. A public clone cannot write to someone else's spreadsheet.

1. Copy `.env.example` to `.env`.
2. Create a Google Sheet and copy its ID from  
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
3. Paste `apps-script/Code.gs` into a new Apps Script project. Replace `YOUR_SPREADSHEET_ID`. Run **authorize** once and click Allow.
4. Deploy as a web app: **Execute as Me**, **Who has access: Anyone**. Copy the `/exec` URL.
5. Put that URL and spreadsheet ID in `.env`:

```
WXT_GOOGLE_WEB_APP_URL=https://script.google.com/macros/s/.../exec
WXT_SPREADSHEET_ID=your-spreadsheet-id
WXT_SHEET_NAME=LeadBridge
```

6. Rebuild (`npm run build` or `npm run dev`) and reload the unpacked extension.

Without a filled-in `.env`, Save is blocked. Do not commit `.env`.

Default columns include source, job/company fields, original URL, status (`Lead captured` by default), captured-by, and timestamps.

## Adding a platform later

Platforms live in `src/platforms/`. Each adapter implements:

- `id` / `sourceName`
- `match(url)`
- `detectPageType(ctx)`
- `extract(ctx)`
- `getLeadIdentity(lead)`

Register it in `src/platforms/registry.ts`. We Work Remotely still has a starter adapter (off by default).

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
