// 채널 ID / 룸 이름 규칙
// - 채널 번호(channel_no)는 **1부터** 센다. (channel_no == 채널 ID, 둘이 같은 값)
// - Colyseus 룸 이름은 채널마다 따로 등록하며, 채널별 통계도 이 이름으로 구분한다.

import { config } from "./config.js";
import { GAME_CHANNEL_COUNT, LOBBY_CHANNEL_COUNT } from "./constants.js";

export type ChannelType = "watcher" | "lobby" | "game";

// 로비 룸 이름: lobby_1, lobby_2
export function GetLobbyRoomName(channel_no: number): string {
    return `lobby_${channel_no}`;
}

// 게임 룸 이름: game_1, game_2, game_3
export function GetGameRoomName(channel_no: number): string {
    return `game_${channel_no}`;
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
    const channel_count = channel_type === "lobby" ? LOBBY_CHANNEL_COUNT : GAME_CHANNEL_COUNT;

    if (!Number.isInteger(channel_no) || channel_no < 1 || channel_no > channel_count) {
        throw new Error(`${channel_type} 채널 번호는 1~${channel_count} 이어야 합니다: ${channel_no}`);
    }
    const port = ports[channel_no - 1];
    if (port === undefined) {
        throw new Error(`${channel_type} ${channel_no}번 채널의 포트 설정이 없습니다 (.env 확인)`);
    }
    return port;
}
