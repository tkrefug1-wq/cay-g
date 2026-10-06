import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { keyDetail } from '@/lib/queries';
import { failure } from '@/lib/http';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await keyDetail(await requireUser(), (await context.params).id), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return failure(error); }
}
