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
import {
    GetChannelId,
    GetChannelPort,
    GetGameRoomName,
    GetLobbyRoomName,
    GetWatcherRoomName,
    type ChannelType,
} from "./common/channelNames.js";
import { GetUserEntriesByRoomName } from "./common/roomRegistry.js";
import { SelectProcessIdForRoom, StartChannelHeartbeat } from "./db/channelHeartbeat.js";
import { StartChannelUsersReporter } from "./db/channelUsers.js";
import { SubscribeNotice } from "./db/noticePubSub.js";
import { LobbyRoom } from "./game/lobby/LobbyRoom.js";
import { GameRoom } from "./game/room/GameRoom.js";
import { WatcherRoom } from "./watch/WatcherRoom.js";

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

    // 관리자 계정이 .env 에 없으면(빈 문자열) 누구나 빈 비밀번호로 로그인 가능한 사고로 이어질 수 있어
    // Watcher 채널 자체를 기동하지 않는다 (config.ts 참고).
    if (channel_type === "watcher" && (config.admin_id === "" || config.admin_password === "")) {
        throw new Error("ADMIN_ID / ADMIN_PASSWORD 가 .env 에 설정되어 있지 않습니다 (Watcher 채널 기동 거부)");
    }

    // 로비 프로세스가 다른 프로세스(게임 채널)의 방에 좌석을 예약하려면, 모든 채널이
    // 같은 Redis 를 통해 방 목록/좌석 예약 요청을 주고받아야 한다 (Presence = pub/sub, Driver = 방 목록 저장소).
    const redis_options = { host: config.redis_host, port: config.redis_port };
    const server = new Server({
        transport: new WebSocketTransport({ server: CreateHttpServer() }),
        presence: new RedisPresence(redis_options),
        driver: new RedisDriver(redis_options),
        // ⚠️ 채널마다 프로세스/포트가 다르므로 반드시 필요하다. 이게 없으면 클라이언트가
        // consumeSeatReservation() 을 호출할 때 "원래 접속했던 주소"(로비)로 다시 연결을 시도해서,
        // 좌석이 실제로 있는 게임 채널(다른 포트)에 닿지 못하고 "seat reservation expired" 로 실패한다.
        // (실제로 재현해서 확인한 문제 — 나중에 ip/port 를 명시로 응답하는 방식으로 바뀌면 이 옵션은 필요 없어진다)
        publicAddress: `${config.public_host}:${port}`,
        // ⚠️ Colyseus 기본 room 생성 라우팅(selectProcessIdToCreateRoom)은 roomName 을 안 보고 그냥
        // "방이 가장 적은 프로세스"를 고른다 — 로비/게임이 같은 클러스터(같은 Redis)를 공유하는 이 프로젝트
        // 구조에서는, 게임 채널에 방이 쌓이면 오히려 game_N 을 전혀 모르는 로비 프로세스가 선택돼
        // "provided room name not defined" 로 실패하는 걸 실제로 겪었다(db/channelHeartbeat.ts 참고).
        // 우리 하트비트로 "이 채널을 처리하는 프로세스"를 정확히 지목하도록 기본 로직을 교체한다.
        selectProcessIdToCreateRoom: SelectProcessIdForRoom,
    });

    if (channel_type === "lobby") {
        server.define(GetLobbyRoomName(channel_no), LobbyRoom);
    } else if (channel_type === "game") {
        server.define(GetGameRoomName(channel_no), GameRoom);
    } else {
        server.define(GetWatcherRoomName(), WatcherRoom);
    }

    // matchMaker.accept() 가 listen() 안에서 실행되므로, 룸을 미리 만드는 작업은 listen() 이후에 한다
    await server.listen(port);

    // 이 채널이 "지금 켜져 있음" + "이 프로세스가 처리한다" 를 Redis 에 표시한다 — 로비가 game_N 채널로
    // 매칭할 때 켜진 채널만 고르는 데(RoomManager.CreateRoomForTwo) 쓰고, SelectProcessIdForRoom 이
    // 방 생성을 정확한 프로세스로 라우팅하는 데도 쓴다. 최초 1회 완료를 기다린 뒤에 이어져야
    // (아래 로비 룸 생성이 이 하트비트를 바로 조회하므로) 안전하다.
    await StartChannelHeartbeat(channel_type, channel_no, matchMaker.processId);

    if (channel_type === "lobby") {
        const lobby_room_name = GetLobbyRoomName(channel_no);
        // 로비 룸은 사람이 없어도 사라지지 않아야 하므로(autoDispose=false), 매칭 요청을 기다리지 않고
        // 서버 기동 시점에 바로 만들어 둔다.
        await matchMaker.createRoom(lobby_room_name, {});
        console.log(`[${channel_id}] ${lobby_room_name} 룸을 미리 생성했습니다`);
    } else if (channel_type === "watcher") {
        // Watcher 룸도 로비와 같은 이유로(관리자가 없어도 유지) 미리 만들어 둔다.
        const watcher_room_name = GetWatcherRoomName();
        await matchMaker.createRoom(watcher_room_name, {});
        console.log(`[${channel_id}] ${watcher_room_name} 룸을 미리 생성했습니다`);
    }

    if (channel_type === "lobby" || channel_type === "game") {
        const room_name = channel_type === "lobby" ? GetLobbyRoomName(channel_no) : GetGameRoomName(channel_no);
        // 관리자 공지(SEND_NOTICE) 수신 대기 — Watcher 가 SEND_NOTICE 를 받으면 Redis Pub/Sub 로 모든
        // 로비/게임 채널에 전파하고, 이 구독이 "내 room_name 이 관리자가 고른 채널 목록에 있는지" 확인한
        // 뒤에만 이 프로세스에 붙어 있는 클라이언트에게 뿌린다.
        SubscribeNotice(room_name);
        // ADMIN_CHANNEL_USER 조회용 — 이 채널의 접속자 목록을 주기적으로 Redis 에 올려 둔다.
        StartChannelUsersReporter(room_name, () => GetUserEntriesByRoomName(room_name));
    }

    const protocol = config.use_tls ? "wss" : "ws";
    console.log(`[${channel_id}] 서버 시작 ${protocol}://localhost:${port}`);
}

Main().catch((error) => {
    console.error("[index] 서버 시작 실패:", error instanceof Error ? error.message : error);
    process.exit(1);
});
