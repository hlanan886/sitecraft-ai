export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error(signal.reason instanceof Error ? signal.reason.message : "操作已取消");
  error.name = "AbortError";
  throw error;
}
