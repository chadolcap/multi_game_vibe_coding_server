// 서버 진입점 — 실행할 때 "어떤 채널로 켤지" 를 받아 해당 포트로 서버 하나를 기동한다.
// 사용법: node dist/index.js <watcher|lobby|game> <채널 번호>   (채널 번호는 1부터)
//   예) node dist/index.js lobby 1   → lobby_1 룸, 포트 6011
// 채널 하나 = 서버 프로세스 하나 = 포트 하나 (CLAUDE.md 규모 스펙)

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { config } from "./common/config.js";
import { GetChannelId, GetChannelPort, GetLobbyRoomName, type ChannelType } from "./common/channelNames.js";
import { LobbyRoom } from "./game/lobby/LobbyRoom.js";

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

    const server = new Server({
        transport: new WebSocketTransport({ server: CreateHttpServer() }),
    });

    if (channel_type === "lobby") {
        server.define(GetLobbyRoomName(channel_no), LobbyRoom);
    } else if (channel_type === "game") {
        // Phase 4 에서 GameRoom 등록
        console.log(`[${channel_id}] 게임 채널 룸은 Phase 4 에서 등록합니다`);
    } else {
        // Phase 7 에서 Watcher 룸 등록
        console.log(`[${channel_id}] Watcher 룸은 Phase 7 에서 등록합니다`);
    }

    await server.listen(port);
    const protocol = config.use_tls ? "wss" : "ws";
    console.log(`[${channel_id}] 서버 시작 ${protocol}://localhost:${port}`);
}

Main().catch((error) => {
    console.error("[index] 서버 시작 실패:", error instanceof Error ? error.message : error);
    process.exit(1);
});
