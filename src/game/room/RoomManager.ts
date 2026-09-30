// 로비에서 온 유저를 게임방에 입장시키는 역할 (로비 프로세스 안에서 동작하며,
// Redis 기반 Presence/Driver 를 통해 다른 프로세스(게임 채널)의 방에 좌석을 예약한다).

import { matchMaker } from "@colyseus/core";
import { GAME_CHANNEL_COUNT, MAX_ROOMS_PER_GAME_CHANNEL } from "../../common/constants.js";
import { GetGameRoomName } from "../../common/channelNames.js";
import type { GameSeatAuth, OpponentInfo, SeatReservation, UserInfo } from "../../common/types.js";
import { GetAliveGameChannels } from "../../db/channelHeartbeat.js";
import { PopWaitingRoom } from "./waitingRooms.js";
import type { ActiveGameEntry } from "./types.js";

export interface NewRoomMatch {
    room_name: string;
    room_id: string;
    reservation_a: SeatReservation;
    reservation_b: SeatReservation;
}

export interface WaitingRoomMatch {
    room_name: string;
    room_id: string;
    reservation: SeatReservation;
    opponent: OpponentInfo;
}

export interface RejoinMatch {
    room_name: string;
    room_id: string;
    reconnection_token: string;
}

function ToPublicOpponentInfo(user: UserInfo): OpponentInfo {
    return { name: user.name, avatar: user.avatar };
}

export class RoomManager {
    // 게임 중이던 유저가 (F5 등으로) 로비를 거쳐 다시 들어왔을 때, activeGame.ts 에 저장해 둔 재접속
    // 토큰이 아직 유효한지 확인한다.
    // ⚠️ matchMaker.reconnect() 가 돌려주는 값(ISeatReservation)에는 reconnectionToken 필드가 없다 —
    // 원래는 클라이언트가 이미 그 토큰을 들고 있다고 가정하고(client.reconnect(token) 호출 시 클라이언트가
    // 직접 넘김) 방/세션만 확인해 주는 API 라서 그렇다. 그래서 여기서는 그 반환값을 그대로 클라이언트에
    // 넘기지 않고, "유효한지"만 확인하는 용도로만 쓰고(유효하면 예외 없이 반환, 무효/방 소멸 시 예외),
    // 클라이언트에 돌려줄 값은 우리가 Redis 에 들고 있던 reconnection_token 을 그대로 쓴다 — 클라이언트는
    // 이 값으로 client.reconnect(reconnection_token, room_name) 을 부르면 된다(consumeSeatReservation 이
    // 아니다 — REJOIN_GAME payload 주석 참고).
    public async TryReconnectToGame(active_game: ActiveGameEntry): Promise<RejoinMatch | null> {
        try {
            await matchMaker.reconnect(active_game.room_id, { reconnectionToken: active_game.reconnection_token });
            return { room_name: active_game.room_name, room_id: active_game.room_id, reconnection_token: active_game.reconnection_token };
        } catch (error) {
            console.warn(
                `[RoomManager] 게임 재접속 확인 실패, 평범한 로비 입장으로 진행 (room_id=${active_game.room_id}):`,
                error instanceof Error ? error.message : error
            );
            return null;
        }
    }

    // "기다리는 방"이 있으면 유저 1명을 그 방에 넣는다. 없거나(정상) 실패하면(경합 등, 드묾) null.
    public async TryJoinWaitingRoom(user: UserInfo): Promise<WaitingRoomMatch | null> {
        const entry = await PopWaitingRoom();
        if (!entry) return null;

        try {
            const room_cache = await matchMaker.getRoomById(entry.room_id);
            const reservation = await matchMaker.reserveSeatFor(room_cache, {}, { user } satisfies GameSeatAuth);
            return {
                room_name: entry.room_name,
                room_id: entry.room_id,
                reservation,
                opponent: entry.opponent,
            };
        } catch (error) {
            // 그 사이 방이 사라졌거나(상대가 나감) 꽉 찬 경우 — 드문 경합. 이 유저는 새 방 매칭으로 넘어가면 된다.
            console.warn(
                `[RoomManager] 기다리는 방 입장 실패, 새 매칭으로 넘어감 (room_id=${entry.room_id}):`,
                error instanceof Error ? error.message : error
            );
            return null;
        }
    }

    // 2명을 위한 새 게임방을 만든다. 지금 켜져 있는 채널 중 번호가 빠른 순으로 채우고, 꽉 차면 다음 채널.
    // 켜진 채널이 하나도 없거나 전부 실패하면 null.
    //
    // ⚠️ 채널 번호를 1..GAME_CHANNEL_COUNT 로 무조건 순회하지 않고, 하트비트로 "지금 켜져 있는 채널"만
    // 추린다(GetAliveGameChannels) — 게임 채널이 고정적으로 항상 다 떠 있는 게 아니라 개별적으로 내려갈
    // 수 있기 때문이다(CLAUDE.md "무중단 게임 서비스" 참고). 꺼진 채널까지 시도하면 matchMaker.createRoom()
    // 이 그 룸 타입을 모르는 엉뚱한(로드가 가장 적은) 프로세스로 라우팅됐다가 "provided room name not
    // defined" 로 실패하는 문제가 실제로 있었다 — Colyseus 자체에는 "어떤 프로세스가 어떤 룸 이름을
    // 처리하는지" 클러스터 전체에서 조회할 방법이 없어서, 하트비트를 직접 만들어 확인한다.
    public async CreateRoomForTwo(user_a: UserInfo, user_b: UserInfo): Promise<NewRoomMatch | null> {
        const alive_channel_numbers = await GetAliveGameChannels(GAME_CHANNEL_COUNT);

        for (const channel_no of alive_channel_numbers) {
            const room_name = GetGameRoomName(channel_no);

            const existing_rooms = await matchMaker.query({ name: room_name });
            if (existing_rooms.length >= MAX_ROOMS_PER_GAME_CHANNEL) {
                continue; // 이 채널 꽉 참 — 다음 채널 시도
            }

            try {
                const room_cache = await matchMaker.createRoom(room_name, {});
                const reservation_a = await matchMaker.reserveSeatFor(room_cache, {}, { user: user_a } satisfies GameSeatAuth);
                const reservation_b = await matchMaker.reserveSeatFor(room_cache, {}, { user: user_b } satisfies GameSeatAuth);
                return { room_name, room_id: room_cache.roomId, reservation_a, reservation_b };
            } catch (error) {
                console.error(`[RoomManager] ${room_name} 방 생성/좌석 예약 실패:`, error instanceof Error ? error.message : error);
                // 이 채널에서 문제가 생기면 다음 채널로 넘어간다
            }
        }
        return null; // 켜진 채널이 없거나 전부 꽉 찼거나 실패 — NO_GAME_ROOM
    }
}

export { ToPublicOpponentInfo };
