// 클라이언트 메시지 송수신 헬퍼
// - S→C: 항상 envelope 전체({ type, payload, ts })를 보낸다.
// - C→S: 서버는 payload 만 읽는다. (클라이언트는 { payload: {...} } 만 보내도 된다)

import type { Client, Room } from "@colyseus/core";
import { LogServerMessage } from "./log.js";
import { MessageType, type Envelope, type ErrorCode, type ErrorPayload } from "./types.js";

export function SendMessage<P>(room: Room, client: Client, type: string, payload: P): void {
    const envelope: Envelope<P> = { type, payload, ts: Date.now() };
    LogServerMessage(room, client, type, payload);
    client.send(type, envelope);
}

export function SendError(room: Room, client: Client, code: ErrorCode, message: string): void {
    const payload: ErrorPayload = { code, message };
    SendMessage(room, client, MessageType.ERROR, payload);
}

// ENTER_LOBBY / NAME 처럼, 요청과 같은 type 이름으로 { result, error? } 를 돌려주는 응답 헬퍼.
// (통신 문서 기준 — 요청 type 을 그대로 재사용해 결과를 알려준다)
export function SendResult<E extends number>(
    room: Room,
    client: Client,
    type: string,
    result: "Y" | "N",
    error?: E
): void {
    SendMessage(room, client, type, error === undefined ? { result } : { result, error });
}

// 받은 메시지에서 payload 만 꺼낸다. 형식이 맞지 않으면 undefined
export function ReadPayload(message: unknown): unknown {
    if (typeof message !== "object" || message === null) return undefined;
    return (message as { payload?: unknown }).payload;
}
