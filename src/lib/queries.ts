import { Prisma } from '@prisma/client';
import { db } from './db';
import { Actor, dateSchema, day, decimal, ensure, finance } from './domain';
import { decrypt } from './security';
import { calculate } from './service';
export async function snapshot(actor: Actor, params: URLSearchParams) {
  const view = params.get('view') ?? (actor.role === 'ADMIN' ? 'data' : 'today');
  ensure(actor.role === 'ADMIN' ? ['data', 'settlements'].includes(view) : ['today', 'inventory', 'summary'].includes(view), 'Không có quyền xem trang', 403);
  const date = dateSchema.parse(params.get('date') ?? day());
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1)), pageSize = 50;
  const search = (params.get('search') ?? '').slice(0, 100);
  return db.$transaction(async tx => {
    const [platforms, workers] = await Promise.all([
      tx.platform.findMany({ where: actor.role === 'ADMIN' ? {} : { active: true }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      actor.role === 'ADMIN' ? tx.user.findMany({ where: { role: { not: 'ADMIN' }, active: true }, select: { id: true, name: true, email: true, role: true, parentCtvId: true }, orderBy: { name: 'asc' } }) : Promise.resolve([]),
    ]);
    if (view === 'settlements') {
      const workerId = params.get('workerId') || undefined;
      const rows = await tx.settlement.findMany({ where: { date, ...(workerId ? { OR: [{ workerId }, { worker: { parentCtvId: workerId } }] } : {}) }, include: { worker: { select: { id: true, name: true, role: true, parentCtvId: true } }, usages: { where: { status: { not: 'CANCELLED' } }, select: { deposit: true, withdrawal: true, status: true } } }, orderBy: { worker: { name: 'asc' } } });
      const calculated = rows.map(s => {
        const deposit = s.usages.reduce((x, u) => x.plus(u.deposit), decimal(0));
        const withdrawal = s.usages.reduce((x, u) => x.plus(u.withdrawal), decimal(0));
        const totals = s.status === 'OPEN' ? finance(deposit, withdrawal, s.worker.role) : { deposit: s.deposit, withdrawal: s.withdrawal, fee: s.fee, profit: s.profit, payout: s.payout, parentCommission: s.parentCommission, childCommission: s.childCommission, adminShare: s.adminShare };
        return { id: s.id, workerId: s.workerId, worker: s.worker, date: s.date, status: s.status, ...totals, incomplete: s.usages.filter(u => u.status === 'ACTIVE').length };
      });
      for (const s of calculated) if (s.worker.role === 'CTV' && s.status === 'OPEN') {
        const commission = calculated.filter(c => c.worker.parentCtvId === s.workerId).reduce((x, c) => x.plus(c.parentCommission), decimal(0));
        s.childCommission = commission; s.payout = s.payout.plus(commission);
      }
      // Parents with only child commission still need an explicit settlement row.
      for (const parent of workers.filter(w => w.role === 'CTV' && (!workerId || workerId === w.id))) {
        if (calculated.some(s => s.workerId === parent.id)) continue;
        const children = calculated.filter(c => c.worker.parentCtvId === parent.id);
        if (children.length) calculated.push({ id: `pending:${parent.id}`, workerId: parent.id, worker: parent, date, status: 'OPEN', ...finance(0, 0, 'CTV', children.reduce((x, c) => x.plus(c.parentCommission), decimal(0))), incomplete: 0 });
      }
      const filtered = calculated.filter(s => !workerId || s.workerId === workerId);
      return { view, date, page, pageSize, total: filtered.length, platforms, workers, settlements: filtered.slice((page - 1) * pageSize, page * pageSize) };
    }
    const where: Prisma.KeyWhereInput = {
      ...(actor.role === 'ADMIN' ? (params.get('ownerId') ? { ownerId: params.get('ownerId') === 'unassigned' ? null : params.get('ownerId')! } : {}) : { ownerId: actor.id }),
      ...(view === 'today' ? { entries: { some: { date, visible: true } } } : view === 'summary' ? { usages: { some: { settlement: { date, workerId: actor.id }, status: { not: 'CANCELLED' } } } } : { archived: params.get('archived') === 'true' }),
      ...(search ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { normalizedStk: { contains: search.replace(/\s/g, '') } }, { bank: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    if (params.get('selection') === 'true') {
      const matches = await tx.key.findMany({ where, select: { id: true }, take: 5001 });
      ensure(matches.length <= 5000, 'Tối đa 5.000 Key mỗi lần; hãy thu hẹp bộ lọc');
      return { ids: matches.map(k => k.id), total: matches.length, platforms, workers };
    }
    const [keys, total, keyCount, used, settlement, totals] = await Promise.all([
      tx.key.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, fullName: true, normalizedStk: true, bank: true, archived: true, owner: { select: { id: true, name: true, role: true } }, usages: { where: { status: { not: 'CANCELLED' } }, select: { id: true, platformId: true, deposit: true, withdrawal: true, status: true, settlement: { select: { date: true, status: true } } } } } }),
      tx.key.count({ where }),
      actor.role !== 'ADMIN' ? tx.key.count({ where: { ownerId: actor.id, archived: false } }) : Promise.resolve(0),
      actor.role !== 'ADMIN' ? tx.usage.groupBy({ by: ['platformId'], where: { key: { ownerId: actor.id, archived: false }, status: { not: 'CANCELLED' } }, _count: true }) : Promise.resolve([]),
      actor.role !== 'ADMIN' ? tx.settlement.findUnique({ where: { workerId_date: { workerId: actor.id, date } } }) : Promise.resolve(null),
      actor.role !== 'ADMIN' ? calculate(tx, actor.id, date) : Promise.resolve(null),
    ]);
    const eligible = Object.fromEntries(platforms.filter(p => p.active).map(p => [p.id, keyCount - (used.find(u => u.platformId === p.id)?._count ?? 0)]));
    const rows = keys.map(k => ({ ...k, depositTotal: k.usages.filter(u => u.settlement.date === date).reduce((n, u) => n.plus(u.deposit), decimal(0)), withdrawalTotal: k.usages.filter(u => u.settlement.date === date).reduce((n, u) => n.plus(u.withdrawal), decimal(0)) }));
    return { view, date, page, pageSize, total, platforms, workers, keys: rows, eligible, settlement, totals: settlement && settlement.status !== 'OPEN' ? { deposit: settlement.deposit, withdrawal: settlement.withdrawal, fee: settlement.fee, profit: settlement.profit, payout: settlement.payout, parentCommission: settlement.parentCommission, childCommission: settlement.childCommission, adminShare: settlement.adminShare, incomplete: 0 } : totals };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}
export async function keyDetail(actor: Actor, id: string) {
  const key = await db.key.findUnique({ where: { id }, include: { usages: { include: { platform: true, settlement: { select: { date: true, status: true } } }, orderBy: { createdAt: 'desc' } } } });
  ensure(key && (actor.role === 'ADMIN' || key.ownerId === actor.id), 'Không có quyền xem Key', 403);
  const fields = [key.fullName, key.normalizedStk, key.bank, key.branch, key.account, decrypt(key.password), decrypt(key.pin), key.phone, key.email, key.birthDate];
  return { id: key.id, fields, archived: key.archived, usages: key.usages };
}
