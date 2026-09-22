// 로비 접속 유저 정보 처리 (CLAUDE.md 접속 순서 / ERROR 코드 기준)
// LobbyRoom 은 소켓 이벤트만 받고, 실제 처리는 이 클래스에 맡긴다.
// 채널(로비 룸)당 1개씩 만들어진다 — waiting 목록은 "이 채널에서 로비 대기 중인 유저"만 추적한다.
// (CLAUDE.md 흐름 12번: 다른 채널과의 중복은 아직 막지 않는다 — Phase 4 이후 게임 중 여부까지 포함해 범위를 넓힐 수 있다)

import type { Client } from "@colyseus/core";
import { CloseCode } from "@colyseus/core";
import { SendError, SendMessage } from "../../common/messages.js";
import {
    ErrorCode,
    MessageType,
    type EnterLobbyPayload,
    type MatchFoundPayload,
    type UserInfo,
} from "../../common/types.js";
import { IsValidGender, IsValidMid, IsValidPartner, IsValidPhone, ConvertMidToUserid } from "../../common/userid.js";
import { GetOrCreateUser } from "../../db/userRepository.js";
import { GetUserCache, TouchUserCache } from "../../db/userCache.js";
import { RoomManager, ToPublicOpponentInfo } from "../room/RoomManager.js";

function IsEnterLobbyShape(payload: unknown): payload is EnterLobbyPayload {
    if (typeof payload !== "object" || payload === null) return false;
    const p = payload as Record<string, unknown>;
    return (
        typeof p.partner === "string" &&
        typeof p.mid === "string" &&
        typeof p.gender === "string" &&
        typeof p.phone === "string"
    );
}

function IsValidEnterLobbyFields(payload: EnterLobbyPayload): boolean {
    return (
        IsValidPartner(payload.partner) &&
        IsValidMid(payload.mid) &&
        IsValidGender(payload.gender) &&
        IsValidPhone(payload.phone)
    );
}

// 1차 구현은 파트너사 토큰 검증이 없다. 나중에 토큰 검증을 추가할 때 이 함수 안만 채우면 된다.
// (반환값이 false 면 인증 실패로 처리 — 지금은 항상 통과)
async function VerifyAuth(_payload: EnterLobbyPayload): Promise<boolean> {
    return true;
}

// phone 은 개인정보라 에러 로그에도 값 그대로 남기지 않는다 (뒷자리만 남기고 마스킹)
function MaskPhone(phone: unknown): string {
    if (typeof phone !== "string" || phone.length === 0) return String(phone);
    return phone.length <= 4 ? "*".repeat(phone.length) : `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`;
}

export class LobbyManager {
    // userid → 대기 중인 클라이언트 + 유저 정보 (같은 유저가 이 채널에 중복 접속하는 것을 막고,
    // 매칭할 때 DB/Redis 조회 없이 바로 쓸 수 있게 유저 정보도 함께 들고 있는다)
    private readonly waiting_by_userid = new Map<string, { client: Client; user: UserInfo }>();
    // sessionId → userid (연결이 끊겼을 때 waiting_by_userid 에서 지우기 위한 역방향 조회)
    private readonly userid_by_session = new Map<string, string>();
    // "게임 참여"를 누르고 매칭을 기다리는 userid 목록 (도착한 순서대로)
    private readonly match_queue: string[] = [];
    private readonly room_manager = new RoomManager();

    // ENTER_LOBBY 처리. 이 세션이 "새로 입장 성공"했으면 true 를 반환한다 (Room 이 10초 타임아웃 타이머를 지워야 함).
    async HandleEnterLobby(client: Client, raw_message: unknown): Promise<boolean> {
        if (this.userid_by_session.has(client.sessionId)) {
            // 이미 입장한 연결이 또 보낸 경우 — 무시(연결 유지), 새로 처리하지 않는다
            SendError(client, ErrorCode.ALREADY_ENTERED, "이미 로비에 들어와 있습니다.");
            return false;
        }

        const payload = raw_message;
        if (!IsEnterLobbyShape(payload)) {
            SendError(client, ErrorCode.INVALID_REQUEST, "ENTER_LOBBY payload 형식이 올바르지 않습니다.");
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        if (!IsValidEnterLobbyFields(payload)) {
            console.warn(
                `[LobbyManager] INVALID_ID partner=${payload.partner} gender=${payload.gender} phone=${MaskPhone(payload.phone)}`
            );
            SendError(client, ErrorCode.INVALID_ID, "partner/mid/gender/phone 형식이 올바르지 않습니다.");
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        if (!(await VerifyAuth(payload))) {
            SendError(client, ErrorCode.INVALID_ID, "인증에 실패했습니다.");
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        const userid = ConvertMidToUserid(payload.partner, payload.mid);

        if (this.waiting_by_userid.has(userid)) {
            SendError(client, ErrorCode.ALREADY_CONNECTED, "이미 접속 중인 계정입니다.");
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        let result: { user: UserInfo; is_new_user: boolean };
        try {
            result = await GetOrCreateUser(payload);
        } catch (error) {
            console.error("[LobbyManager] GetOrCreateUser 실패:", error instanceof Error ? error.message : error);
            SendError(client, ErrorCode.SERVER_ERROR, "서버 내부 오류가 발생했습니다.");
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        this.waiting_by_userid.set(userid, { client, user: result.user });
        this.userid_by_session.set(client.sessionId, userid);

        SendMessage(client, MessageType.LOBBY_ENTERED, { user: result.user, is_new_user: result.is_new_user });
        return true;
    }

    // 연결이 끊겼을 때 (ENTER_LOBBY 이전에 끊겼으면 등록된 게 없어 아무 일도 하지 않는다)
    async HandleLeave(client: Client): Promise<void> {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return; // 매칭돼서 게임방으로 옮겨간 경우도 여기로 온다 (SendMatchFoundAndLeave 에서 이미 지워 둠)

        this.waiting_by_userid.delete(userid);
        this.userid_by_session.delete(client.sessionId);
        this.RemoveFromMatchQueue(userid);

        // 떠날 때는 값을 다시 쓰지 않고 TTL 만 다시 설정한다 (CLAUDE.md 흐름 13번)
        const cached = await GetUserCache(userid);
        if (cached) {
            await TouchUserCache(cached);
        }
        // cached 가 없다면(드물게 대기 중 TTL 이 이미 지난 경우) 그냥 둔다 — 다음 ENTER_LOBBY 때 DB 에서 다시 채워진다
    }

    // "게임 참여" — 대기열에 넣고 매칭을 시도한다
    async HandleJoinMatch(client: Client): Promise<void> {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return; // ENTER_LOBBY 를 아직 안 한 연결 — 무시

        if (!this.match_queue.includes(userid)) {
            this.match_queue.push(userid);
        }
        await this.TryMatch();
    }

    // 매칭 대기 취소 — 대기열에 없으면(이미 매칭됐거나 애초에 없었으면) 조용히 무시한다
    HandleCancelMatch(client: Client): void {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return;
        this.RemoveFromMatchQueue(userid);
    }

    GetWaitingCount(): number {
        return this.waiting_by_userid.size;
    }

    private RemoveFromMatchQueue(userid: string): void {
        const index = this.match_queue.indexOf(userid);
        if (index !== -1) this.match_queue.splice(index, 1);
    }

    // 대기열에 있는 만큼 계속 매칭을 시도한다. "기다리는 방"이 있으면 1명씩 채워 넣고,
    // 없으면 2명이 모일 때 새 방을 만든다 (CLAUDE.md 게임 규칙 12번 / TASKS Phase 4-3).
    private async TryMatch(): Promise<void> {
        while (this.match_queue.length > 0) {
            const first_userid = this.match_queue[0];
            const first_entry = this.waiting_by_userid.get(first_userid);
            if (!first_entry) {
                // 대기열에 있는 사이 연결이 끊긴 유저 — 자리만 비우고 계속
                this.match_queue.shift();
                continue;
            }

            // 1) 상대를 기다리는 방이 있으면 그 방에 먼저 넣는다 (Phase 5 전까지는 항상 없음 — 정상)
            const waiting_match = await this.room_manager.TryJoinWaitingRoom(first_entry.user);
            if (waiting_match) {
                this.match_queue.shift();
                this.SendMatchFoundAndLeave(first_entry.client, first_entry.user.userid, {
                    room_name: waiting_match.room_name,
                    room_id: waiting_match.room_id,
                    seat_reservation: waiting_match.reservation,
                    opponent: waiting_match.opponent,
                });
                continue; // 다음 대기자도 이어서 매칭 시도
            }

            // 2) 없으면 2명이 모여야 새 방을 만든다 — 아직 한 명뿐이면 다음 JOIN_MATCH 를 기다린다
            if (this.match_queue.length < 2) break;

            const second_userid = this.match_queue[1];
            const second_entry = this.waiting_by_userid.get(second_userid);
            if (!second_entry) {
                this.match_queue.splice(1, 1); // 두 번째 자리만 비우고 다시 시도
                continue;
            }

            this.match_queue.splice(0, 2);

            const new_match = await this.room_manager.CreateRoomForTwo(first_entry.user, second_entry.user);
            if (!new_match) {
                // 게임 채널 3개 모두 꽉 참 — 둘 다 로비에 남는다(연결 유지). 다시 매칭하려면 JOIN_MATCH 를 또 보내야 한다.
                SendError(first_entry.client, ErrorCode.NO_GAME_ROOM, "접속 가능한 게임방이 없습니다. 잠시 후 다시 참여 해 주세요.");
                SendError(second_entry.client, ErrorCode.NO_GAME_ROOM, "접속 가능한 게임방이 없습니다. 잠시 후 다시 참여 해 주세요.");
                continue;
            }

            this.SendMatchFoundAndLeave(first_entry.client, first_entry.user.userid, {
                room_name: new_match.room_name,
                room_id: new_match.room_id,
                seat_reservation: new_match.reservation_a,
                opponent: ToPublicOpponentInfo(second_entry.user),
            });
            this.SendMatchFoundAndLeave(second_entry.client, second_entry.user.userid, {
                room_name: new_match.room_name,
                room_id: new_match.room_id,
                seat_reservation: new_match.reservation_b,
                opponent: ToPublicOpponentInfo(first_entry.user),
            });
        }
    }

    // 매칭 성사 — MATCH_FOUND 전송 후 로비 연결을 끊는다 (CONSENTED). 로비 쪽 상태도 함께 정리한다.
    private SendMatchFoundAndLeave(client: Client, userid: string, payload: MatchFoundPayload): void {
        this.waiting_by_userid.delete(userid);
        this.userid_by_session.delete(client.sessionId);

        SendMessage(client, MessageType.MATCH_FOUND, payload);
        client.leave(CloseCode.CONSENTED);
    }
}
