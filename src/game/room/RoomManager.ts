// 로비에서 온 유저를 게임방에 입장시키는 역할 (로비 프로세스 안에서 동작하며,
// Redis 기반 Presence/Driver 를 통해 다른 프로세스(게임 채널)의 방에 좌석을 예약한다).

import { matchMaker } from "@colyseus/core";
import { GAME_CHANNEL_COUNT, MAX_ROOMS_PER_GAME_CHANNEL } from "../../common/constants.js";
import { GetGameRoomName } from "../../common/channelNames.js";
import type { GameSeatAuth, OpponentInfo, SeatReservation, UserInfo } from "../../common/types.js";
import { PopWaitingRoom } from "./waitingRooms.js";

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

function ToPublicOpponentInfo(user: UserInfo): OpponentInfo {
    return { name: user.name, avatar: user.avatar };
}

export class RoomManager {
    // "기다리는 방"이 있으면 유저 1명을 그 방에 넣는다. 없거나(정상) 실패하면(경합 등, 드묾) null.
    async TryJoinWaitingRoom(user: UserInfo): Promise<WaitingRoomMatch | null> {
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

    // 2명을 위한 새 게임방을 만든다. 1번 채널부터 채우고 꽉 차면 다음 채널. 3개 채널 모두 꽉 찼으면 null.
    async CreateRoomForTwo(user_a: UserInfo, user_b: UserInfo): Promise<NewRoomMatch | null> {
        for (let channel_no = 1; channel_no <= GAME_CHANNEL_COUNT; channel_no++) {
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
        return null; // 3개 채널 모두 실패 — NO_GAME_ROOM
    }
}

export { ToPublicOpponentInfo };
