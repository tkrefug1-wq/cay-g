import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { Actor, AppError, amountSchema, dateSchema, day, decimal, ensure, finance, parseData } from './domain';
import { commandFingerprint, encrypt, hashPassword } from './security';
type Tx = Prisma.TransactionClient;
const idsSchema = z.array(z.string().min(1).max(100)).min(1).max(5000).transform(a => [...new Set(a)]);
const base = z.object({ date: dateSchema });
export const commandSchema = z.discriminatedUnion('action', [
  base.extend({ action: z.literal('start'), platformId: z.string(), count: z.number().int().min(1).max(500), deposit: amountSchema, data: z.string().max(200_000).default('') }),
  z.object({ action: z.literal('import'), data: z.string().max(200_000), ownerId: z.string().nullable().optional() }),
  z.object({ action: z.literal('assign'), ids: idsSchema, ownerId: z.string() }),
  z.object({ action: z.literal('withdraw'), usageId: z.string(), withdrawal: amountSchema }),
  base.extend({ action: z.literal('removeToday'), ids: idsSchema }),
  z.object({ action: z.literal('deleteKeys'), ids: idsSchema }),
  z.object({ action: z.literal('editKey'), id: z.string(), data: z.string().max(3000) }),
  base.extend({ action: z.literal('close') }),
  z.object({ action: z.literal('transition'), settlementId: z.string(), target: z.enum(['CLOSED', 'APPROVED', 'PAID']) }),
  z.object({ action: z.literal('platform'), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('platformRename'), id: z.string(), name: z.string().trim().min(1).max(80) }),
  z.object({ action: z.literal('platformDelete'), id: z.string() }),
  z.object({ action: z.literal('worker'), name: z.string().trim().min(1).max(100), email: z.email().max(200), password: z.string().min(12).max(200), role: z.enum(['CTV', 'CTV_CON']), parentCtvId: z.string().nullable() }),
  z.object({ action: z.literal('workerUpdate'), id: z.string(), name: z.string().trim().min(1).max(100), email: z.email().max(200), password: z.string().min(12).max(200).optional(), role: z.enum(['CTV', 'CTV_CON']), parentCtvId: z.string().nullable() }),
  z.object({ action: z.literal('workerDisable'), id: z.string() }),
]);
export type Command = z.infer<typeof commandSchema>;
async function audit(tx: Tx, actor: Actor, action: string, entityId: string, detail: Prisma.InputJsonValue = {}) {
  await tx.audit.create({ data: { actorId: actor.id, action, entityId, detail } });
}
function admin(actor: Actor) { ensure(actor.role === 'ADMIN', 'Chỉ Admin được thực hiện', 403); }
function worker(actor: Actor) { ensure(actor.role !== 'ADMIN', 'Thao tác dành cho CTV', 403); }
async function checkDay(tx: Tx, workerId: string, date: string) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: workerId } });
  ensure(user.active && user.role !== 'ADMIN', 'Người nhận không hợp lệ');
  const own = await tx.settlement.findUnique({ where: { workerId_date: { workerId, date } } });
  ensure(!own || own.status === 'OPEN', 'Ngày đã CLOSED/APPROVED/PAID, không thể sửa', 409);
  if (user.parentCtvId) {
    const parent = await tx.settlement.findUnique({ where: { workerId_date: { workerId: user.parentCtvId, date } } });
    ensure(!parent || parent.status === 'OPEN', 'CTV cha đã chốt ngày, không thể thay đổi hoa hồng', 409);
  }
  return user;
}
async function importKeys(tx: Tx, actor: Actor, text: string, ownerId: string | null, today: boolean) {
  const data = parseData(text);
  if (ownerId) await checkDay(tx, ownerId, day());
  const accounts = data.map(d => d.normalizedStk);
  const existing = await tx.key.findMany({ where: { normalizedStk: { in: accounts } } });
  for (const key of existing) {
    ensure(!key.archived, `STK ${key.normalizedStk} đã lưu trữ, không thể sử dụng`, 409);
    ensure(key.ownerId === ownerId || key.ownerId === null, `STK ${key.normalizedStk} đã thuộc người khác; không thể nhận lại`, 409);
  }
  const found = new Set(existing.map(k => k.normalizedStk));
  const fresh = data.filter(d => !found.has(d.normalizedStk));
  if (fresh.length) await tx.key.createMany({ data: fresh.map(d => ({ ...d, id: randomUUID(), password: encrypt(d.password), pin: encrypt(d.pin), ownerId })) });
  if (ownerId) await tx.key.updateMany({ where: { normalizedStk: { in: accounts }, ownerId: null }, data: { ownerId } });
  const keys = await tx.key.findMany({ where: { normalizedStk: { in: accounts } }, select: { id: true } });
  if (today && ownerId) {
    await tx.todayEntry.createMany({ data: keys.map(k => ({ keyId: k.id, date: day() })), skipDuplicates: true });
    await tx.todayEntry.updateMany({ where: { keyId: { in: keys.map(k => k.id) }, date: day() }, data: { visible: true } });
  }
  await audit(tx, actor, 'IMPORT', ownerId ?? 'unassigned', { created: fresh.length, reused: existing.length });
  return { created: fresh.length, reused: existing.length };
}
export async function calculate(tx: Tx, workerId: string, date: string) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: workerId } });
  const [sum, incomplete, children] = await Promise.all([
    tx.usage.aggregate({ where: { settlement: { workerId, date }, status: { not: 'CANCELLED' } }, _sum: { deposit: true, withdrawal: true } }),
    tx.usage.count({ where: { settlement: { workerId, date }, status: 'ACTIVE' } }),
    user.role === 'CTV' ? tx.settlement.findMany({ where: { date, worker: { parentCtvId: workerId } }, include: { usages: { where: { status: { not: 'CANCELLED' } }, select: { deposit: true, withdrawal: true } } } }) : Promise.resolve([]),
  ]);
  const commission = children.reduce((total, s) => {
    if (s.status !== 'OPEN') return total.plus(s.parentCommission);
    const d = s.usages.reduce((x, u) => x.plus(u.deposit), decimal(0));
    const w = s.usages.reduce((x, u) => x.plus(u.withdrawal), decimal(0));
    return total.plus(finance(d, w, 'CTV_CON').parentCommission);
  }, decimal(0));
  return { ...finance(sum._sum.deposit ?? 0, sum._sum.withdrawal ?? 0, user.role, commission), incomplete };
}
async function closeDay(tx: Tx, actor: Actor, workerId: string, date: string) {
  await checkDay(tx, workerId, date);
  ensure(date <= day(), 'Không chốt ngày tương lai');
  const openChildren = await tx.settlement.count({ where: { date, status: 'OPEN', worker: { parentCtvId: workerId }, usages: { some: { status: { not: 'CANCELLED' } } } } });
  ensure(openChildren === 0, 'CTV con có phát sinh phải chốt trước CTV cha', 409);
  const { incomplete, ...totals } = await calculate(tx, workerId, date);
  ensure(incomplete === 0, `Còn ${incomplete} Platform chưa hoàn thành`, 409);
  const settlement = await tx.settlement.upsert({ where: { workerId_date: { workerId, date } }, create: { workerId, date, ...totals, status: 'CLOSED', closedAt: new Date() }, update: { ...totals, status: 'CLOSED', closedAt: new Date() } });
  await audit(tx, actor, 'CLOSED', settlement.id, JSON.parse(JSON.stringify(totals)));
  return { id: settlement.id, status: settlement.status };
}
async function execute(tx: Tx, actor: Actor, cmd: Command): Promise<Prisma.InputJsonObject> {
  switch (cmd.action) {
    case 'start': {
      worker(actor);
      ensure(cmd.date === day(), 'Chỉ bắt đầu Platform trong hôm nay');
      ensure(decimal(cmd.deposit).gt(0), 'Nạp/Key phải lớn hơn 0');
      await checkDay(tx, actor.id, cmd.date);
      const platform = await tx.platform.findUnique({ where: { id: cmd.platformId } });
      ensure(platform?.active, 'Platform không khả dụng');
      let imported = { created: 0, reused: 0 };
      if (cmd.data.trim()) imported = await importKeys(tx, actor, cmd.data, actor.id, false);
      const keys = await tx.key.findMany({ where: { ownerId: actor.id, archived: false, usages: { none: { platformId: cmd.platformId, status: { not: 'CANCELLED' } } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: cmd.count, select: { id: true } });
      ensure(keys.length === cmd.count, `Key có sẵn: ${keys.length}. Thiếu: ${cmd.count - keys.length}. Dán thêm Data.`, 409);
      const settlement = await tx.settlement.upsert({ where: { workerId_date: { workerId: actor.id, date: cmd.date } }, create: { workerId: actor.id, date: cmd.date }, update: {} });
      if (actor.parentCtvId) await tx.settlement.upsert({ where: { workerId_date: { workerId: actor.parentCtvId, date: cmd.date } }, create: { workerId: actor.parentCtvId, date: cmd.date }, update: {} });
      const keyIds = keys.map(k => k.id);
      const previous = await tx.usage.findMany({ where: { keyId: { in: keyIds }, platformId: cmd.platformId }, select: { keyId: true } });
      const oldIds = previous.map(u => u.keyId);
      if (oldIds.length) await tx.usage.updateMany({ where: { keyId: { in: oldIds }, platformId: cmd.platformId, status: 'CANCELLED' }, data: { settlementId: settlement.id, deposit: cmd.deposit, withdrawal: 0, status: 'ACTIVE', completedAt: null } });
      const old = new Set(oldIds);
      await tx.usage.createMany({ data: keyIds.filter(id => !old.has(id)).map(keyId => ({ keyId, platformId: cmd.platformId, settlementId: settlement.id, deposit: cmd.deposit })) });
      await tx.todayEntry.createMany({ data: keyIds.map(keyId => ({ keyId, date: cmd.date })), skipDuplicates: true });
      await tx.todayEntry.updateMany({ where: { keyId: { in: keyIds }, date: cmd.date }, data: { visible: true } });
      await audit(tx, actor, 'START', settlement.id, { platformId: cmd.platformId, keyIds, deposit: cmd.deposit });
      return { started: keys.length, ...imported };
    }
    case 'import': {
      if (actor.role !== 'ADMIN') ensure(!cmd.ownerId || cmd.ownerId === actor.id, 'Không được giao Data cho người khác', 403);
      return importKeys(tx, actor, cmd.data, actor.role === 'ADMIN' ? cmd.ownerId ?? null : actor.id, actor.role === 'ADMIN');
    }
    case 'assign': {
      admin(actor);
      await checkDay(tx, cmd.ownerId, day());
      const keys = await tx.key.findMany({ where: { id: { in: cmd.ids } }, include: { _count: { select: { usages: true } } } });
      ensure(keys.length === cmd.ids.length, 'Không tìm thấy Data');
      ensure(keys.every(k => !k.archived && (!k._count.usages || k.ownerId === cmd.ownerId)), 'Data có lịch sử không được đổi chủ', 409);
      await tx.key.updateMany({ where: { id: { in: cmd.ids } }, data: { ownerId: cmd.ownerId } });
      await tx.todayEntry.createMany({ data: cmd.ids.map(keyId => ({ keyId, date: day() })), skipDuplicates: true });
      await tx.todayEntry.updateMany({ where: { keyId: { in: cmd.ids }, date: day() }, data: { visible: true } });
      await audit(tx, actor, 'ASSIGN', cmd.ownerId, { keyIds: cmd.ids });
      return { assigned: keys.length };
    }
    case 'withdraw': {
      worker(actor);
      const usage = await tx.usage.findUnique({ where: { id: cmd.usageId }, include: { settlement: true } });
      ensure(usage && usage.settlement.workerId === actor.id, 'Không có quyền với lượt chạy này', 403);
      await checkDay(tx, actor.id, usage.settlement.date);
      ensure(usage.status !== 'CANCELLED', 'Lượt chạy đã hủy', 409);
      await tx.usage.update({ where: { id: usage.id }, data: { withdrawal: cmd.withdrawal, status: 'DONE', completedAt: new Date() } });
      await audit(tx, actor, 'WITHDRAWAL', usage.id, { before: usage.withdrawal.toString(), after: cmd.withdrawal });
      return { done: true };
    }
    case 'removeToday': {
      worker(actor);
      await checkDay(tx, actor.id, cmd.date);
      const keys = await tx.key.findMany({ where: { id: { in: cmd.ids }, ownerId: actor.id }, select: { id: true } });
      ensure(keys.length === cmd.ids.length, 'Không có quyền với Data/Key', 403);
      await tx.usage.updateMany({ where: { keyId: { in: cmd.ids }, settlement: { workerId: actor.id, date: cmd.date }, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
      await tx.todayEntry.updateMany({ where: { keyId: { in: cmd.ids }, date: cmd.date }, data: { visible: false } });
      await audit(tx, actor, 'REMOVE_TODAY', actor.id, { keyIds: cmd.ids, date: cmd.date });
      return { removed: keys.length };
    }
    case 'deleteKeys': {
      const keys = await tx.key.findMany({ where: { id: { in: cmd.ids }, ...(actor.role !== 'ADMIN' ? { ownerId: actor.id } : {}) }, include: { _count: { select: { usages: true } } } });
      ensure(keys.length === cmd.ids.length, 'Không có quyền với Key', 403);
      const unused = keys.filter(k => !k._count.usages).map(k => k.id), used = keys.filter(k => k._count.usages).map(k => k.id);
      if (unused.length) await tx.key.deleteMany({ where: { id: { in: unused } } });
      if (used.length) await tx.key.updateMany({ where: { id: { in: used } }, data: { archived: true } });
      await audit(tx, actor, 'DELETE_ARCHIVE_KEYS', actor.id, { deleted: unused, archived: used });
      return { deleted: unused.length, archived: used.length };
    }
    case 'editKey': {
      ensure(cmd.data.split('|').length === 10 && !cmd.data.includes('\n'), 'Key phải có đúng 10 field');
      const [input] = parseData(cmd.data);
      const key = await tx.key.findUnique({ where: { id: cmd.id }, include: { usages: { where: { settlement: { status: { not: 'OPEN' } } }, take: 1 } } });
      ensure(key && (actor.role === 'ADMIN' || key.ownerId === actor.id), 'Không có quyền với Key', 403);
      ensure(!key.archived && !key.usages.length, 'Key lưu trữ hoặc có ngày đã chốt: khóa sửa', 409);
      ensure(input.normalizedStk === key.normalizedStk, 'Không thay đổi STK của master Key');
      await tx.key.update({ where: { id: cmd.id }, data: { ...input, password: encrypt(input.password), pin: encrypt(input.pin) } });
      await audit(tx, actor, 'EDIT_KEY', key.id);
      return { updated: true };
    }
    case 'close': {
      worker(actor);
      return closeDay(tx, actor, actor.id, cmd.date);
    }
    case 'transition': {
      admin(actor);
      const s = await tx.settlement.findUnique({ where: { id: cmd.settlementId } });
      ensure(s, 'Không tìm thấy đối soát', 404);
      if (cmd.target === 'CLOSED') return closeDay(tx, actor, s.workerId, s.date);
      ensure((s.status === 'CLOSED' && cmd.target === 'APPROVED') || (s.status === 'APPROVED' && cmd.target === 'PAID'), 'Sai thứ tự OPEN → CLOSED → APPROVED → PAID', 409);
      await tx.settlement.update({ where: { id: s.id }, data: { status: cmd.target, ...(cmd.target === 'PAID' ? { paidAt: new Date() } : {}) } });
      await audit(tx, actor, cmd.target, s.id, { payout: s.payout.toString(), before: s.status, after: cmd.target });
      return { status: cmd.target };
    }
    case 'platform': {
      admin(actor);
      const platform = await tx.platform.create({ data: { name: cmd.name } });
      await audit(tx, actor, 'CREATE_PLATFORM', platform.id);
      return { id: platform.id };
    }
    case 'platformRename': {
      admin(actor);
      const platform = await tx.platform.findUnique({ where: { id: cmd.id } });
      ensure(platform, 'Không tìm thấy Platform', 404);
      await tx.platform.update({ where: { id: cmd.id }, data: { name: cmd.name } });
      await audit(tx, actor, 'RENAME_PLATFORM', cmd.id, { before: platform.name, after: cmd.name });
      return { updated: true };
    }
    case 'platformDelete': {
      admin(actor);
      const platform = await tx.platform.findUnique({ where: { id: cmd.id }, include: { _count: { select: { usages: true } } } });
      ensure(platform, 'Không tìm thấy Platform', 404);
      if (platform._count.usages) await tx.platform.update({ where: { id: cmd.id }, data: { active: false } });
      else await tx.platform.delete({ where: { id: cmd.id } });
      await audit(tx, actor, platform._count.usages ? 'ARCHIVE_PLATFORM' : 'DELETE_PLATFORM', cmd.id, { name: platform.name, usages: platform._count.usages });
      return { deleted: !platform._count.usages, archived: !!platform._count.usages };
    }
    case 'worker': {
      admin(actor);
      ensure(cmd.role === 'CTV_CON' ? !!cmd.parentCtvId : !cmd.parentCtvId, 'CTV con bắt buộc có CTV cha');
      if (cmd.parentCtvId) {
        const parent = await tx.user.findUnique({ where: { id: cmd.parentCtvId } });
        ensure(parent?.role === 'CTV' && parent.active, 'CTV cha không hợp lệ');
      }
      const user = await tx.user.create({ data: { name: cmd.name, email: cmd.email.toLowerCase(), passwordHash: await hashPassword(cmd.password), role: cmd.role, parentCtvId: cmd.parentCtvId } });
      await audit(tx, actor, 'CREATE_WORKER', user.id, { role: cmd.role });
      return { id: user.id };
    }
    case 'workerUpdate': {
      admin(actor); ensure(cmd.id !== actor.id, 'Không thể sửa tài khoản hiện tại', 409); ensure(cmd.role === 'CTV_CON' ? !!cmd.parentCtvId : !cmd.parentCtvId, 'CTV con bắt buộc có CTV cha');
      const target = await tx.user.findUnique({ where: { id: cmd.id } }); ensure(target && target.role !== 'ADMIN', 'Không tìm thấy CTV', 404);
      if (cmd.parentCtvId) { const parent = await tx.user.findUnique({ where: { id: cmd.parentCtvId } }); ensure(parent?.role === 'CTV' && parent.active, 'CTV cha không hợp lệ', 409); }
      const data: Prisma.UserUpdateInput = { name: cmd.name, email: cmd.email.toLowerCase(), role: cmd.role, parent: cmd.parentCtvId ? { connect: { id: cmd.parentCtvId } } : { disconnect: true } };
      if (cmd.password) data.passwordHash = await hashPassword(cmd.password);
      await tx.user.update({ where: { id: cmd.id }, data }); await audit(tx, actor, 'UPDATE_WORKER', cmd.id, { role: cmd.role }); return { updated: true };
    }
    case 'workerDisable': {
      admin(actor); ensure(cmd.id !== actor.id, 'Không thể vô hiệu hóa tài khoản hiện tại', 409); const target = await tx.user.findUnique({ where: { id: cmd.id } }); ensure(target && target.role !== 'ADMIN', 'Không tìm thấy CTV', 404);
      await tx.user.update({ where: { id: cmd.id }, data: { active: false } }); await tx.session.deleteMany({ where: { userId: cmd.id } }); await audit(tx, actor, 'DISABLE_WORKER', cmd.id, { name: target.name }); return { disabled: true };
    }
  }
}
export async function mutate(actor: Actor, raw: unknown, requestId: string) {
  ensure(/^[a-zA-Z0-9_-]{16,100}$/.test(requestId), 'Thiếu Idempotency-Key hợp lệ');
  const cmd = commandSchema.parse(raw), fingerprint = commandFingerprint(JSON.stringify(cmd)), id = `${actor.id}:${requestId}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await db.$transaction(async tx => {
        const freshActor = await tx.user.findUnique({ where: { id: actor.id } });
        ensure(freshActor?.active, 'Tài khoản không còn hoạt động', 401);
        const previous = await tx.idempotency.findUnique({ where: { id } });
        if (previous) { ensure(previous.fingerprint === fingerprint, 'Idempotency-Key đã dùng với nội dung khác', 409); return previous.result; }
        const result = await execute(tx, freshActor, cmd);
        await tx.idempotency.create({ data: { id, actorId: actor.id, fingerprint, result } });
        return result;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code) && attempt < 3) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new AppError('Dữ liệu trùng hoặc đang được xử lý; tải lại và thử lại', 409);
      throw error;
    }
  }
  throw new AppError('Xung đột giao dịch, vui lòng thử lại', 409);
}
