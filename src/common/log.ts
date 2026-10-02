// 접속/퇴장, 클라이언트↔서버 프로토콜 로그
// 기존 [LobbyRoom]/[GameRoom]/[LobbyManager] 같은 대괄호 태그 스타일을 따르되,
// 색(ANSI)과 화살표로 C→S(클라이언트→서버) / S→C(서버→클라이언트)를 구분한다.
// 색이 안 보이는 터미널이어도 [C→S] / [S→C] 텍스트 자체로 구분되도록 한다.

import type { Client, Room } from "@colyseus/core";
import * as types from "./types.js";

const RESET = "\x1b[0m";
const CYAN = "\x1b[36m"; // 접속
const GRAY = "\x1b[90m"; // 퇴장
const GREEN = "\x1b[32m"; // C → S
const MAGENTA = "\x1b[35m"; // S → C

function RoomTag(room: Room): string {
    return `${room.roomName}(${room.roomId})`;
}

// phone 은 개인정보라 로그에도 값 그대로 남기지 않는다 (뒷자리 4자리만 남기고 마스킹).
// CLAUDE.md: "phone 은 개인정보다. ... 로그 ... 에 넣지 않는다"
export function MaskPhone(phone: unknown): string {
    if (typeof phone !== "string" || phone.length === 0) return String(phone);
    return phone.length <= 4 ? "*".repeat(phone.length) : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}

// 통계/순위 데이터가 담기는 메시지 — 그대로 로그에 남기면(특히 외부로 전달되는 로그 수집기 등을 통해)
// 유저 개개인의 플레이 기록·순위가 유출될 수 있어 payload 자체를 생략한다.
// (사용자 전역 보안 규칙: "통계등 자료에 대한 유출 절대 금지")
const STATS_MESSAGE_TYPES = new Set<string>([
    types.MessageType.PLAY_INFO,
    types.MessageType.RANK_DAILY,
    types.MessageType.RANK_WEEKLY,
    types.MessageType.GAME_RESULT,
]);

// payload 를 로그용 문자열로 변환한다. 통계성 메시지(위 STATS_MESSAGE_TYPES)는 payload 를 생략하고,
// 그 외에는 phone 필드(중첩 포함)를 자동으로 마스킹한 뒤 너무 길면 자른다.
function StringifyPayload(type: string | undefined, payload: unknown, max = 500): string {
    if (type !== undefined && STATS_MESSAGE_TYPES.has(type)) return "[통계 데이터 생략]";

    let text: string;
    try {
        text = JSON.stringify(payload, (key, value) => (key === "phone" ? MaskPhone(value) : value)) ?? String(payload);
    } catch {
        text = String(payload);
    }
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function LogConnect(room: Room, client: Client, extra?: unknown): void {
    const extra_text = extra !== undefined ? ` ${StringifyPayload(undefined, extra)}` : "";
    console.log(
        `${CYAN}[접속]${RESET} ${RoomTag(room)} sessionId=${client.sessionId} (현재 ${room.clients.length}명)${extra_text}`
    );
}

export function LogDisconnect(room: Room, client: Client, code?: number): void {
    console.log(`${GRAY}[퇴장]${RESET} ${RoomTag(room)} sessionId=${client.sessionId} code=${code}`);
}

// 클라이언트 → 서버로 받은 메시지 (C→S)
export function LogClientMessage(room: Room, client: Client, type: string, payload: unknown): void {
    console.log(
        `${GREEN}[C→S]${RESET} ${RoomTag(room)} sessionId=${client.sessionId} type=${type} payload=${StringifyPayload(type, payload)}`
    );
}

// 서버 → 클라이언트로 보낸 메시지 (S→C)
export function LogServerMessage(room: Room, client: Client, type: string, payload: unknown): void {
    console.log(
        `${MAGENTA}[S→C]${RESET} ${RoomTag(room)} sessionId=${client.sessionId} type=${type} payload=${StringifyPayload(type, payload)}`
    );
}

// room.onMessage 등록을 감싸서, 메시지가 도착할 때마다 자동으로 [C→S] 로그를 남긴다.
// (Room 마다 개별적으로 로그 호출을 넣지 않아도 되도록 하는 공통 진입점. GameRoom 의 메시지 핸들러도
//  이 헬퍼로 등록하면 Phase 5 이후에도 로그가 자동으로 남는다)
export function RegisterLoggedMessage<T = unknown>(
    room: Room,
    type: string,
    handler: (client: Client, message: T) => unknown
): void {
    room.onMessage(type, (client: Client, message: T) => {
        LogClientMessage(room, client, type, message);
        return handler(client, message);
    });
}
