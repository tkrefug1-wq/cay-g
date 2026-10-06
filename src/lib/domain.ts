import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new AppError(message, status);
}
export const day = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Ngày không hợp lệ');
export const amountSchema = z.union([z.string(), z.number()]).transform(String).refine(v => /^\d{1,10}(\.\d{1,2})?$/.test(v), 'Số tiền không hợp lệ (tối đa 2 số lẻ)');
export type Actor = { id: string; role: Role; parentCtvId: string | null; name?: string; email?: string };
export const decimal = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
export const rounded = (v: Prisma.Decimal) => v.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
export function finance(deposit: Prisma.Decimal.Value, withdrawal: Prisma.Decimal.Value, role: Role, childCommission: Prisma.Decimal.Value = 0) {
  const d = decimal(deposit), w = decimal(withdrawal), fee = rounded(w.mul('0.1'));
  const profit = w.minus(d).minus(fee), adminShare = rounded(profit.mul('0.5'));
  const parentCommission = role === 'CTV_CON' ? rounded(profit.mul('0.13')) : decimal(0);
  const workerShare = profit.minus(adminShare).minus(parentCommission);
  return { deposit: d, withdrawal: w, fee, profit, adminShare, parentCommission, childCommission: decimal(childCommission), payout: d.plus(workerShare).plus(childCommission) };
}
export function parseData(text: string) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  ensure(lines.length > 0 && lines.length <= 500, 'Mỗi lần nhập từ 1 đến 500 dòng');
  const seen = new Set<string>();
  return lines.map((line, i) => {
    const fields = line.split('|').map(x => x.trim());
    ensure(fields.length === 3 || fields.length === 10, `Dòng ${i + 1}: cần đúng 3 hoặc 10 field`);
    ensure(fields.every(v => v.length <= 250), `Dòng ${i + 1}: field quá dài`);
    const [fullName, stk, bank, branch = '', account = '', password = '', pin = '', phone = '', email = '', birthDate = ''] = fields;
    const normalizedStk = stk.replace(/\D/g, '');
    ensure(fullName && bank && normalizedStk.length >= 3 && normalizedStk.length <= 30, `Dòng ${i + 1}: Họ tên, STK hoặc ngân hàng không hợp lệ`);
    ensure(!seen.has(normalizedStk), `Dòng ${i + 1}: STK ${normalizedStk} lặp trong dữ liệu nhập`);
    seen.add(normalizedStk);
    return { fullName, normalizedStk, bank, branch, account, password, pin, phone, email, birthDate };
  });
}
