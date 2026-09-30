// 유저 정보 조회 진입점 (Redis → DB 순). 매니저(Lobby/Room/Watcher)는 이 모듈만 호출한다.
// (CLAUDE.md "유저 정보 처리 단계" 1~5 구현)

import { ConvertMidToUserid, GetDefaultAvatar } from "../common/userid.js";
import type { EnterLobbyPayload, UserInfo } from "../common/types.js";
import { GetDbPool } from "./connection.js";
import { FetchUserInfo } from "./queries/userInfo.js";
import { RegisterNewUser, TrySetUserName, UpdatePhoneIfChanged, type SetNameDbResult } from "./queries/userRegistration.js";
import { GetUserCache, SaveUserCache } from "./userCache.js";
import { ToPublicUserInfo, type CachedUserInfo } from "./types.js";

export interface GetOrCreateUserResult {
    user: UserInfo;
    is_new_user: boolean;
}

// (partner, mid) 로 유저를 찾는다. 없으면 새로 만든다. phone 이 바뀌었으면 갱신한다.
// 호출 전에 partner/mid/gender/phone 형식은 이미 검사되어 있어야 한다 (LobbyManager, Phase 3).
export async function GetOrCreateUser(input: EnterLobbyPayload): Promise<GetOrCreateUserResult> {
    const userid = ConvertMidToUserid(input.partner, input.mid);
    const pool = GetDbPool();

    let user: CachedUserInfo | null = await GetUserCache(userid);
    let is_new_user = false;

    if (!user) {
        user = await FetchUserInfo(pool, userid);

        if (!user) {
            // 첫 접속 유저 — 여러 번/동시에 호출돼도 RegisterNewUser 가 한 번만 만들어지게 처리한다
            await RegisterNewUser(pool, {
                userid,
                partner: input.partner,
                mid: input.mid,
                gender: input.gender,
                phone: input.phone,
            });
            user = {
                userid,
                name: "",
                avatar: GetDefaultAvatar(input.gender),
                gender: input.gender,
                phone: input.phone,
                total_game_count: 0,
                total_win_count: 0,
                today_game_count: 0,
                today_win_count: 0,
            };
            is_new_user = true;
        }
    }

    // 기존 유저가 이전과 다른 phone 을 보냈으면 갱신 (새 유저는 이미 등록 시점에 반영됨)
    if (!is_new_user && user.phone !== input.phone) {
        const changed = await UpdatePhoneIfChanged(pool, userid, input.phone);
        if (changed) {
            user = { ...user, phone: input.phone };
        }
    }

    // 로비 입장 직후 — 값이 바뀌었을 수 있으니 매번 Redis 에 다시 저장한다 (write-through, TTL 갱신 겸함)
    await SaveUserCache(user);

    return { user: ToPublicUserInfo(user), is_new_user };
}

export type SetNameResult = "ok" | "duplicate";

// NAME 등록 — 별명이 아직 없는 유저만 한 번 등록할 수 있다 (DB 의 UNIQUE 제약이 최종 방어선).
// 성공하면 Redis 캐시에도 반영한다 (write-through). 호출 전에 name 형식/금칙어 검사는 끝나 있어야 한다.
export async function SetUserName(userid: string, name: string): Promise<SetNameResult> {
    const pool = GetDbPool();
    const db_result: SetNameDbResult = await TrySetUserName(pool, userid, name);
    if (db_result === "duplicate") return "duplicate";

    // 캐시에 없으면(TTL 만료 등) DB 에서 다시 읽어 채운 뒤 저장한다
    let cached = await GetUserCache(userid);
    if (!cached) {
        cached = await FetchUserInfo(pool, userid);
    }
    if (cached) {
        await SaveUserCache({ ...cached, name });
    }
    return "ok";
}
