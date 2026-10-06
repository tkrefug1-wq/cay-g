import { randomBytes, scrypt, timingSafeEqual, createHash, createHmac, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = await derive(password, salt, 64) as Buffer;
  const expected = Buffer.from(hash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function encryptionKey() {
  const secret = process.env.KEY_ENCRYPTION_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret)) throw new Error('KEY_ENCRYPTION_SECRET must be 64 hex characters');
  return Buffer.from(secret, 'hex');
}
export const commandFingerprint = (value: string) => createHmac('sha256', encryptionKey()).update(value).digest('hex');
export function encrypt(value: string) {
  if (!value) return '';
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
}
export function decrypt(value: string) {
  if (!value) return '';
  const [iv, tag, data] = value.split('.').map(v => Buffer.from(v, 'base64'));
  const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function generateTotpSecret() {
  const bytes = randomBytes(20); let out = '', bits = 0, value = 0;
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += base32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += base32[(value << (5 - bits)) & 31];
  return out;
}
function decodeBase32(input: string) {
  let bits = 0, value = 0; const out: number[] = [];
  for (const char of input.replace(/=+$/g, '').toUpperCase()) { const i = base32.indexOf(char); if (i < 0) throw new Error('Invalid TOTP secret'); value = (value << 5) | i; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string, counter: number) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', decodeBase32(secret)).update(msg).digest(); const offset = h[h.length - 1] & 15;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
export function verifyTotp(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false; const counter = Math.floor(now / 30_000);
  return [-1, 0, 1].some(delta => timingSafeEqual(Buffer.from(totp(secret, counter + delta)), Buffer.from(code)));
}
