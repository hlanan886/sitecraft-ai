import { getAIProviderStatus } from "@/lib/ai-provider";
import { checkDatabaseConnection } from "@/lib/postgres";
import { getSiteStoreStatus } from "@/lib/site-store";

export const runtime = "nodejs";

export async function GET() {
  const ai = getAIProviderStatus();
  const store = getSiteStoreStatus();
  let database = store.shared ? "checking" : "development-file";

  if (store.shared) {
    try {
      await checkDatabaseConnection();
      database = "ready";
    } catch {
      database = "unavailable";
    }
  }

  const ready = ai.configured && (!store.shared || database === "ready");
  return Response.json(
    {
      status: ready ? "ready" : "not_ready",
      deepseek: { configured: ai.configured, model: ai.model },
      persistence: { driver: store.driver, database },
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
