import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { checkOrigin, sessionCookie } from '@/lib/auth';
import { digest } from '@/lib/security';
import { db } from '@/lib/db';
import { failure } from '@/lib/http';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const token = (await cookies()).get(sessionCookie)?.value;
    if (token) await db.session.deleteMany({ where: { tokenHash: digest(token) } });
    const response = NextResponse.json({ ok: true }); response.cookies.delete(sessionCookie); return response;
  } catch (error) { return failure(error); }
}
