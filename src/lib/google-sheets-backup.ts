import { createSign } from "node:crypto";
import { db } from "./db";

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };
const sheets = ["KEYS", "USAGES", "SETTLEMENTS", "USERS", "BACKUP_LOG"] as const;

function config() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!raw || !spreadsheetId) throw new Error("Chưa cấu hình GOOGLE_SERVICE_ACCOUNT_JSON hoặc GOOGLE_SHEET_ID");
  const account = JSON.parse(raw) as ServiceAccount;
  if (!account.client_email || !account.private_key) throw new Error("Google service account không hợp lệ");
  return { account, spreadsheetId };
}

function encoded(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

async function accessToken(account: ServiceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encoded({ alg: "RS256", typ: "JWT" })}.${encoded({ iss: account.client_email, scope: "https://www.googleapis.com/auth/spreadsheets", aud: account.token_uri ?? "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const response = await fetch(account.token_uri ?? "https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }) });
  const body = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !body.access_token) throw new Error(body.error_description ?? "Không thể xác thực Google Sheets");
  return body.access_token;
}

async function google(url: string, token: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: { message?: string } }).error?.message ?? "Google Sheets API lỗi");
  return body;
}

async function ensureSheets(spreadsheetId: string, token: string) {
  const metadata = await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, token) as { sheets?: { properties: { title: string } }[] };
  const existing = new Set(metadata.sheets?.map(sheet => sheet.properties.title) ?? []);
  const missing = sheets.filter(name => !existing.has(name));
  if (missing.length) await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, token, { method: "POST", body: JSON.stringify({ requests: missing.map(title => ({ addSheet: { properties: { title } } })) }) });
}

async function replaceSheet(spreadsheetId: string, token: string, name: string, rows: (string | number | boolean | null)[][]) {
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${name}!A:Z`)}:clear`, token, { method: "POST", body: "{}" });
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const values = rows.slice(offset, offset + 1000);
    await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(`${name}!A${offset + 1}`)}?valueInputOption=RAW`, token, { method: "PUT", body: JSON.stringify({ range: `${name}!A${offset + 1}`, majorDimension: "ROWS", values }) });
  }
}

export async function backupToGoogleSheets() {
  const { account, spreadsheetId } = config();
  const revision = new Date().toISOString();
  const [keys, usages, settlements, users] = await Promise.all([
    db.key.findMany({ select: { id: true, fullName: true, normalizedStk: true, bank: true, archived: true, owner: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.usage.findMany({ select: { id: true, keyId: true, deposit: true, withdrawal: true, status: true, platform: { select: { name: true } }, settlement: { select: { date: true } } }, orderBy: { createdAt: "asc" } }),
    db.settlement.findMany({ select: { id: true, deposit: true, withdrawal: true, fee: true, profit: true, payout: true, status: true, worker: { select: { name: true } } }, orderBy: [{ date: "asc" }, { workerId: "asc" }] }),
    db.user.findMany({ select: { id: true, name: true, email: true, role: true, active: true, parent: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const token = await accessToken(account);
  await ensureSheets(spreadsheetId, token);
  const tables = {
    KEYS: [["key_id", "họ tên", "STK", "ngân hàng", "chủ sở hữu", "trạng thái"], ...keys.map(key => [key.id, key.fullName, key.normalizedStk, key.bank, key.owner?.name ?? "", key.archived ? "ARCHIVED" : "ACTIVE"])],
    USAGES: [["usage_id", "key_id", "Platform", "nạp", "rút", "trạng thái", "ngày"], ...usages.map(usage => [usage.id, usage.keyId, usage.platform.name, usage.deposit.toString(), usage.withdrawal.toString(), usage.status, usage.settlement.date])],
    SETTLEMENTS: [["settlement_id", "người nhận", "nạp", "rút", "phí", "lợi nhuận", "payout", "trạng thái"], ...settlements.map(row => [row.id, row.worker.name, row.deposit.toString(), row.withdrawal.toString(), row.fee.toString(), row.profit.toString(), row.payout.toString(), row.status])],
    USERS: [["user_id", "họ tên", "email", "vai trò", "CTV cha", "hoạt động"], ...users.map(row => [row.id, row.name, row.email, row.role, row.parent?.name ?? "", row.active])],
  };
  for (const [name, rows] of Object.entries(tables)) await replaceSheet(spreadsheetId, token, name, rows);
  const counts = keys.length + usages.length + settlements.length + users.length;
  const logHeader = await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("BACKUP_LOG!A1:E1")}`, token) as { values?: string[][] };
  if (!logHeader.values?.length) await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("BACKUP_LOG!A1")}?valueInputOption=RAW`, token, { method: "PUT", body: JSON.stringify({ values: [["thời gian", "revision", "số dòng", "kết quả", "service account"]] }) });
  await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("BACKUP_LOG!A:E")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, token, { method: "POST", body: JSON.stringify({ values: [[revision, revision, counts, "SUCCESS", account.client_email]] }) });
  return { revision, rows: counts, keys: keys.length, usages: usages.length, settlements: settlements.length, users: users.length };
}

export async function lastGoogleSheetsBackup() {
  const { account, spreadsheetId } = config();
  const token = await accessToken(account);
  await ensureSheets(spreadsheetId, token);
  const result = await google(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("BACKUP_LOG!A2:E")}`, token) as { values?: string[][] };
  const row = result.values?.at(-1);
  return row ? { time: row[0], revision: row[1], rows: Number(row[2]), status: row[3] } : null;
}
