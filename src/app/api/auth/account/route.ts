import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin, requireUser, sessionCookie } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError, ensure } from '@/lib/domain';
import { failure, readBody } from '@/lib/http';
import { hashPassword, verifyPassword } from '@/lib/security';

const inputSchema = z.object({
  email: z.email().max(200).transform(value => value.trim().toLowerCase()),
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
  confirmPassword: z.string().min(12).max(200),
});

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const actor = await requireUser();
    const input = inputSchema.parse(await readBody(request));
    ensure(input.newPassword === input.confirmPassword, 'Mật khẩu xác nhận không khớp');
    ensure(input.newPassword !== input.currentPassword, 'Mật khẩu mới phải khác mật khẩu hiện tại');
    const user = await db.user.findUnique({ where: { id: actor.id } });
    if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) throw new AppError('Mật khẩu hiện tại không đúng', 401);
    const duplicate = await db.user.findFirst({ where: { email: input.email, id: { not: actor.id } }, select: { id: true } });
    ensure(!duplicate, 'Email đã được sử dụng', 409);
    const passwordHash = await hashPassword(input.newPassword);
    await db.$transaction([
      db.user.update({ where: { id: actor.id }, data: { email: input.email, passwordHash } }),
      db.session.deleteMany({ where: { userId: actor.id } }),
      db.audit.create({ data: { actorId: actor.id, action: 'ACCOUNT_CREDENTIALS_CHANGED', entityId: actor.id, detail: { emailChanged: input.email !== user.email } } }),
    ]);
    const response = NextResponse.json({ ok: true });
    response.cookies.delete(sessionCookie);
    return response;
  } catch (error) { return failure(error); }
}
