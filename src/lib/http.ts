import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from './domain';
export function failure(error: unknown) {
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: 'JSON không hợp lệ' }, { status: 400 });
  console.error('Request failed', error instanceof Error ? error.name : 'Unknown');
  return NextResponse.json({ error: 'Không thể xử lý yêu cầu. Vui lòng thử lại.' }, { status: 500 });
}
export async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('Thiếu dữ liệu');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256_000) { await reader.cancel(); throw new AppError('Dữ liệu vượt giới hạn 256 KB', 413); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
