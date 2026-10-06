import 'dotenv/config';
import { z } from 'zod';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/security';
async function main() {
  const email = z.email().max(200).parse(process.env.ADMIN_EMAIL).toLowerCase();
  const name = z.string().min(1).max(100).parse(process.env.ADMIN_NAME ?? 'Admin');
  const password = z.string().min(12).max(200).parse(process.env.ADMIN_PASSWORD);
  await db.user.create({ data: { name, email, passwordHash: await hashPassword(password), role: 'ADMIN' } });
  console.log(`Admin created: ${email}`);
}
main().catch(() => { console.error('Cannot create admin: verify ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD and unique email.'); process.exitCode = 1; }).finally(() => db.$disconnect());
