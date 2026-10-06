import 'dotenv/config';
import { db } from '../src/lib/db';
import { hashPassword } from '../src/lib/security';
import { mutate } from '../src/lib/service';
import { day } from '../src/lib/domain';
async function main() {
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error('Set DEMO_PASSWORD (12+ characters)');
  const passwordHash = await hashPassword(password);
  const admin = await db.user.upsert({ where: { email: 'admin@cayg.local' }, create: { name: 'Admin', email: 'admin@cayg.local', role: 'ADMIN', passwordHash }, update: {} });
  const ctv = await db.user.upsert({ where: { email: 'ctv@cayg.local' }, create: { name: 'Minh Anh', email: 'ctv@cayg.local', role: 'CTV', passwordHash }, update: {} });
  const child = await db.user.upsert({ where: { email: 'con@cayg.local' }, create: { name: 'Thu Hà', email: 'con@cayg.local', role: 'CTV_CON', parentCtvId: ctv.id, passwordHash }, update: {} });
  const platforms = await Promise.all(['Platform A', 'Platform B', 'Platform C'].map(name => db.platform.upsert({ where: { name }, create: { name }, update: {} })));
  // Idempotent demo seed: repeat runs never overwrite real financial edits.
  if (await db.idempotency.findUnique({ where: { id: `${admin.id}:demo-seed-import-v1` } })) return;
  const names = ['Nguyễn Minh Anh', 'Trần Hoàng Nam', 'Lê Thu Hà', 'Phạm Quốc Huy', 'Vũ Ngọc Linh', 'Đặng Thanh Tùng', 'Bùi Hải Yến', 'Đỗ Gia Bảo', 'Ngô Phương Thảo', 'Lý Đức Anh', 'Hồ Tuấn Kiệt', 'Dương Bảo Ngọc'];
  const banks = ['Vietcombank', 'Techcombank', 'MB Bank', 'BIDV'];
  await mutate(admin, { action: 'import', ownerId: ctv.id, data: names.map((n, i) => `${n}|90000000${String(i + 1).padStart(2, '0')}|${banks[i % banks.length]}`).join('\n') }, 'demo-seed-import-v1');
  await mutate(admin, { action: 'import', ownerId: child.id, data: ['Trần Bích Ngọc|9100000001|ACB', 'Nguyễn Đức Minh|9100000002|VPBank', 'Lê Thanh Mai|9100000003|BIDV'].join('\n') }, 'demo-child-import-v1');
  await mutate(ctv, { action: 'start', date: day(), platformId: platforms[0].id, count: 6, deposit: '100' }, 'demo-ctv-start-a-v1');
  await mutate(ctv, { action: 'start', date: day(), platformId: platforms[1].id, count: 3, deposit: '300' }, 'demo-ctv-start-b-v1');
  const usages = await db.usage.findMany({ where: { settlement: { workerId: ctv.id }, platformId: platforms[0].id }, orderBy: { keyId: 'asc' }, take: 4 });
  for (const [i, u] of usages.entries()) await mutate(ctv, { action: 'withdraw', usageId: u.id, withdrawal: String([200, 180, 250, 150][i]) }, `demo-withdraw-${i}-v1`);
  await mutate(child, { action: 'start', date: day(), platformId: platforms[0].id, count: 2, deposit: '100' }, 'demo-child-start-v1');
  console.log('Demo ready: admin@cayg.local / ctv@cayg.local / con@cayg.local');
}
main().finally(() => db.$disconnect());
