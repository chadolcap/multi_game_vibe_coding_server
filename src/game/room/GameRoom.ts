// 실제 게임룰이 진행되는 모듈 (2인이 게임을 하는 로직 — 가위바위보 규칙 자체는 Phase 5 에서 구현).
// Phase 4 에서는 "좌석 예약으로만 입장 가능한 잠긴 방"과 "10초 안에 2명이 안 모이면 정리" 만 다룬다.

import { Room, CloseCode, type Client } from "@colyseus/core";
import { PLAYERS_PER_ROOM, SEAT_RESERVATION_SEC } from "../../common/constants.js";
import { SendMessage } from "../../common/messages.js";
import { MessageType, type GameSeatAuth, type UserInfo } from "../../common/types.js";

export class GameRoom extends Room {
    maxClients = PLAYERS_PER_ROOM;

    // sessionId → 좌석 예약에 담겨 온 유저 정보 (Redis/DB 조회 없이 바로 사용)
    private readonly players = new Map<string, UserInfo>();

    onCreate(): void {
        // 이름/roomId 로 직접 들어올 수 없게 잠근다 — 예약된 좌석으로만 입장 가능
        this.lock();
        console.log(`[GameRoom] 생성됨 roomName=${this.roomName} roomId=${this.roomId}`);

        // 좌석 예약 후 SEAT_RESERVATION_SEC 안에 2명이 다 안 모이면 정리한다
        this.clock.setTimeout(() => this.CheckSeatFillTimeout(), SEAT_RESERVATION_SEC * 1000);
    }

    onJoin(client: Client, _options: unknown, auth?: GameSeatAuth): void {
        if (!auth?.user) {
            // 정상 흐름이라면 항상 RoomManager 가 좌석 예약에 유저 정보를 담아 보낸다.
            // 여기 걸리면 좌석 예약 없이(버그 또는 부정 접근으로) 들어온 것이다.
            console.error(`[GameRoom] auth.user 없이 입장 시도 sessionId=${client.sessionId}`);
            client.leave(CloseCode.WITH_ERROR);
            return;
        }

        this.players.set(client.sessionId, auth.user);
        console.log(
            `[GameRoom] 입장 sessionId=${client.sessionId} userid=${auth.user.userid} (현재 ${this.clients.length}/${this.maxClients}명)`
        );
        // Phase 5: 두 명 모두 ROOM_ENTER_ACK 를 보내면 GAME_START 전송
    }

    onLeave(client: Client, code?: number): void {
        console.log(`[GameRoom] 퇴장 sessionId=${client.sessionId} code=${code}`);
        this.players.delete(client.sessionId);
        // Phase 6 에서 allowReconnection 으로 재접속 유예(5초) 처리 추가
    }

    onDispose(): void {
        console.log(`[GameRoom] 제거됨 roomId=${this.roomId}`);
    }

    private CheckSeatFillTimeout(): void {
        if (this.clients.length === PLAYERS_PER_ROOM) {
            return; // 정상 — 2명 다 들어옴
        }

        if (this.clients.length === 1) {
            // 새로 만든 방에서 한 명만 들어온 경우 — 로비로 돌려보낸다.
            // ("기다리는 방"에 들어오기로 한 유저가 안 온 경우의 재등록 처리는 Phase 5 에서 추가)
            SendMessage(this.clients[0], MessageType.RETURN_TO_LOBBY, {});
        }

        this.disconnect(CloseCode.WITH_ERROR);
    }
}
