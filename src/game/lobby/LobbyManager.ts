// 로비 접속 유저 정보 처리 — 클라이언트-서버 통신 문서 기준
// https://docs.google.com/spreadsheets/d/1zmxIhBU8UsEiI4cFFBs94Y4gNfsl1QbINjZMGQwNzBQ
// LobbyRoom 은 소켓 이벤트만 받고, 실제 처리는 이 클래스에 맡긴다.
// 채널(로비 룸)당 1개씩 만들어진다 — waiting 목록은 "이 채널에서 로비 대기 중인 유저"만 추적한다.
// (CLAUDE.md 흐름 12번: 다른 채널과의 중복은 아직 막지 않는다 — Phase 4 이후 게임 중 여부까지 포함해 범위를 넓힐 수 있다)

import type { Client, Room } from "@colyseus/core";
import { CloseCode } from "@colyseus/core";
import * as log from "../../common/log.js";
import * as messages from "../../common/messages.js";
import * as nameFilter from "../../common/nameFilter.js";
import * as types from "../../common/types.js";
import type {
    EnterLobbyPayload,
    EnterLobbyResultPayload,
    JoinMatchPayload,
    MatchFoundPayload,
    NamePayload,
    PlayInfoResultPayload,
    RankDailyResultPayload,
    RankListEntry,
    RankWeeklyResultPayload,
    RejoinGamePayload,
    UserInfo,
} from "../../common/types.js";
// ⚠️ 이 파일은 지역 변수로 "userid" 를 많이 쓰기 때문에, common/userid.js 모듈의 import alias 는
// 관례(파일명 그대로)를 따르지 않고 "useridUtils" 로 바꿔서 섀도잉(가려짐)을 피한다.
import * as useridUtils from "../../common/userid.js";
import * as userRepository from "../../db/userRepository.js";
import * as userCache from "../../db/userCache.js";
import * as rankingRepository from "../../db/rankingRepository.js";
import type { RankEntry } from "../../db/types.js";
import * as activeGame from "../room/activeGame.js";
import { GameRoomMatcher } from "../room/GameRoomMatcher.js";
import * as gameRoomMatcher from "../room/GameRoomMatcher.js";

// RankEntry(DB 조회 결과, { rank, userid, name, score }) → 문서 payload 형식인 [name, score] 튜플로 변환
function ToRankListEntries(entries: RankEntry[]): RankListEntry[] {
    return entries.map((entry): RankListEntry => [entry.name, entry.score]);
}

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
        useridUtils.IsValidPartner(payload.partner) &&
        useridUtils.IsValidMid(payload.mid) &&
        useridUtils.IsValidGender(payload.gender) &&
        useridUtils.IsValidPhone(payload.phone)
    );
}

// 1차 구현은 파트너사 토큰 검증이 없다. 나중에 토큰 검증을 추가할 때 이 함수 안만 채우면 된다.
// (반환값이 false 면 인증 실패로 처리 — 지금은 항상 통과)
async function VerifyAuth(_payload: EnterLobbyPayload): Promise<boolean> {
    return true;
}

export class LobbyManager {
    constructor(private readonly room: Room) {}

    // userid → 대기 중인 클라이언트 + 유저 정보 (같은 유저가 이 채널에 중복 접속하는 것을 막고,
    // 매칭할 때 DB/Redis 조회 없이 바로 쓸 수 있게 유저 정보도 함께 들고 있는다)
    private readonly waiting_by_userid = new Map<string, { client: Client; user: UserInfo }>();
    // sessionId → userid (연결이 끊겼을 때 waiting_by_userid 에서 지우기 위한 역방향 조회)
    private readonly userid_by_session = new Map<string, string>();
    // "게임 참여"를 누르고 매칭을 기다리는 userid 목록 (도착한 순서대로)
    private readonly match_queue: string[] = [];
    private readonly game_room_matcher = new GameRoomMatcher();

    // ENTER_LOBBY 처리. 문서 기준(2026-09-30 갱신): 결과는 같은 type(ENTER_LOBBY)으로 응답하되,
    // 성공하면 { result:"Y", userid, new, name, avatar } 를 한 번에 보낸다(예전 LOBBY_ENTERED 는 폐지 —
    // 그 필드들이 이 응답에 합쳐졌다). 이 세션이 "새로 입장 성공"했으면 true 를 반환한다
    // (Room 이 10초 타임아웃 타이머를 지워야 함).
    public async HandleEnterLobby(client: Client, raw_message: unknown): Promise<boolean> {
        if (this.userid_by_session.has(client.sessionId)) {
            // 이미 입장한 연결이 또 보낸 경우 — 다른 중복 접속 경로(아래)와 똑같이 연결을 끊는다
            // (2026-10-01 정정: 예전엔 연결을 유지했는데, 사용자 지시로 일관되게 바꿨다)
            messages.SendResult(this.room, client, types.MessageType.ENTER_LOBBY, "N", types.EnterLobbyErrorCode.DUPLICATE_CONNECTION);
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        const payload = raw_message;
        if (!IsEnterLobbyShape(payload) || !IsValidEnterLobbyFields(payload)) {
            if (IsEnterLobbyShape(payload)) {
                console.warn(
                    `[LobbyManager] 형식 오류 partner=${payload.partner} gender=${payload.gender} phone=${log.MaskPhone(payload.phone)}`
                );
            }
            messages.SendResult(this.room, client, types.MessageType.ENTER_LOBBY, "N", types.EnterLobbyErrorCode.INVALID_FORMAT);
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        if (!(await VerifyAuth(payload))) {
            // 1차 구현에서는 항상 통과한다 (VerifyAuth 주석 참고) — 토큰 검증 추가 시를 대비해 남겨 둔다
            messages.SendResult(this.room, client, types.MessageType.ENTER_LOBBY, "N", types.EnterLobbyErrorCode.OTHER);
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        const userid = useridUtils.ConvertMidToUserid(payload.partner, payload.mid);

        if (this.waiting_by_userid.has(userid)) {
            // 같은 계정이 이미 이 채널 로비에 대기 중 — 중복 접속
            messages.SendResult(this.room, client, types.MessageType.ENTER_LOBBY, "N", types.EnterLobbyErrorCode.DUPLICATE_CONNECTION);
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        let result: { user: UserInfo; is_new_user: boolean };
        try {
            result = await userRepository.GetOrCreateUser(payload);
        } catch (error) {
            console.error("[LobbyManager] GetOrCreateUser 실패:", error instanceof Error ? error.message : error);
            messages.SendResult(this.room, client, types.MessageType.ENTER_LOBBY, "N", types.EnterLobbyErrorCode.DB_ERROR);
            client.leave(CloseCode.WITH_ERROR);
            return false;
        }

        this.waiting_by_userid.set(userid, { client, user: result.user });
        this.userid_by_session.set(client.sessionId, userid);

        const entered_payload: EnterLobbyResultPayload = {
            result: "Y",
            userid: result.user.userid,
            new: result.is_new_user ? "Y" : "N",
            name: result.user.name,
            avatar: result.user.avatar,
        };
        messages.SendMessage(this.room, client, types.MessageType.ENTER_LOBBY, entered_payload);

        // 게임 중이던 유저가 F5 새로고침 등으로 소켓이 완전히 새로 열려 로비로 다시 들어온 경우 —
        // 평범한 로비 대기 대신 원래 게임방으로 돌아가라고 안내한다 (Phase 6-1, CLAUDE.md "F5 재접속" 참고).
        const rejoin_payload = await this.TryBuildRejoinPayload(userid);
        if (rejoin_payload) {
            this.SendRejoinGameAndLeave(client, userid, rejoin_payload);
        }
        return true;
    }

    // activeGame.ts 에 기록이 있으면 GameRoomMatcher 로 재접속을 시도해 REJOIN_GAME payload 를 만든다.
    // 기록이 없거나(게임 중이 아님) 재접속이 실패하면(게임이 이미 끝났거나 방이 사라짐) null.
    private async TryBuildRejoinPayload(userid: string): Promise<RejoinGamePayload | null> {
        const active_game = await activeGame.GetActiveGame(userid);
        if (!active_game) return null;

        const rejoin = await this.game_room_matcher.TryReconnectToGame(active_game);
        if (!rejoin) {
            // 낡은 기록(게임이 이미 끝났거나 방/프로세스가 사라짐) — 지워서 다음 ENTER_LOBBY 부터는
            // 평범하게 로비 입장이 되게 한다
            await activeGame.RemoveActiveGame(userid);
            return null;
        }
        // Colyseus 클라이언트 SDK 의 client.reconnect() 는 "roomId:reconnectionToken" 형식의 합성 문자열을
        // 받는다(SDK 가 room.reconnectionToken 을 저장할 때도 이 형식으로 만든다) — 그래서 여기서 미리
        // 합쳐서 보낸다. GameRoomMatcher 가 들고 있는 reconnection_token 은 순수 토큰 값이다(matchMaker.reconnect()
        // 검증 호출에는 순수 토큰이 필요하다).
        return {
            room_name: rejoin.room_name,
            room_id: rejoin.room_id,
            reconnection_token: `${rejoin.room_id}:${rejoin.reconnection_token}`,
        };
    }

    // REJOIN_GAME 전송 후 로비 연결을 끊는다 (CONSENTED) — SendMatchFoundAndLeave 와 같은 이유/방식.
    private SendRejoinGameAndLeave(client: Client, userid: string, payload: RejoinGamePayload): void {
        this.waiting_by_userid.delete(userid);
        this.userid_by_session.delete(client.sessionId);

        messages.SendMessage(this.room, client, types.MessageType.REJOIN_GAME, payload);
        client.leave(CloseCode.CONSENTED);
    }

    // NAME 처리 (별명 등록/변경). 문서 기준 흐름은 ENTER_LOBBY 성공 응답에서 new=Y 이고 name 이 빈 문자열일 때
    // 클라이언트가 처음 등록하는 것이지만, 이미 별명이 있는 유저가 다시 보내면 그 값으로 갱신한다
    // (문서에는 없는 확장 — CLAUDE.md 참고). 검증/중복 처리는 최초 등록과 동일하다.
    public async HandleName(client: Client, raw_message: unknown): Promise<void> {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return; // ENTER_LOBBY 를 아직 안 한 연결 — 무시

        const entry = this.waiting_by_userid.get(userid);
        if (!entry) return; // 매칭 등으로 이미 대기열에서 빠진 연결 — 무시

        const payload = raw_message as Partial<NamePayload> | null;
        const raw_name = typeof payload === "object" && payload !== null ? payload.name : undefined;

        if (!nameFilter.IsValidNameFormat(raw_name)) {
            messages.SendResult(this.room, client, types.MessageType.NAME, "N", types.NameErrorCode.INAPPROPRIATE);
            return;
        }
        const trimmed_name = raw_name.trim();
        if (nameFilter.ContainsBannedWord(trimmed_name)) {
            messages.SendResult(this.room, client, types.MessageType.NAME, "N", types.NameErrorCode.INAPPROPRIATE);
            return;
        }

        let db_result: "ok" | "duplicate";
        try {
            db_result = await userRepository.SetUserName(userid, trimmed_name);
        } catch (error) {
            console.error("[LobbyManager] SetUserName 실패:", error instanceof Error ? error.message : error);
            messages.SendResult(this.room, client, types.MessageType.NAME, "N", types.NameErrorCode.SERVER_ERROR);
            return;
        }

        if (db_result === "duplicate") {
            messages.SendResult(this.room, client, types.MessageType.NAME, "N", types.NameErrorCode.DUPLICATE);
            return;
        }

        entry.user = { ...entry.user, name: trimmed_name };
        messages.SendResult(this.room, client, types.MessageType.NAME, "Y");
    }

    // PLAY_INFO 처리 (게임 정보 통신). 이 세션이 ENTER_LOBBY 때 이미 들고 있는 UserInfo 를 그대로
    // 응답한다 (DB 재조회 없음). 문서에 실패 케이스가 없어, ENTER_LOBBY 를 아직 안 했거나 이미
    // 매칭돼 대기열에서 빠진 연결이 보내면 조용히 무시한다 (다른 out-of-order 메시지와 같은 처리).
    public HandlePlayInfo(client: Client): void {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return;

        const entry = this.waiting_by_userid.get(userid);
        if (!entry) return;

        const payload: PlayInfoResultPayload = {
            result: "Y",
            total_game_count: entry.user.total_game_count,
            total_win_count: entry.user.total_win_count,
            today_game_count: entry.user.today_game_count,
            today_win_count: entry.user.today_win_count,
        };
        messages.SendMessage(this.room, client, types.MessageType.PLAY_INFO, payload);
    }

    // RANK_DAILY/RANK_WEEKLY 처리 (Phase 8, 2026-10-01 통신규약 시트 기준). PLAY_INFO 와 같은 패턴으로
    // 실패 케이스가 없다 — ENTER_LOBBY 를 아직 안 했으면 조용히 무시한다. DB 조회 결과(RankEntry[])를
    // 문서 payload 형식인 [name, score] 튜플 배열로 변환해서 보낸다.
    public async HandleRankDaily(client: Client): Promise<void> {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return;

        const { date, rank_list, my_rank, my_score } = await rankingRepository.FetchRankDaily(userid);
        const payload: RankDailyResultPayload = {
            date,
            list: ToRankListEntries(rank_list),
            my: { rank: my_rank, score: my_score },
        };
        messages.SendMessage(this.room, client, types.MessageType.RANK_DAILY, payload);
    }

    public async HandleRankWeekly(client: Client): Promise<void> {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return;

        const { term, rank_list, my_rank, my_score } = await rankingRepository.FetchRankWeekly(userid);
        const payload: RankWeeklyResultPayload = {
            term,
            list: ToRankListEntries(rank_list),
            my: { rank: my_rank, score: my_score },
        };
        messages.SendMessage(this.room, client, types.MessageType.RANK_WEEKLY, payload);
    }

    // 연결이 끊겼을 때 (ENTER_LOBBY 이전에 끊겼으면 등록된 게 없어 아무 일도 하지 않는다)
    public async HandleLeave(client: Client): Promise<void> {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return; // 매칭돼서 게임방으로 옮겨간 경우도 여기로 온다 (SendMatchFoundAndLeave 에서 이미 지워 둠)

        this.waiting_by_userid.delete(userid);
        this.userid_by_session.delete(client.sessionId);
        this.RemoveFromMatchQueue(userid);

        // 떠날 때는 값을 다시 쓰지 않고 TTL 만 다시 설정한다 (CLAUDE.md 흐름 13번)
        const cached = await userCache.GetUserCache(userid);
        if (cached) {
            await userCache.TouchUserCache(cached);
        }
        // cached 가 없다면(드물게 대기 중 TTL 이 이미 지난 경우) 그냥 둔다 — 다음 ENTER_LOBBY 때 DB 에서 다시 채워진다
    }

    // JOIN_MATCH { select: "Y"|"N" } — Y: "게임 참여"(대기열에 넣고 매칭 시도), N: 매칭 대기 취소.
    // (예전엔 별도 CANCEL_MATCH 메시지였지만, JOIN_MATCH 하나로 합쳤다 — 문서 반영)
    public async HandleJoinMatch(client: Client, message: JoinMatchPayload): Promise<void> {
        const userid = this.userid_by_session.get(client.sessionId);
        if (!userid) return; // ENTER_LOBBY 를 아직 안 한 연결 — 무시

        if (message?.select === "N") {
            // 대기열에 없으면(이미 매칭됐거나 애초에 없었으면) 조용히 무시한다
            this.RemoveFromMatchQueue(userid);
            return;
        }
        if (message?.select !== "Y") return; // 형식이 잘못된 요청은 무시한다 (문서에 실패 응답이 없음)

        if (!this.match_queue.includes(userid)) {
            this.match_queue.push(userid);
        }
        await this.TryMatch();
    }

    public GetWaitingCount(): number {
        return this.waiting_by_userid.size;
    }

    // ADMIN_CHANNEL_USER 용 — 이 채널 로비에서 대기 중인 userid 목록 (roomRegistry 를 통해 채널 유저
    // 리포터가 주기적으로 가져간다). 로비는 "방" 개념이 없어 room 필드는 채우지 않는다.
    public GetWaitingUserids(): string[] {
        return [...this.waiting_by_userid.keys()];
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
            const waiting_match = await this.game_room_matcher.TryJoinWaitingRoom(first_entry.user);
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

            const new_match = await this.game_room_matcher.CreateRoomForTwo(first_entry.user, second_entry.user);
            if (!new_match) {
                // 게임 채널 3개 모두 꽉 참 — 둘 다 로비에 남는다(연결 유지). 다시 매칭하려면 JOIN_MATCH 를 또 보내야 한다.
                messages.SendError(this.room, first_entry.client, types.ErrorCode.NO_GAME_ROOM, "접속 가능한 게임방이 없습니다. 잠시 후 다시 참여 해 주세요.");
                messages.SendError(this.room, second_entry.client, types.ErrorCode.NO_GAME_ROOM, "접속 가능한 게임방이 없습니다. 잠시 후 다시 참여 해 주세요.");
                continue;
            }

            this.SendMatchFoundAndLeave(first_entry.client, first_entry.user.userid, {
                room_name: new_match.room_name,
                room_id: new_match.room_id,
                seat_reservation: new_match.reservation_a,
                opponent: gameRoomMatcher.ToPublicOpponentInfo(second_entry.user),
            });
            this.SendMatchFoundAndLeave(second_entry.client, second_entry.user.userid, {
                room_name: new_match.room_name,
                room_id: new_match.room_id,
                seat_reservation: new_match.reservation_b,
                opponent: gameRoomMatcher.ToPublicOpponentInfo(first_entry.user),
            });
        }
    }

    // 매칭 성사 — MATCH_FOUND 전송 후 로비 연결을 끊는다 (CONSENTED). 로비 쪽 상태도 함께 정리한다.
    private SendMatchFoundAndLeave(client: Client, userid: string, payload: MatchFoundPayload): void {
        this.waiting_by_userid.delete(userid);
        this.userid_by_session.delete(client.sessionId);

        messages.SendMessage(this.room, client, types.MessageType.MATCH_FOUND, payload);
        client.leave(CloseCode.CONSENTED);
    }
}
