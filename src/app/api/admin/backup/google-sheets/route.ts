import { NextResponse } from "next/server";
import { checkOrigin, requireUser } from "@/lib/auth";
import { ensure } from "@/lib/domain";
import { failure } from "@/lib/http";
import { backupToGoogleSheets, lastGoogleSheetsBackup } from "@/lib/google-sheets-backup";

async function admin() {
  const actor = await requireUser();
  ensure(actor.role === "ADMIN", "Chỉ Admin được sao lưu dữ liệu", 403);
  return actor;
}

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`) return NextResponse.json(await backupToGoogleSheets());
    await admin();
    return NextResponse.json({ last: await lastGoogleSheetsBackup() });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await admin();
    return NextResponse.json(await backupToGoogleSheets());
  } catch (error) {
    return failure(error);
  }
}
