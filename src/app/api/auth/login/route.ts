import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin, sessionCookie, signIn } from '@/lib/auth';
import { failure, readBody } from '@/lib/http';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { email, password } = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) }).parse(await readBody(request));
    const token = await signIn(email, password);
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie, token, { httpOnly: true, sameSite: 'lax', secure: process.env.APP_ORIGIN?.startsWith('https://'), path: '/', maxAge: 7 * 86400 });
    return response;
  } catch (error) { return failure(error); }
}
