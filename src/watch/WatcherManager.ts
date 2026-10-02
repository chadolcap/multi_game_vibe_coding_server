// 관리자(Watcher) 채널 로직 — ADMIN_LOGIN 인증, ADMIN_CHANNEL_COUNT/ADMIN_CHANNEL_USER 조회, SEND_NOTICE 전파.
// WatcherRoom 은 소켓 이벤트만 받고, 실제 처리는 이 클래스에 맡긴다 (LobbyManager 와 같은 구조).
// 로컬 엑셀본 "관리자" 시트 기준. ADMIN_LOGIN/SEND_NOTICE 는 그 시트에 아직 없어 CLAUDE.md 가 기준이다.

import { CloseCode, matchMaker, type Client, type Room } from "@colyseus/core";
import * as channelNames from "../common/channelNames.js";
import { config } from "../common/config.js";
import * as constants from "../common/constants.js";
import * as messages from "../common/messages.js";
import * as types from "../common/types.js";
import type {
    AdminChannelCountPayload,
    AdminChannelUserQuery,
    AdminChannelUserResultPayload,
    AdminLoginPayload,
    AdminLoginResultPayload,
    NoticeTimeRange,
    SendNoticePayload,
} from "../common/types.js";
import * as channelUsers from "../db/channelUsers.js";
import * as noticePubSub from "../db/noticePubSub.js";

// "HH:MM" 을 that time.mon/time.day(연도는 지금 연도)의 Date 로 만든다. 형식이 틀리면 null.
function ParseNoticeTime(time: NoticeTimeRange, hhmm: string): Date | null {
    const match = /^([0-9]{1,2}):([0-9]{2})$/.exec(hhmm);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return null;
    if (!Number.isInteger(time.mon) || time.mon < 1 || time.mon > 12) return null;
    if (!Number.isInteger(time.day) || time.day < 1 || time.day > 31) return null;

    const now = new Date();
    return new Date(now.getFullYear(), time.mon - 1, time.day, hour, minute, 0, 0);
}

// 모든 lobby_N / game_N 채널의 현재 접속자 수를 matchMaker.query() 로 실시간 집계한다. (Colyseus 의
// RedisDriver 가 room 생성/삭제마다 방 목록을 이미 관리해 주므로, 별도 스냅샷 없이 그때그때 물어보면 된다)
async function ComputeChannelCounts(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};

    for (let channel_no = 1; channel_no <= config.lobby_ports.length; channel_no++) {
        const room_name = channelNames.GetLobbyRoomName(channel_no);
        const rooms = await matchMaker.query({ name: room_name });
        counts[room_name] = rooms.reduce((sum, room) => sum + room.clients, 0);
    }
    for (let channel_no = 1; channel_no <= constants.GAME_CHANNEL_COUNT; channel_no++) {
        const room_name = channelNames.GetGameRoomName(channel_no);
        const rooms = await matchMaker.query({ name: room_name });
        counts[room_name] = rooms.reduce((sum, room) => sum + room.clients, 0);
    }
    return counts;
}

export class WatcherManager {
    constructor(private readonly room: Room) {}

    // ADMIN_LOGIN 을 통과한 sessionId. 로그인 전에는 다른 어떤 관리자 메시지도 처리하지 않는다.
    private readonly logged_in_sessions = new Set<string>();

    // ADMIN_LOGIN 처리. 계정 정보는 .env(config.admin_id/admin_password)로만 관리한다 — 코드/문서에 적지 않는다.
    // 성공하면 true 를 반환한다 (Room 이 로그인 제한 시간 타이머를 지워야 함).
    public HandleAdminLogin(client: Client, message: AdminLoginPayload): boolean {
        const is_valid_shape = typeof message?.id === "string" && typeof message?.password === "string";
        // admin_id/admin_password 가 비어 있으면(설정 누락) 어떤 값으로도 로그인시키지 않는다 — config.ts 참고
        const ok =
            is_valid_shape &&
            config.admin_id !== "" &&
            config.admin_password !== "" &&
            message.id === config.admin_id &&
            message.password === config.admin_password;

        const payload: AdminLoginResultPayload = { result: ok ? "Y" : "N" };
        messages.SendMessage(this.room, client, types.MessageType.ADMIN_LOGIN, payload);

        if (ok) {
            this.logged_in_sessions.add(client.sessionId);
        } else {
            client.leave(CloseCode.WITH_ERROR); // 로그인 실패 시 연결 종료 (CLAUDE.md: "실패 시 연결 종료")
        }
        return ok;
    }

    public async HandleChannelCount(client: Client): Promise<void> {
        if (!this.RequireLoggedIn(client)) return;

        const count = await ComputeChannelCounts();
        const payload: AdminChannelCountPayload = { count };
        messages.SendMessage(this.room, client, types.MessageType.ADMIN_CHANNEL_COUNT, payload);
    }

    public async HandleChannelUser(client: Client, message: AdminChannelUserQuery): Promise<void> {
        if (!this.RequireLoggedIn(client)) return;
        if (message?.lobby === undefined && message?.game === undefined) return; // 형식 오류 — 무시

        const room_name = message.lobby !== undefined ? channelNames.GetLobbyRoomName(message.lobby) : channelNames.GetGameRoomName(message.game!);
        const users = await channelUsers.GetChannelUsers(room_name);

        const payload: AdminChannelUserResultPayload = {
            ...(message.lobby !== undefined ? { lobby: message.lobby } : { game: message.game }),
            user: users,
            total: users.length,
        };
        messages.SendMessage(this.room, client, types.MessageType.ADMIN_CHANNEL_USER, payload);
    }

    // SEND_NOTICE — 응답 없음(발사 후 잊기). message.channel 에 담긴 room_name(예: "lobby_1")들에만
    // 공지를 전파한다 — 전체 채널에 보내려면 관리자 페이지가 그 목록을 모두 채워 보내야 한다.
    // message.time 이 있으면 그 구간(start~end) 동안 NOTICE_REPEAT_INTERVAL_SEC(1분) 간격으로 반복
    // 전송하고, 없으면 기존처럼 즉시 1회만 보낸다 (사용자 지시, 2026-09-30).
    public async HandleSendNotice(client: Client, message: SendNoticePayload): Promise<void> {
        if (!this.RequireLoggedIn(client)) return;
        if (typeof message?.message !== "string" || message.message.length === 0) return; // 형식 오류 — 무시
        if (!Array.isArray(message.channel) || message.channel.length === 0) return; // 형식 오류 — 무시
        if (!message.channel.every((c) => typeof c === "string")) return;

        if (message.time) {
            this.ScheduleRepeatingNotice(message.channel, message.message, message.time);
            return;
        }

        await noticePubSub.PublishNotice(message.message, message.channel);
    }

    // start~end 구간 동안 NOTICE_REPEAT_INTERVAL_SEC 간격으로 반복 전송을 예약한다. start 가 이미
    // 지났으면 곧바로 시작하고, end 가 이미 지났으면(잘못 지정했거나 너무 늦게 도착한 요청) 아무것도
    // 하지 않는다. end <= start 인 잘못된 구간도 무시한다.
    // ⚠️ 예약은 room.clock(메모리)에만 있다 — Watcher 프로세스가 재시작되면 진행 중이던 예약도 함께
    // 사라진다. Redis 등에 영속화하지 않는다(요청 범위 밖) — Watcher 는 로비처럼 autoDispose=false 로
    // 항상 떠 있는 게 기본 운영 방식이라, 재시작이 드물게만 일어난다고 가정한다.
    private ScheduleRepeatingNotice(channels: string[], message: string, time: NoticeTimeRange): void {
        const start = ParseNoticeTime(time, time.start);
        const end = ParseNoticeTime(time, time.end);
        if (!start || !end || end <= start) return; // 형식 오류 — 무시

        const now = new Date();
        if (end <= now) return; // 이미 끝난 시간대 — 무시

        const SendOnce = (): void => {
            noticePubSub.PublishNotice(message, channels).catch((error) => {
                console.error("[WatcherManager] 반복 공지 전송 실패:", error instanceof Error ? error.message : error);
            });
        };

        const delay_to_start_ms = Math.max(0, start.getTime() - now.getTime());
        this.room.clock.setTimeout(() => {
            SendOnce();
            const interval = this.room.clock.setInterval(() => {
                if (new Date() >= end) {
                    interval.clear();
                    return;
                }
                SendOnce();
            }, constants.NOTICE_REPEAT_INTERVAL_SEC * 1000);
        }, delay_to_start_ms);
    }

    public HandleLeave(client: Client): void {
        this.logged_in_sessions.delete(client.sessionId);
    }

    private RequireLoggedIn(client: Client): boolean {
        return this.logged_in_sessions.has(client.sessionId);
    }
}
