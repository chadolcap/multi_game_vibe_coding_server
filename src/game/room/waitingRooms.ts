// "기다리는 방" 목록 — Redis 에 기록해 로비 프로세스가 볼 수 있게 한다 (CLAUDE.md 게임 규칙 12번).
// 게임방 프로세스(Phase 5 의 GameRoom)가 등록/삭제하고, 로비 프로세스(RoomManager)가 꺼내 쓴다.
// Redis LIST 를 FIFO 큐로 쓴다 — RPUSH(등록) / LPOP(꺼내기) 는 각각 원자적이라
// 로비 채널 2개가 동시에 같은 방을 집어가는 경합이 생기지 않는다.

import { GetRedisClient } from "../../db/redis.js";
import type { WaitingRoomEntry } from "./types.js";

const WAITING_ROOMS_KEY = "waiting_rooms";

// 방에 혼자 남은 유저가 생겼을 때 등록한다 (Phase 5 에서 사용)
export async function PushWaitingRoom(entry: WaitingRoomEntry): Promise<void> {
    await GetRedisClient().rpush(WAITING_ROOMS_KEY, JSON.stringify(entry));
}

// 가장 먼저 등록된 기다리는 방 하나를 꺼낸다. 없으면 null (원자적 — 여러 로비 프로세스가 동시에 불러도 안전)
export async function PopWaitingRoom(): Promise<WaitingRoomEntry | null> {
    const raw = await GetRedisClient().lpop(WAITING_ROOMS_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) as WaitingRoomEntry;
}

// 등록된 뒤 유저가 나가버리는 등, 대기를 그만둘 때 목록에서 지운다 (Phase 5 에서 사용).
// PushWaitingRoom 에 넘겼던 것과 내용이 같은 entry 를 넘겨야 정확히 지워진다.
export async function RemoveWaitingRoom(entry: WaitingRoomEntry): Promise<void> {
    await GetRedisClient().lrem(WAITING_ROOMS_KEY, 0, JSON.stringify(entry));
}
