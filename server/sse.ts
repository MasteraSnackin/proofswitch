export interface SseMessage {
  type: "event";
  event: string;
  data: string;
  id: string;
}

export interface SseRetry {
  type: "retry";
  retry: number;
}

export type ParsedSseItem = SseMessage | SseRetry;

/**
 * Incremental EventSource parser. It accepts arbitrary byte fragmentation,
 * including a CRLF split across chunks, and follows the HTML event-stream
 * rules for comments, multi-line data, id persistence and retry fields.
 */
export class SseParser {
  private readonly decoder = new TextDecoder("utf-8");
  private buffer = "";
  private dataLines: string[] = [];
  private eventType = "";
  private lastEventId = "";

  push(chunk: Uint8Array | string): ParsedSseItem[] {
    this.buffer +=
      typeof chunk === "string"
        ? chunk
        : this.decoder.decode(chunk, { stream: true });
    return this.drainLines(false);
  }

  finish(): ParsedSseItem[] {
    this.buffer += this.decoder.decode();
    const items = this.drainLines(true);

    // EOF does not dispatch a partially accumulated event. A retry field has
    // already taken effect while its line was parsed and remains in `items`.
    this.dataLines = [];
    this.eventType = "";
    this.buffer = "";
    return items;
  }

  private drainLines(endOfInput: boolean) {
    const items: ParsedSseItem[] = [];

    while (this.buffer.length > 0) {
      let lineEnd = -1;
      for (let index = 0; index < this.buffer.length; index += 1) {
        const character = this.buffer[index];
        if (character === "\n" || character === "\r") {
          lineEnd = index;
          break;
        }
      }

      if (lineEnd === -1) {
        if (endOfInput) {
          items.push(...this.processLine(this.buffer));
          this.buffer = "";
        }
        break;
      }

      const newline = this.buffer[lineEnd];
      if (
        newline === "\r" &&
        lineEnd === this.buffer.length - 1 &&
        !endOfInput
      ) {
        break;
      }

      const line = this.buffer.slice(0, lineEnd);
      const newlineWidth =
        newline === "\r" && this.buffer[lineEnd + 1] === "\n" ? 2 : 1;
      this.buffer = this.buffer.slice(lineEnd + newlineWidth);
      items.push(...this.processLine(line));
    }

    return items;
  }

  private processLine(line: string): ParsedSseItem[] {
    if (line === "") {
      return this.dispatchEvent();
    }
    if (line.startsWith(":")) {
      return [];
    }

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    switch (field) {
      case "event":
        this.eventType = value;
        return [];
      case "data":
        this.dataLines.push(value);
        return [];
      case "id":
        if (!value.includes("\0")) this.lastEventId = value;
        return [];
      case "retry":
        if (/^\d+$/.test(value)) {
          const retry = Number(value);
          if (Number.isSafeInteger(retry)) {
            return [{ type: "retry", retry }];
          }
        }
        return [];
      default:
        return [];
    }
  }

  private dispatchEvent(): ParsedSseItem[] {
    if (this.dataLines.length === 0) {
      this.eventType = "";
      return [];
    }

    const message: SseMessage = {
      type: "event",
      event: this.eventType || "message",
      data: this.dataLines.join("\n"),
      id: this.lastEventId,
    };
    this.dataLines = [];
    this.eventType = "";
    return [message];
  }
}

function oneLine(value: string) {
  return value.replace(/[\r\n]/g, "");
}

export function encodeSseMessage(message: {
  event?: string;
  data: string;
  id?: string | null;
  retry?: number;
}) {
  let encoded = "";
  if (message.id !== undefined && message.id !== null) {
    encoded += `id: ${oneLine(message.id).replace(/\0/g, "")}\n`;
  }
  if (message.event) encoded += `event: ${oneLine(message.event)}\n`;
  if (
    message.retry !== undefined &&
    Number.isSafeInteger(message.retry) &&
    message.retry >= 0
  ) {
    encoded += `retry: ${message.retry}\n`;
  }
  for (const line of message.data.split(/\r\n|\r|\n/)) {
    encoded += `data: ${line}\n`;
  }
  return `${encoded}\n`;
}

export function encodeSseRetry(retry: number) {
  if (!Number.isSafeInteger(retry) || retry < 0) return "";
  return `retry: ${retry}\n\n`;
}

export function mapSseStream(
  source: ReadableStream<Uint8Array>,
  mapMessage: (message: SseMessage) => SseMessage | null,
) {
  const reader = source.getReader();
  const parser = new SseParser();
  const encoder = new TextEncoder();
  let cancelled = false;

  function enqueueItems(
    controller: ReadableStreamDefaultController<Uint8Array>,
    items: ParsedSseItem[],
  ) {
    for (const item of items) {
      if (item.type === "retry") {
        controller.enqueue(encoder.encode(encodeSseRetry(item.retry)));
        continue;
      }
      const mapped = mapMessage(item);
      if (!mapped) continue;
      controller.enqueue(
        encoder.encode(
          encodeSseMessage({
            event: mapped.event,
            data: mapped.data,
            id: mapped.id || null,
          }),
        ),
      );
    }
  }

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) {
            enqueueItems(controller, parser.finish());
            controller.close();
            return;
          }
          enqueueItems(controller, parser.push(value));
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
    async cancel(reason) {
      cancelled = true;
      await reader.cancel(reason);
    },
  });
}

