// 로비 룸 — 로비에서 이뤄지는 구매, 광고 보기 등의 컨텐츠 처리
// Phase 1: 서버 기동 확인용 빈 룸. 입장 처리(ENTER_LOBBY)는 Phase 3 에서 LobbyManager 와 함께 구현한다.

import { Room, type Client } from "@colyseus/core";
import { MAX_CLIENTS_PER_CHANNEL } from "../../common/constants.js";

export class LobbyRoom extends Room {
    maxClients = MAX_CLIENTS_PER_CHANNEL;

    onCreate(options: unknown): void {
        console.log(`[LobbyRoom] 생성됨 roomName=${this.roomName} roomId=${this.roomId}`);
    }

    onJoin(client: Client): void {
        console.log(`[LobbyRoom] 접속 sessionId=${client.sessionId} (현재 ${this.clients.length}명)`);
    }

    onLeave(client: Client, code?: number): void {
        console.log(`[LobbyRoom] 퇴장 sessionId=${client.sessionId} code=${code}`);
    }

    onDispose(): void {
        console.log(`[LobbyRoom] 제거됨 roomId=${this.roomId}`);
    }
}
