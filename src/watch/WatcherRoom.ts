// 관리자(Watcher) 룸 — 소켓 이벤트를 받아 WatcherManager 에 위임한다.
// 채널 전체가 이 룸 1개뿐이라(로비처럼 번호를 붙이지 않음), 서버 기동 시 미리 생성해 둔다 (index.ts).
// 접속 직후 ADMIN_LOGIN 으로 로그인해야 하고, 실패하거나 제한 시간 안에 보내지 않으면 연결을 끊는다.

import { Room, CloseCode, type Client } from "@colyseus/core";
import type { Delayed } from "@colyseus/timer";
import * as constants from "../common/constants.js";
import * as log from "../common/log.js";
import * as messages from "../common/messages.js";
import * as types from "../common/types.js";
import type { AdminChannelUserQuery, AdminLoginPayload, SendNoticePayload } from "../common/types.js";
import { WatcherManager } from "./WatcherManager.js";

export class WatcherRoom extends Room {
    // 채널이 1개뿐이고, 관리자가 없어도 사라지지 않아야 한다 (서버 기동 시 미리 생성)
    autoDispose = false;

    private readonly manager = new WatcherManager(this);
    // sessionId → ADMIN_LOGIN 제한 시간 타이머. 로그인 성공하거나 연결이 끊기면 지운다.
    private readonly login_timeout_timers = new Map<string, Delayed>();

    public onCreate(): void {
        console.log(`[WatcherRoom] 생성됨 roomName=${this.roomName} roomId=${this.roomId}`);

        log.RegisterLoggedMessage<AdminLoginPayload>(this, types.MessageType.ADMIN_LOGIN, (client, message) => {
            const success = this.manager.HandleAdminLogin(client, message);
            if (success) this.ClearLoginTimeout(client.sessionId);
        });

        log.RegisterLoggedMessage(this, types.MessageType.ADMIN_CHANNEL_COUNT, async (client) => {
            await this.manager.HandleChannelCount(client);
        });

        log.RegisterLoggedMessage<AdminChannelUserQuery>(this, types.MessageType.ADMIN_CHANNEL_USER, async (client, message) => {
            await this.manager.HandleChannelUser(client, message);
        });

        log.RegisterLoggedMessage<SendNoticePayload>(this, types.MessageType.SEND_NOTICE, async (client, message) => {
            await this.manager.HandleSendNotice(client, message);
        });
    }

    public onJoin(client: Client): void {
        log.LogConnect(this, client);

        // ⚠️ LobbyRoom 의 ENTER_LOBBY 타임아웃과 같은 이유로, 여기서 바로 client.leave() 하지 않고 타이머만
        // 건다 — onJoin 안에서는 클라이언트가 JOIN_ROOM 핸드셰이크를 마치기 전이라 서버가 보낸 메시지가
        // 실제로 전달되지 않는다 (CLAUDE.md 코딩 컨벤션 참고). 타임아웃 자체는 ADMIN_LOGIN 을 기다리는
        // 것이므로 이 타이머가 만료될 때 보내는 ERROR 는 핸드셰이크가 끝난 뒤라 문제없다.
        const timer = this.clock.setTimeout(() => {
            messages.SendError(this, client, types.ErrorCode.ENTER_TIMEOUT, "제한 시간 안에 ADMIN_LOGIN 을 보내지 않았습니다.");
            client.leave(CloseCode.WITH_ERROR);
        }, constants.ADMIN_LOGIN_TIMEOUT_SEC * 1000);
        this.login_timeout_timers.set(client.sessionId, timer);
    }

    public onLeave(client: Client, code?: number): void {
        log.LogDisconnect(this, client, code);
        this.ClearLoginTimeout(client.sessionId);
        this.manager.HandleLeave(client);
    }

    public onDispose(): void {
        console.log(`[WatcherRoom] 제거됨 roomId=${this.roomId}`);
    }

    private ClearLoginTimeout(sessionId: string): void {
        this.login_timeout_timers.get(sessionId)?.clear();
        this.login_timeout_timers.delete(sessionId);
    }
}
