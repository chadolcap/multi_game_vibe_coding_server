// 서버 진입점 — 실행할 때 "어떤 채널로 켤지" 를 받아 해당 포트로 서버 하나를 기동한다.
// 사용법: node dist/index.js <watcher|lobby|game> <채널 번호>   (채널 번호는 1부터)
//   예) node dist/index.js lobby 1   → lobby_1 룸, 포트 6011
// 채널 하나 = 서버 프로세스 하나 = 포트 하나 (CLAUDE.md 규모 스펙)

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { Server, matchMaker } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RedisPresence } from "@colyseus/redis-presence";
import { RedisDriver } from "@colyseus/redis-driver";
import { config } from "./common/config.js";
import { GetChannelId, GetChannelPort, GetGameRoomName, GetLobbyRoomName, type ChannelType } from "./common/channelNames.js";
import { LobbyRoom } from "./game/lobby/LobbyRoom.js";
import { GameRoom } from "./game/room/GameRoom.js";

function ParseArgs(): { channel_type: ChannelType; channel_no: number } {
    const [type_arg, no_arg] = process.argv.slice(2);

    if (type_arg !== "watcher" && type_arg !== "lobby" && type_arg !== "game") {
        throw new Error("사용법: node dist/index.js <watcher|lobby|game> <채널 번호>");
    }
    const channel_no = Number(no_arg ?? "1");
    if (!Number.isInteger(channel_no)) {
        throw new Error(`채널 번호는 정수여야 합니다: ${no_arg}`);
    }
    return { channel_type: type_arg, channel_no };
}

// wss(TLS) 사용 시 https 서버, 아니면 http 서버 위에 WebSocket 을 올린다
function CreateHttpServer(): http.Server | https.Server {
    if (!config.use_tls) {
        return http.createServer();
    }
    if (!config.tls_cert_path || !config.tls_key_path) {
        throw new Error("USE_TLS=true 이면 TLS_CERT_PATH, TLS_KEY_PATH 를 .env 에 설정해야 합니다");
    }
    return https.createServer({
        cert: fs.readFileSync(config.tls_cert_path),
        key: fs.readFileSync(config.tls_key_path),
    });
}

async function Main(): Promise<void> {
    const { channel_type, channel_no } = ParseArgs();
    const port = GetChannelPort(channel_type, channel_no);
    const channel_id = GetChannelId(channel_type, channel_no);

    // 로비 프로세스가 다른 프로세스(게임 채널)의 방에 좌석을 예약하려면, 모든 채널이
    // 같은 Redis 를 통해 방 목록/좌석 예약 요청을 주고받아야 한다 (Presence = pub/sub, Driver = 방 목록 저장소).
    const redis_options = { host: config.redis_host, port: config.redis_port };
    const server = new Server({
        transport: new WebSocketTransport({ server: CreateHttpServer() }),
        presence: new RedisPresence(redis_options),
        driver: new RedisDriver(redis_options),
    });

    if (channel_type === "lobby") {
        server.define(GetLobbyRoomName(channel_no), LobbyRoom);
    } else if (channel_type === "game") {
        server.define(GetGameRoomName(channel_no), GameRoom);
    } else {
        // Phase 7 에서 Watcher 룸 등록
        console.log(`[${channel_id}] Watcher 룸은 Phase 7 에서 등록합니다`);
    }

    // matchMaker.accept() 가 listen() 안에서 실행되므로, 룸을 미리 만드는 작업은 listen() 이후에 한다
    await server.listen(port);

    if (channel_type === "lobby") {
        const lobby_room_name = GetLobbyRoomName(channel_no);
        // 로비 룸은 사람이 없어도 사라지지 않아야 하므로(autoDispose=false), 매칭 요청을 기다리지 않고
        // 서버 기동 시점에 바로 만들어 둔다.
        await matchMaker.createRoom(lobby_room_name, {});
        console.log(`[${channel_id}] ${lobby_room_name} 룸을 미리 생성했습니다`);
    }

    const protocol = config.use_tls ? "wss" : "ws";
    console.log(`[${channel_id}] 서버 시작 ${protocol}://localhost:${port}`);
}

Main().catch((error) => {
    console.error("[index] 서버 시작 실패:", error instanceof Error ? error.message : error);
    process.exit(1);
});
