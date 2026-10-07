import { NextResponse } from 'next/server';
import { checkOrigin, requireUser } from '@/lib/auth';
import { failure, readBody } from '@/lib/http';
import { snapshot } from '@/lib/queries';
import { mutate } from '@/lib/service';
export async function GET(request: Request) {
  try { return NextResponse.json(await snapshot(await requireUser(), new URL(request.url).searchParams), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try { checkOrigin(request); const result = await mutate(await requireUser(), await readBody(request), request.headers.get('idempotency-key') ?? ''); return NextResponse.json({ result, revision: new Date().toISOString() }); }
  catch (error) { return failure(error); }
}
