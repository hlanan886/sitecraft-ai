import { NextResponse } from "next/server";
import { getAIProviderStatus } from "@/lib/ai-provider";

export function GET() {
  return NextResponse.json(getAIProviderStatus());
}
