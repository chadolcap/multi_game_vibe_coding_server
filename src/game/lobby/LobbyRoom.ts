// 로비 룸 — 소켓 이벤트를 받아 LobbyManager 에 위임한다.
// 실제 로비 콘텐츠(구매, 광고 보기 등)는 나중에 이 파일에 추가한다 (지금은 ENTER_LOBBY 처리만).

import { Room, CloseCode, type Client } from "@colyseus/core";
import type { Delayed } from "@colyseus/timer";
import { ENTER_LOBBY_TIMEOUT_SEC, MAX_CLIENTS_PER_CHANNEL } from "../../common/constants.js";
import { LogConnect, LogDisconnect, RegisterLoggedMessage } from "../../common/log.js";
import { SendError, SendResult } from "../../common/messages.js";
import { EnterLobbyErrorCode, ErrorCode, MessageType, type JoinMatchPayload } from "../../common/types.js";
import { RegisterRoom, UnregisterRoom } from "../../common/roomRegistry.js";
import { LobbyManager } from "./LobbyManager.js";

export class LobbyRoom extends Room {
    // 채널당 1개만 만들어지고, 사람이 0명이어도 사라지지 않는다 (서버 기동 시 미리 생성)
    autoDispose = false;

    private readonly manager = new LobbyManager(this);
    // sessionId → ENTER_LOBBY 제한 시간 타이머. 입장 성공하거나 연결이 끊기면 지운다.
    private readonly enter_timeout_timers = new Map<string, Delayed>();

    public onCreate(): void {
        console.log(`[LobbyRoom] 생성됨 roomName=${this.roomName} roomId=${this.roomId}`);

        // SEND_NOTICE 브로드캐스트 + 채널 유저 리포터(Watcher 의 ADMIN_CHANNEL_USER 용)가 이 방을 찾을 수 있도록 등록
        RegisterRoom(this, () => this.manager.GetWaitingUserids().map((userid) => ({ userid })));

        // RegisterLoggedMessage 로 등록하면 메시지가 도착할 때마다 [C→S] 로그가 자동으로 남는다.
        RegisterLoggedMessage(this, MessageType.ENTER_LOBBY, async (client, message) => {
            // ⚠️ 채널 인원 제한은 onJoin 이 아니라 여기(ENTER_LOBBY 처리 시점)에서 검사한다.
            // Colyseus 클라이언트는 JOIN_ROOM 핸드셰이크를 마치기 전(onJoin 실행 시점)에는
            // 서버가 보낸 메시지를 큐에만 쌓아 두고 실제로 전송하지 않는다. onJoin 안에서 바로
            // client.leave() 를 호출하면 그 큐가 플러시될 기회가 없어 ERROR 메시지가 끝내 전달되지
            // 않는다. ENTER_LOBBY 는 클라이언트가 핸드셰이크를 마친 뒤에만 도착하므로 여기는 안전하다.
            if (this.clients.length > MAX_CLIENTS_PER_CHANNEL) {
                // 문서의 ENTER_LOBBY 결과 응답 형식(같은 type 으로 result/error)을 그대로 따른다.
                // 채널 인원 초과는 문서 taxonomy 에 없어 "기타(3)" 로 응답한다.
                SendResult(this, client, MessageType.ENTER_LOBBY, "N", EnterLobbyErrorCode.OTHER);
                client.leave(CloseCode.WITH_ERROR);
                return;
            }

            const entered = await this.manager.HandleEnterLobby(client, message);
            if (entered) {
                this.ClearEnterTimeout(client.sessionId);
            }
        });

        RegisterLoggedMessage(this, MessageType.NAME, async (client, message) => {
            await this.manager.HandleName(client, message);
        });

        RegisterLoggedMessage(this, MessageType.PLAY_INFO, (client) => {
            this.manager.HandlePlayInfo(client);
        });

        RegisterLoggedMessage(this, MessageType.RANK_DAILY, async (client) => {
            await this.manager.HandleRankDaily(client);
        });

        RegisterLoggedMessage(this, MessageType.RANK_WEEKLY, async (client) => {
            await this.manager.HandleRankWeekly(client);
        });

        RegisterLoggedMessage<JoinMatchPayload>(this, MessageType.JOIN_MATCH, async (client, message) => {
            await this.manager.HandleJoinMatch(client, message);
        });
    }

    public onJoin(client: Client): void {
        LogConnect(this, client);

        const timer = this.clock.setTimeout(() => {
            SendError(this, client, ErrorCode.ENTER_TIMEOUT, "제한 시간 안에 ENTER_LOBBY 를 보내지 않았습니다.");
            client.leave(CloseCode.WITH_ERROR);
        }, ENTER_LOBBY_TIMEOUT_SEC * 1000);
        this.enter_timeout_timers.set(client.sessionId, timer);
    }

    public async onLeave(client: Client, code?: number): Promise<void> {
        LogDisconnect(this, client, code);
        this.ClearEnterTimeout(client.sessionId);
        await this.manager.HandleLeave(client);
    }

    public onDispose(): void {
        UnregisterRoom(this);
        console.log(`[LobbyRoom] 제거됨 roomId=${this.roomId}`);
    }

    private ClearEnterTimeout(sessionId: string): void {
        this.enter_timeout_timers.get(sessionId)?.clear();
        this.enter_timeout_timers.delete(sessionId);
    }
}
