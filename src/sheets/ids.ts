export function parseSpreadsheetId(raw: string): string {
  const value = raw.trim();
  const fromPath = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (fromPath?.[1]) return fromPath[1];
  const fromQuery = value.match(/[?&]id=([a-zA-Z0-9-_]+)/);
  if (fromQuery?.[1]) return fromQuery[1];
  return value.replace(/^["']|["']$/g, '');
}

export function a1Range(sheetName: string, range: string): string {
  const escaped = (sheetName || 'Sheet1').replace(/'/g, "''");
  return `'${escaped}'!${range}`;
}
