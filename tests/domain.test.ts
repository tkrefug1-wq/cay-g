import 'dotenv/config';
import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Actor } from '../src/lib/domain';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || testUrl === process.env.DATABASE_URL || !new URL(testUrl).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a separate *_test database');
process.env.DATABASE_URL = testUrl;
const { db } = await import('../src/lib/db');
const { mutate, calculate } = await import('../src/lib/service');
const { day, finance, parseData } = await import('../src/lib/domain');
const { snapshot, keyDetail } = await import('../src/lib/queries');
const { hashPassword, encrypt, decrypt } = await import('../src/lib/security');
const { signIn } = await import('../src/lib/auth');
let admin: Actor, ctv: Actor, child: Actor, other: Actor, platform: string, platformB: string;
const call = (a: Actor, body: object, id = randomUUID()) => mutate(a, body, id);
const importData = (a = ctv, count = 1, offset = 0) => call(a, { action: 'import', data: Array.from({ length: count }, (_, i) => `Person ${i}|001234${String(i + offset).padStart(4, '0')}|VCB`).join('\n') });
const start = (a = ctv, count = 1, p = platform, extra = {}) => call(a, { action: 'start', date: day(), platformId: p, count, deposit: '100', ...extra });
async function usage(a = ctv) { return db.usage.findFirstOrThrow({ where: { settlement: { workerId: a.id }, status: { not: 'CANCELLED' } } }); }
const finish = async (a = ctv, withdrawal = '200') => call(a, { action: 'withdraw', usageId: (await usage(a)).id, withdrawal });
before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: process.env, stdio: 'pipe' });
});
beforeEach(async () => {
  await db.$executeRawUnsafe('TRUNCATE "Audit", "Idempotency", "TodayEntry", "Usage", "Settlement", "Key", "Session", "LoginAttempt", "Platform", "User" CASCADE');
  const passwordHash = await hashPassword('Test-Password-2026!');
  admin = await db.user.create({ data: { name: 'Admin', email: 'admin@test.local', passwordHash, role: 'ADMIN' } });
  ctv = await db.user.create({ data: { name: 'Parent', email: 'ctv@test.local', passwordHash, role: 'CTV' } });
  child = await db.user.create({ data: { name: 'Child', email: 'child@test.local', passwordHash, role: 'CTV_CON', parentCtvId: ctv.id } });
  other = await db.user.create({ data: { name: 'Other', email: 'other@test.local', passwordHash, role: 'CTV' } });
  platform = (await db.platform.create({ data: { name: 'A' } })).id;
  platformB = (await db.platform.create({ data: { name: 'B' } })).id;
});
after(async () => { await db.$disconnect(); });
test('STK digits-only, global uniqueness, reuse master without overwriting', async () => {
  await call(ctv, { action: 'import', data: 'A|001 234-0000|VCB' });
  await call(ctv, { action: 'import', data: 'Changed|0012340000|Other' });
  assert.equal(await db.key.count(), 1); assert.equal((await db.key.findFirstOrThrow()).fullName, 'A');
  await assert.rejects(importData(other), /người khác/);
  await assert.rejects(db.key.create({ data: { fullName: 'x', normalizedStk: '0012340000', bank: 'x' } }));
});
test('duplicate lines and wrong field counts reject entire bulk', async () => {
  assert.throws(() => parseData('A|123|VCB\nB|1-23|MB'), /lặp/);
  assert.throws(() => parseData('A|123|VCB|extra'), /3 hoặc 10/);
  await assert.rejects(call(ctv, { action: 'import', data: 'A|123|VCB\nB||MB' })); assert.equal(await db.key.count(), 0);
});
test('DONE cannot run again on same platform; different platforms work; old keys auto selected', async () => {
  await importData(); await start(); const first = await usage(); await finish();
  await assert.rejects(start(), /Thiếu: 1/);
  await start(ctv, 1, platformB); assert.equal(await db.key.count(), 1);
  assert.equal(await db.usage.count({ where: { keyId: first.keyId } }), 2);
  const snap = await snapshot(ctv, new URLSearchParams({ view: 'today' }));
  assert.equal(snap.total, 1);
});
test('short 5 paste 10: use 5, keep extra 5 in inventory', async () => {
  await start(ctv, 5, platform, { data: Array.from({ length: 10 }, (_, i) => `P${i}|100000${i}|VCB`).join('\n') });
  assert.equal(await db.key.count(), 10); assert.equal(await db.usage.count(), 5); assert.equal(await db.todayEntry.count(), 5);
});
test('insufficient bulk or foreign ownership rolls back everything', async () => {
  await assert.rejects(start(ctv, 5, platform, { data: 'A|12345|VCB' })); assert.equal(await db.key.count(), 0);
  await importData(other);
  await assert.rejects(start(ctv, 2, platform, { data: 'New|999999|VCB\nOther|0012340000|VCB' })); assert.equal(await db.key.count(), 1);
});
test('new Platform immediately makes old Key eligible', async () => {
  await importData(); await start(); await finish();
  const result = await call(admin, { action: 'platform', name: 'New' }) as { id: string };
  await start(ctv, 1, result.id); assert.equal(await db.key.count(), 1);
});
test('withdrawal can change after DONE before CLOSED, including zero', async () => {
  await importData(); await start(); await finish(); await finish(ctv, '0');
  assert.equal((await usage()).withdrawal.toString(), '0'); assert.equal((await usage()).status, 'DONE');
});
test('CLOSED blocks worker edits and PostgreSQL direct edits', async () => {
  await importData(); await start(); await finish(); await call(ctv, { action: 'close', date: day() });
  await assert.rejects(finish(), /CLOSED/); await assert.rejects(start(), /CLOSED/);
  await assert.rejects(db.usage.update({ where: { id: (await usage()).id }, data: { withdrawal: 999 } }));
  const key = await db.key.findFirstOrThrow();
  await assert.rejects(call(ctv, { action: 'editKey', id: key.id, data: `New|${key.normalizedStk}|VCB|||||||` }), /khóa sửa/);
});
test('cannot close incomplete day', async () => {
  await importData(); await start(); await assert.rejects(call(ctv, { action: 'close', date: day() }), /chưa hoàn thành/);
});
test('unused Key hard delete; historical Key archive only', async () => {
  await importData(ctv, 2); const keys = await db.key.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  await start(); await finish();
  const usedId = (await usage()).keyId, unusedId = keys.find(k => k.id !== usedId)!.id;
  await call(ctv, { action: 'deleteKeys', ids: [unusedId, usedId] });
  assert.equal(await db.key.count(), 1); assert.equal((await db.key.findUniqueOrThrow({ where: { id: usedId } })).archived, true);
  assert.equal(await db.usage.count(), 1);
});
test('remove today hides DONE without deleting financial history; cancels ACTIVE', async () => {
  await importData(); await start(); await finish(); await start(ctv, 1, platformB);
  await call(ctv, { action: 'removeToday', date: day(), ids: [(await usage()).keyId] });
  assert.equal(await db.usage.count({ where: { status: 'DONE' } }), 1); assert.equal(await db.usage.count({ where: { status: 'CANCELLED' } }), 1);
  const totals = await calculate(db, ctv.id, day()); assert.equal(totals.deposit.toString(), '100');
  await start(ctv, 1, platformB); assert.equal(await db.usage.count(), 2);
});
test('fee, profit, CTV and CTV_CON splits, negative profits, decimal precision', () => {
  const parent = finance(100, 200, 'CTV'); assert.equal(parent.fee.toString(), '20'); assert.equal(parent.profit.toString(), '80'); assert.equal(parent.payout.toString(), '140');
  const con = finance(100, 200, 'CTV_CON'); assert.equal(con.payout.toString(), '129.6'); assert.equal(con.parentCommission.toString(), '10.4'); assert.equal(con.adminShare.toString(), '40');
  assert.equal(finance(100, 0, 'CTV').payout.toString(), '50'); assert.equal(finance(100, 0, 'CTV_CON').payout.toString(), '63');
  assert.equal(finance('0.01', '0.03', 'CTV_CON').payout.toString(), '0.0163');
});
test('settlement freezes correct payout incl child commission and mandatory close order', async () => {
  await importData(); await start(); await finish(); await importData(child, 1, 20); await start(child); await finish(child);
  await assert.rejects(call(ctv, { action: 'close', date: day() }), /CTV con/);
  await call(child, { action: 'close', date: day() }); await call(ctv, { action: 'close', date: day() });
  const s = await db.settlement.findUniqueOrThrow({ where: { workerId_date: { workerId: ctv.id, date: day() } } });
  assert.equal(s.payout.toString(), '150.4'); assert.equal(s.childCommission.toString(), '10.4');
  const c = await db.settlement.findUniqueOrThrow({ where: { workerId_date: { workerId: child.id, date: day() } } }); assert.equal(c.payout.toString(), '129.6');
  const snap = await snapshot(admin, new URLSearchParams({ view: 'settlements', workerId: ctv.id }));
  assert.equal(snap.settlements?.[0].payout.toString(), '150.4');
});
test('parent-only commission creates settlement, parent CLOSED blocks new child activity', async () => {
  await importData(child); await start(child); await finish(child); await call(child, { action: 'close', date: day() }); await call(ctv, { action: 'close', date: day() });
  assert.equal((await db.settlement.findUniqueOrThrow({ where: { workerId_date: { workerId: ctv.id, date: day() } } })).payout.toString(), '10.4');
  const newChild = await db.user.create({ data: { name: 'Other child', email: 'otherchild@test.local', passwordHash: 'x', role: 'CTV_CON', parentCtvId: ctv.id } });
  await assert.rejects(importData(newChild, 1, 99), /cha đã chốt/);
});
test('PAID locks financial snapshot and audit is append-only', async () => {
  await importData(); await start(); await finish(); const close = await call(ctv, { action: 'close', date: day() }) as { id: string };
  await assert.rejects(call(admin, { action: 'transition', settlementId: close.id, target: 'PAID' }), /Sai thứ tự/);
  await call(admin, { action: 'transition', settlementId: close.id, target: 'APPROVED' });
  await call(admin, { action: 'transition', settlementId: close.id, target: 'PAID' });
  await assert.rejects(finish()); await assert.rejects(db.settlement.update({ where: { id: close.id }, data: { payout: 0 } }));
  const audit = await db.audit.findFirstOrThrow({ where: { action: 'PAID' } }); assert.equal((audit.detail as { payout: string }).payout, '140');
  await assert.rejects(db.audit.delete({ where: { id: audit.id } }));
});
test('RBAC, ownership, role spoofing and data minimization', async () => {
  await importData(); await start();
  await assert.rejects(call(other, { action: 'withdraw', usageId: (await usage()).id, withdrawal: '200' }), /quyền/);
  await assert.rejects(call(ctv, { action: 'platform', name: 'X' }), /Admin/);
  await assert.rejects(call({ ...ctv, role: 'ADMIN' }, { action: 'platform', name: 'X' }), /Admin/);
  await assert.rejects(snapshot(ctv, new URLSearchParams({ view: 'data' })), /quyền/);
  await assert.rejects(keyDetail(other, (await usage()).keyId), /quyền/);
  const snap = await snapshot(other, new URLSearchParams({ view: 'inventory' })); assert.equal(snap.total, 0);
  await assert.rejects(call(admin, { action: 'assign', ids: [(await usage()).keyId], ownerId: other.id }), /lịch sử/);
});
test('idempotency replay and content mismatch', async () => {
  await importData(ctv, 2); const id = randomUUID();
  const body = { action: 'start', date: day(), platformId: platform, count: 1, deposit: '100' };
  const first = await call(ctv, body, id); assert.deepEqual(await call(ctv, body, id), first); assert.equal(await db.usage.count(), 1);
  await assert.rejects(call(ctv, { ...body, count: 2 }, id), /nội dung khác/);
});
test('concurrent bulk and same idempotency key never duplicate usage', async () => {
  await importData(ctv, 4);
  const id = randomUUID(), body = { action: 'start', date: day(), platformId: platform, count: 2, deposit: '100' };
  const results = await Promise.all([call(ctv, body, id), call(ctv, body, id)]); assert.deepEqual(results[0], results[1]); assert.equal(await db.usage.count(), 2);
  await Promise.all([start(), start()]); assert.equal(await db.usage.count(), 4);
});
test('Admin can assign directly to child and cannot steal historical keys', async () => {
  await call(admin, { action: 'import', data: 'Assigned|456789|MB', ownerId: child.id });
  assert.equal((await db.key.findFirstOrThrow()).ownerId, child.id);
  assert.equal((await snapshot(child, new URLSearchParams({ view: 'today' }))).total, 1);
});
test('Key has exactly ten fields and secrets are encrypted at rest', async () => {
  await call(ctv, { action: 'import', data: 'Name|123456|VCB|HCM|account|secret123|1234|0901234567|x@example.com|2000-01-01' });
  const key = await db.key.findFirstOrThrow(); assert.notEqual(key.password, 'secret123');
  const detail = await keyDetail(ctv, key.id); assert.equal(detail.fields.length, 10); assert.equal(detail.fields[5], 'secret123');
  assert.equal(decrypt(encrypt('secret')), 'secret');
});
test('database sessions and login throttling', async () => {
  const login = await signIn('CTV@TEST.LOCAL', 'Test-Password-2026!'); assert.equal(login.token.length, 64); assert.equal(login.mfa, null); assert.equal(await db.session.count(), 1);
  for (let i = 0; i < 9; i++) await assert.rejects(signIn('ctv@test.local', 'wrong'), /không đúng/);
  await assert.rejects(signIn('ctv@test.local', 'wrong'), /15 phút/);
});
