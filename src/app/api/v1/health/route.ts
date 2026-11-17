import { NextResponse } from "next/server";
import { integrationStatus, readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

// Public health probe. Reports whether each integration is configured, never the values.
export function GET() {
  const status = integrationStatus(readEnv());
  return NextResponse.json({ status: "ok", integrations: status }, { headers: { "Cache-Control": "no-store" } });
}
