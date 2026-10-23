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

const dataFields = ['fullName', 'stk', 'bank', 'branch', 'account', 'password', 'pin', 'phone', 'email', 'birthDate'] as const;
type DataField = typeof dataFields[number];
const fieldAliases: Record<string, DataField> = {
  'ho ten': 'fullName', 'ten': 'fullName', 'full name': 'fullName',
  'stk': 'stk', 'so tai khoan': 'stk',
  'ngan hang': 'bank', 'bank': 'bank',
  'chi nhanh': 'branch', 'branch': 'branch',
  'tai khoan': 'account', 'username': 'account', 'user': 'account',
  'mat khau': 'password', 'password': 'password', 'pass': 'password',
  'pin rut': 'pin', 'pin': 'pin',
  'sdt': 'phone', 'so dien thoai': 'phone', 'phone': 'phone',
  'email': 'email',
  'ngay sinh': 'birthDate', 'birth date': 'birthDate', 'birthday': 'birthDate',
};
const normalizeLabel = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const fieldFromLabel = (value: string) => fieldAliases[normalizeLabel(value)];
const knownBanks = new Set([
  'abbank', 'acb', 'agribank', 'bac a bank', 'baoviet bank', 'bidv', 'cake', 'cbbank', 'cimb', 'dbs', 'dong a bank',
  'eximbank', 'gpbank', 'hdbank', 'hong leong bank', 'hsbc', 'ibk', 'indovina bank', 'kienlongbank', 'lpbank', 'mb',
  'mbbank', 'msb', 'nam a bank', 'ncb', 'ocb', 'oceanbank', 'pgbank', 'pvcombank', 'sacombank', 'saigonbank',
  'scb', 'seabank', 'shinhan bank', 'shb', 'standard chartered', 'techcombank', 'tpbank', 'uob', 'vib', 'viet a bank',
  'vietbank', 'vietcombank', 'vietinbank', 'vpbank', 'vrb', 'woori bank',
]);
function autoOrderThree(fields: string[]) {
  const stkIndexes = fields.map((value, index) => (/^[\d\s.-]{3,40}$/.test(value) ? index : -1)).filter(index => index >= 0);
  const bankIndexes = fields.map((value, index) => (knownBanks.has(normalizeLabel(value)) ? index : -1)).filter(index => index >= 0);
  if (stkIndexes.length !== 1 || bankIndexes.length !== 1 || stkIndexes[0] === bankIndexes[0]) return fields;
  const nameIndex = [0, 1, 2].find(index => index !== stkIndexes[0] && index !== bankIndexes[0]);
  return nameIndex === undefined ? fields : [fields[nameIndex], fields[stkIndexes[0]], fields[bankIndexes[0]]];
}

export function parseData(text: string) {
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  ensure(lines.length > 0 && lines.length <= 500, 'Mỗi lần nhập từ 1 đến 500 dòng');
  const first = lines[0].split('|').map(x => x.trim());
  const header = first.map(fieldFromLabel);
  const hasHeader = (first.length === 3 || first.length === 10) && header.every(Boolean) && new Set(header).size === header.length;
  const inputLines = hasHeader ? lines.slice(1) : lines;
  ensure(inputLines.length > 0, 'Chưa có dòng dữ liệu sau tiêu đề');
  const seen = new Set<string>();
  return inputLines.map((line, i) => {
    let fields = line.split('|').map(x => x.trim());
    ensure(fields.length === 3 || fields.length === 10, `Dòng ${i + 1}: cần đúng 3 hoặc 10 field`);
    ensure(fields.every(v => v.length <= 250), `Dòng ${i + 1}: field quá dài`);
    const labelled = fields.map(value => {
      const separator = value.indexOf(':');
      if (separator < 1) return null;
      const field = fieldFromLabel(value.slice(0, separator));
      return field ? { field, value: value.slice(separator + 1).trim() } : null;
    });
    if (labelled.every(Boolean)) {
      ensure(new Set(labelled.map(item => item!.field)).size === fields.length, `Dòng ${i + 1}: nhãn field bị lặp`);
      const values = Object.fromEntries(labelled.map(item => [item!.field, item!.value]));
      fields = dataFields.slice(0, fields.length === 3 ? 3 : 10).map(field => values[field] ?? '');
    } else if (hasHeader) {
      const values = Object.fromEntries(header.map((field, index) => [field, fields[index]]));
      fields = dataFields.slice(0, fields.length === 3 ? 3 : 10).map(field => values[field] ?? '');
    } else if (fields.length === 3) {
      fields = autoOrderThree(fields);
    }
    const [fullName, stk, bank, branch = '', account = '', password = '', pin = '', phone = '', email = '', birthDate = ''] = fields;
    const normalizedStk = stk.replace(/\D/g, '');
    ensure(fullName && bank && normalizedStk.length >= 3 && normalizedStk.length <= 30, `Dòng ${i + 1}: Họ tên, STK hoặc ngân hàng không hợp lệ`);
    ensure(!seen.has(normalizedStk), `Dòng ${i + 1}: STK ${normalizedStk} lặp trong dữ liệu nhập`);
    seen.add(normalizedStk);
    return { fullName, normalizedStk, bank, branch, account, password, pin, phone, email, birthDate };
  });
}
