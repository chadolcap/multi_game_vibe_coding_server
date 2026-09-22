// DB / Redis 캐시에서만 쓰는 타입 — 개인정보(phone)를 포함하므로 클라이언트에는 그대로 보내지 않는다.
// 클라이언트에 보낼 때는 ToPublicUserInfo() 로 phone 을 뺀 UserInfo 로 변환한다.

import type { UserInfo } from "../common/types.js";

export interface CachedUserInfo extends UserInfo {
    phone: string;
}

// 첫 접속 유저 등록에 필요한 값
export interface NewUserInput {
    userid: string;
    partner: string;
    mid: string;
    gender: string;
    phone: string;
}

export function ToPublicUserInfo(user: CachedUserInfo): UserInfo {
    const { phone: _phone, ...public_info } = user;
    return public_info;
}
