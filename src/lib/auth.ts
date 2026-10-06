import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { db } from './db';
import { digest, verifyPassword, hashPassword } from './security';
import { AppError, ensure } from './domain';
export const sessionCookie = 'cayg_session';
export async function currentUser() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
  if (!session || !session.mfaVerified || session.expiresAt < new Date() || !session.user.active) return null;
  const { id, email, name, role, parentCtvId } = session.user;
  return { id, email, name, role, parentCtvId };
}
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new AppError('Phiên đăng nhập đã hết hạn', 401);
  return user;
}
export function checkOrigin(request: Request) {
  const origin = process.env.APP_ORIGIN;
  ensure(origin && request.headers.get('origin') === origin, 'Yêu cầu không cùng nguồn', 403);
}
let dummyHash: Promise<string> | undefined;
export async function signIn(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`login:${normalized}`}))`;
    const count = await tx.loginAttempt.count({ where: { email: normalized, createdAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
    ensure(count < 10, 'Thử lại sau 15 phút', 429);
    await tx.loginAttempt.create({ data: { email: normalized } });
  });
  const user = await db.user.findUnique({ where: { email: normalized } });
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
  const valid = await verifyPassword(password, user?.passwordHash ?? await dummyHash);
  ensure(valid && user?.active, 'Email hoặc mật khẩu không đúng', 401);
  const token = randomBytes(32).toString('hex');
  const requiresMfa = user.role === 'ADMIN';
  await db.session.create({ data: { tokenHash: digest(token), userId: user.id, mfaVerified: !requiresMfa, expiresAt: new Date(Date.now() + (requiresMfa ? 10 * 60_000 : 7 * 86400_000)) } });
  return { token, mfa: requiresMfa ? (user.mfaEnabled ? 'verify' : 'setup') : null };
}
export async function pendingAdmin() {
  const token = (await cookies()).get(sessionCookie)?.value; if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } });
  if (!session || session.mfaVerified || session.expiresAt < new Date() || !session.user.active || session.user.role !== 'ADMIN') return null;
  return { token, session, user: session.user };
}
