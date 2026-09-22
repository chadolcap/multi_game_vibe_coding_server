// 클라이언트 메시지 송수신 헬퍼
// - S→C: 항상 envelope 전체({ type, payload, ts })를 보낸다.
// - C→S: 서버는 payload 만 읽는다. (클라이언트는 { payload: {...} } 만 보내도 된다)

import type { Client } from "@colyseus/core";
import { MessageType, type Envelope, type ErrorCode, type ErrorPayload } from "./types.js";

export function SendMessage<P>(client: Client, type: string, payload: P): void {
    const envelope: Envelope<P> = { type, payload, ts: Date.now() };
    client.send(type, envelope);
}

export function SendError(client: Client, code: ErrorCode, message: string): void {
    const payload: ErrorPayload = { code, message };
    SendMessage(client, MessageType.ERROR, payload);
}

// 받은 메시지에서 payload 만 꺼낸다. 형식이 맞지 않으면 undefined
export function ReadPayload(message: unknown): unknown {
    if (typeof message !== "object" || message === null) return undefined;
    return (message as { payload?: unknown }).payload;
}
