// 채널 ID / 룸 이름 규칙
// - 채널 번호(channel_no)는 **1부터** 센다. (channel_no == 채널 ID, 둘이 같은 값)
// - Colyseus 룸 이름은 채널마다 따로 등록하며, 채널별 통계도 이 이름으로 구분한다.

import { config } from "./config.js";
import { GAME_CHANNEL_COUNT } from "./constants.js";

export type ChannelType = "watcher" | "lobby" | "game";

// Watcher 룸 이름 — 채널이 1개뿐이라 번호를 붙이지 않는다
export function GetWatcherRoomName(): string {
    return "watcher";
}

// 로비 룸 이름: lobby_1, lobby_2
export function GetLobbyRoomName(channel_no: number): string {
    return `lobby_${channel_no}`;
}

// 게임 룸 이름: game_1, game_2, game_3
export function GetGameRoomName(channel_no: number): string {
    return `game_${channel_no}`;
}

// GetGameRoomName 의 역변환 — "game_2" → 2. GameRoom 은 자기 채널 번호를 따로 안 들고 있어서
// "기다리는 방" 등록(WaitingRoomEntry.channel_no) 시 this.roomName 에서 이걸로 구한다
export function ParseGameChannelNo(room_name: string): number {
    const match = /^game_(\d+)$/.exec(room_name);
    if (!match) throw new Error(`게임 룸 이름 형식이 아닙니다: ${room_name}`);
    return Number(match[1]);
}

// 채널 ID (로그/통계 표시용): lobby-1, game-3 처럼 종류별로 1부터. channel_no 와 같은 값이라 그대로 이어 붙인다
export function GetChannelId(channel_type: ChannelType, channel_no: number): string {
    return `${channel_type}-${channel_no}`;
}

// 채널 종류와 번호로 포트를 찾는다. 범위를 벗어나면 에러
export function GetChannelPort(channel_type: ChannelType, channel_no: number): number {
    if (channel_type === "watcher") {
        if (channel_no !== 1) throw new Error(`watcher 채널은 1번 하나뿐입니다: ${channel_no}`);
        return config.watcher_port;
    }

    const ports = channel_type === "lobby" ? config.lobby_ports : config.game_ports;
    // 로비 채널 수는 상수(GAME_CHANNEL_COUNT 처럼 코드에 박아두지 않음)가 아니라 .env 의 LOBBY_PORTS 목록
    // 길이로 정한다 — 로비 채널은 서로 독립적이라(매칭 시 다른 로비 채널을 알 필요 없음) 다른 프로세스가
    // "몇 개인지"를 알아야 할 이유가 없다. 그래서 트래픽이 몰릴 때 .env 에 포트만 추가하고 그 채널
    // 프로세스만 새로 띄우면 되고, 코드 수정/재빌드나 이미 떠 있는 다른 채널 재시작이 필요 없다.
    // (게임 채널은 RoomManager 가 "지금 켜진 채널 몇 번까지 있는지"를 알아야 해서 GAME_CHANNEL_COUNT 를
    // 그대로 쓴다 — CLAUDE.md "로비/게임 채널 늘리기" 참고)
    const channel_count = channel_type === "lobby" ? ports.length : GAME_CHANNEL_COUNT;

    if (!Number.isInteger(channel_no) || channel_no < 1 || channel_no > channel_count) {
        throw new Error(`${channel_type} 채널 번호는 1~${channel_count} 이어야 합니다: ${channel_no}`);
    }
    const port = ports[channel_no - 1];
    if (port === undefined) {
        throw new Error(`${channel_type} ${channel_no}번 채널의 포트 설정이 없습니다 (.env 확인)`);
    }
    return port;
}
