import { NextResponse } from "next/server";
import { z } from "zod";

const leadSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email().max(160),
  company: z.string().max(120).optional(),
  message: z.string().min(1).max(4000),
  honeypot: z.string().max(0).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ siteKey: string }> },
) {
  const { siteKey } = await params;
  const parsed = leadSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid lead payload" },
      { status: 400 },
    );
  if (parsed.data.honeypot) return NextResponse.json({ status: "accepted" });
  return NextResponse.json(
    {
      id: crypto.randomUUID(),
      siteKey,
      status: "new",
      receivedAt: new Date().toISOString(),
    },
    { status: 201 },
  );
}
