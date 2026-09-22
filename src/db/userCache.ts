// 유저 정보 Redis 캐시 (키 user:info:{userid}, TTL 120초)

import { USER_CACHE_TTL_SEC } from "../common/constants.js";
import { GetJson, SetJson, Touch } from "./redis.js";
import type { CachedUserInfo } from "./types.js";

function GetUserCacheKey(userid: string): string {
    return `user:info:${userid}`;
}

export async function GetUserCache(userid: string): Promise<CachedUserInfo | null> {
    return GetJson<CachedUserInfo>(GetUserCacheKey(userid));
}

// 값 저장 + TTL 설정. 값이 바뀔 때 호출한다 (로비 입장 직후, 게임 결과 DB 반영 직후 — CLAUDE.md 흐름 9번)
export async function SaveUserCache(user: CachedUserInfo): Promise<void> {
    await SetJson(GetUserCacheKey(user.userid), user, USER_CACHE_TTL_SEC);
}

// TTL 만 다시 설정한다. 떠날 때 호출한다. 키가 이미 만료됐으면 SaveUserCache 로 다시 저장한다.
export async function TouchUserCache(user: CachedUserInfo): Promise<void> {
    const touched = await Touch(GetUserCacheKey(user.userid), USER_CACHE_TTL_SEC);
    if (!touched) {
        await SaveUserCache(user);
    }
}
