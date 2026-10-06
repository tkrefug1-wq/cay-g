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
