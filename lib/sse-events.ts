export type SseJsonEvent = Record<string, unknown>;

export type SseEnvelope = {
  requestId: string;
  taskId: string;
  sequence: number;
  revision: number;
  type: string;
  payload: unknown;
};

export class EventDeduper {
  private readonly highestSequence = new Map<string, number>();
  private readonly highestRevision = new Map<string, number>();
  private readonly closedTasks = new Set<string>();

  accept(event: SseEnvelope): boolean {
    if (this.closedTasks.has(event.taskId)) return false;
    const previousSequence = this.highestSequence.get(event.taskId);
    const previousRevision = this.highestRevision.get(event.taskId);
    if (previousSequence !== undefined && event.sequence <= previousSequence) return false;
    if (previousRevision !== undefined && event.revision < previousRevision) return false;
    this.highestSequence.set(event.taskId, event.sequence);
    this.highestRevision.set(event.taskId, Math.max(previousRevision ?? event.revision, event.revision));
    if (event.type === "done") this.closedTasks.add(event.taskId);
    return true;
  }

  close(taskId: string) {
    this.closedTasks.add(taskId);
  }
}

export type SseByteReader = {
  read: () => Promise<{ done: boolean; value?: Uint8Array }>;
  cancel: (reason?: unknown) => Promise<unknown>;
  releaseLock: () => void;
};

function takeCompleteEvents(buffer: string) {
  const events: SseJsonEvent[] = [];
  let remaining = buffer;
  let boundary = /\r?\n\r?\n/.exec(remaining);
  while (boundary?.index !== undefined) {
    const block = remaining.slice(0, boundary.index);
    remaining = remaining.slice(boundary.index + boundary[0].length);
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (data) events.push(JSON.parse(data) as SseJsonEvent);
    boundary = /\r?\n\r?\n/.exec(remaining);
  }
  return { events, remaining };
}

function isSseEnvelope(event: SseJsonEvent): event is SseEnvelope {
  return typeof event.requestId === "string"
    && typeof event.taskId === "string"
    && typeof event.sequence === "number"
    && Number.isInteger(event.sequence)
    && typeof event.revision === "number"
    && Number.isInteger(event.revision)
    && typeof event.type === "string"
    && "payload" in event;
}

export async function readSseEvents(
  reader: SseByteReader,
  onEvent?: (event: SseJsonEvent) => void,
) {
  const decoder = new TextDecoder();
  const events: SseJsonEvent[] = [];
  const deduper = new EventDeduper();
  let buffer = "";
  try {
    while (true) {
      const result = await reader.read();
      buffer += decoder.decode(result.value ?? new Uint8Array(), { stream: !result.done });
      const parsed = takeCompleteEvents(buffer);
      buffer = parsed.remaining;
      for (const event of parsed.events) {
        if (isSseEnvelope(event) && !deduper.accept(event)) continue;
        events.push(event);
        onEvent?.(event);
        if (event.type === "done") {
          // 2026-09-13（B5）：**不 await** cancel。
          //
          // 这段注释的原文来自 `app/generate/page.tsx`，是本项目付过代价的一条教训：
          // 该 SSE 流在 Next dev 下有时不落 end，`await reader.cancel()` 会**永久挂起**
          // 拖住整个流程——表现为 busy 残留、确认页按钮永远 disabled，像卡死。
          // B5 把 generate 页的消费换成这个模块，那条教训必须在这里也成立，
          // 否则就是把一个已经修好的挂起原样搬回来。
          // 回归网：`tests/sse-events.test.ts` 用"永不 settle 的 cancel"锁住本行为。
          void reader.cancel("sse_done").catch(() => undefined);
          return events;
        }
      }
      if (result.done) return events;
    }
  } finally {
    reader.releaseLock();
  }
}
