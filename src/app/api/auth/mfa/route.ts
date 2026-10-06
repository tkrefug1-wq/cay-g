import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin, pendingAdmin, sessionCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { decrypt, encrypt, generateTotpSecret, verifyTotp } from '@/lib/security';
import { failure, readBody } from '@/lib/http';
import { AppError } from '@/lib/domain';
export async function GET() {
  try {
    const pending = await pendingAdmin(); if (!pending) throw new AppError('Phiên MFA không hợp lệ', 401);
    let secret = pending.user.mfaSecret ? decrypt(pending.user.mfaSecret) : generateTotpSecret();
    if (!pending.user.mfaSecret) await db.user.update({ where: { id: pending.user.id }, data: { mfaSecret: encrypt(secret) } });
    return NextResponse.json({ setup: !pending.user.mfaEnabled, secret: pending.user.mfaEnabled ? undefined : secret, uri: pending.user.mfaEnabled ? undefined : `otpauth://totp/CAY%20G:${encodeURIComponent(pending.user.email)}?secret=${secret}&issuer=CAY%20G&digits=6&period=30` }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request); const pending = await pendingAdmin(); if (!pending?.user.mfaSecret) throw new AppError('Phiên MFA không hợp lệ', 401);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await readBody(request));
    if (!verifyTotp(decrypt(pending.user.mfaSecret), code)) throw new AppError('Mã xác thực không đúng', 401);
    await db.$transaction([db.user.update({ where: { id: pending.user.id }, data: { mfaEnabled: true } }), db.session.update({ where: { tokenHash: pending.session.tokenHash }, data: { mfaVerified: true, expiresAt: new Date(Date.now() + 7 * 86400_000) } }), db.audit.create({ data: { actorId: pending.user.id, action: 'MFA_VERIFIED', entityId: pending.user.id, detail: { setup: !pending.user.mfaEnabled } } })]);
    const response = NextResponse.json({ ok: true }); response.cookies.set(sessionCookie, pending.token, { httpOnly: true, sameSite: 'lax', secure: process.env.APP_ORIGIN?.startsWith('https://'), path: '/', maxAge: 7 * 86400 }); return response;
  } catch (error) { return failure(error); }
}
