export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "keep-alive",
  // 防反代/网关缓冲流尾（Nginx 等未设 X-Accel-Buffering 时会整块缓冲，
  // 导致 SSE done 事件被吞、前端以为请求挂起）。no-buffer 语义对非 Nginx 层无害。
  "X-Accel-Buffering": "no",
} as const;

export function buildSseReplayResponse(event: Record<string, unknown>) {
  return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: SSE_HEADERS });
}
