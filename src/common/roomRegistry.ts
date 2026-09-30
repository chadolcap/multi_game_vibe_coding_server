// 이 프로세스(로비/게임 채널) 안에서 살아있는 Room 인스턴스를 추적한다.
// Watcher 는 별도 프로세스라 이 레지스트리를 직접 조회할 수 없다 — 여기 정보는
// (1) SEND_NOTICE 브로드캐스트(이 프로세스에 붙어 있는 클라이언트에게 즉시 전달)와
// (2) 채널 유저 리포터(db/channelUsers.ts, 이 정보를 주기적으로 Redis 에 올려 Watcher 가 읽게 함)
// 두 용도로만 쓴다. LobbyRoom/GameRoom 이 onCreate 에서 등록하고 onDispose 에서 해제한다.

import type { Room } from "@colyseus/core";
import type { AdminChannelUserEntry } from "./types.js";

interface RegisteredRoom {
    room: Room;
    GetUserEntries: () => AdminChannelUserEntry[];
}

const rooms = new Map<Room, RegisteredRoom>();

export function RegisterRoom(room: Room, GetUserEntries: () => AdminChannelUserEntry[]): void {
    rooms.set(room, { room, GetUserEntries });
}

export function UnregisterRoom(room: Room): void {
    rooms.delete(room);
}

// SEND_NOTICE 브로드캐스트용 — 이 프로세스에 등록된 모든 Room (로비는 1개, 게임은 여러 개일 수 있다)
export function GetRegisteredRooms(): Room[] {
    return [...rooms.values()].map((entry) => entry.room);
}

// 채널 유저 리포터용 — 같은 room_name(예: "game_1")을 가진 모든 Room 인스턴스의 유저 목록을 합친다.
export function GetUserEntriesByRoomName(room_name: string): AdminChannelUserEntry[] {
    const result: AdminChannelUserEntry[] = [];
    for (const entry of rooms.values()) {
        if (entry.room.roomName === room_name) {
            result.push(...entry.GetUserEntries());
        }
    }
    return result;
}
