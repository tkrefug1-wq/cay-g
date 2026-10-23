import { NextResponse } from 'next/server';
import { z } from 'zod';
import { checkOrigin, requireUser } from '@/lib/auth';
import { failure, readBody } from '@/lib/http';
import { exportKeys } from '@/lib/queries';

const schema = z.object({ ids: z.array(z.string().min(1).max(100)).min(1).max(500) });

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { ids } = schema.parse(await readBody(request));
    return NextResponse.json({ lines: await exportKeys(await requireUser(), ids) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error);
  }
}
