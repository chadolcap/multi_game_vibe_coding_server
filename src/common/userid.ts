// (partner, mid) → userid 변환 (CLAUDE.md 흐름 3번)
// - userid = partner + "_" + XOR(mid)
// - XOR: mid 의 글자 하나하나의 문자 코드에 key(5) 를 적용하고, 결과 숫자를 10진수 문자열로 이어 붙인다
//   (예: 'u'(117) ^ 5 = 112 → "112")
// - 단방향 변환이다. userid 로 mid 를 복원할 수 없다. (mid 가 필요하면 user_partner_info 에서 조회)

import { ALLOWED_GENDERS, MID_MAX_LENGTH, PARTNER_MAX_LENGTH, PHONE_MAX_LENGTH, USERID_XOR_KEY } from "./constants.js";

// partner: 영문/숫자 1~11자, '_' 포함 금지
const PARTNER_PATTERN = /^[A-Za-z0-9]{1,11}$/;
// mid: 영문/숫자 1~63자 (XOR 숫자열끼리 충돌하지 않도록 영문/숫자로 제한)
const MID_PATTERN = /^[A-Za-z0-9]{1,63}$/;

export function IsValidPartner(partner: unknown): partner is string {
    return typeof partner === "string" && partner.length <= PARTNER_MAX_LENGTH && PARTNER_PATTERN.test(partner);
}

export function IsValidMid(mid: unknown): mid is string {
    return typeof mid === "string" && mid.length <= MID_MAX_LENGTH && MID_PATTERN.test(mid);
}

// gender: F 또는 M 만 허용
export function IsValidGender(gender: unknown): gender is (typeof ALLOWED_GENDERS)[number] {
    return typeof gender === "string" && (ALLOWED_GENDERS as readonly string[]).includes(gender);
}

// phone: 빈 값 불가, 텍스트 최대 100자 (형식은 자유 — 파트너사마다 다를 수 있어 숫자만으로 제한하지 않는다)
export function IsValidPhone(phone: unknown): phone is string {
    return typeof phone === "string" && phone.length > 0 && phone.length <= PHONE_MAX_LENGTH;
}

// mid 의 각 글자를 XOR 후 10진수 문자열로 이어 붙인다
function XorMid(mid: string): string {
    let result = "";
    for (let i = 0; i < mid.length; i++) {
        const code = mid.charCodeAt(i) ^ USERID_XOR_KEY;
        result += code.toString(10);
    }
    return result;
}

// (partner, mid) → userid. 호출 전에 IsValidPartner / IsValidMid 로 형식을 검사해야 한다
export function ConvertMidToUserid(partner: string, mid: string): string {
    return `${partner}_${XorMid(mid)}`;
}
