// 첫 접속 유저 등록 (3개 테이블, 한 트랜잭션, 중복 호출에 안전)
// 기존 유저의 phone 갱신 쿼리도 여기서 함께 다룬다.

import type { Pool } from "mysql2/promise";
import { GetDefaultAvatar } from "../../common/userid.js";
import type { NewUserInput } from "../types.js";

// user_partner_info / user_member_info / user_play_info 에 기본 정보를 넣는다.
// INSERT IGNORE 를 쓰므로 (partner, mid) 가 이미 있으면(동시 호출 등) 조용히 넘어간다 — 에러 아님.
export async function RegisterNewUser(pool: Pool, input: NewUserInput): Promise<void> {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // user_member_info / user_play_info 가 userid 를 FK 로 참조하므로 partner_info 를 먼저 넣는다
        await connection.query(
            "INSERT IGNORE INTO user_partner_info (userid, partner, mid, gender) VALUES (?, ?, ?, ?)",
            [input.userid, input.partner, input.mid, input.gender]
        );
        // 아바타는 성별 기본값으로 정한다 (M → a_m_0, F → a_f_0). 나중에 유저가 직접 바꿀 수 있다.
        await connection.query(
            "INSERT IGNORE INTO user_member_info (userid, avatar, phone) VALUES (?, ?, ?)",
            [input.userid, GetDefaultAvatar(input.gender), input.phone]
        );
        await connection.query(
            "INSERT IGNORE INTO user_play_info (userid, today_date) VALUES (?, CURDATE())",
            [input.userid]
        );

        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// 저장된 값과 다를 때만 UPDATE 한다. 반환값은 실제로 바뀌었는지 여부.
export async function UpdatePhoneIfChanged(pool: Pool, userid: string, new_phone: string): Promise<boolean> {
    const [result] = await pool.query(
        "UPDATE user_member_info SET phone = ? WHERE userid = ? AND phone <> ?",
        [new_phone, userid, new_phone]
    );
    return (result as { affectedRows: number }).affectedRows > 0;
}

export type SetNameDbResult = "ok" | "duplicate";

// 별명 등록/변경 — 이미 별명이 있어도 다시 보내면 그 값으로 갱신한다 (문서에는 없는 확장 — CLAUDE.md 참고).
// name 에는 UNIQUE 제약이 걸려 있어(schema.sql 참고) 동시에 같은 별명을 등록/변경해도 한쪽만 성공한다
// — 실패한 쪽은 ER_DUP_ENTRY 로 잡는다. 같은 값으로 다시 저장해도(무변경) 제약에 걸리지 않는다.
export async function TrySetUserName(pool: Pool, userid: string, name: string): Promise<SetNameDbResult> {
    try {
        await pool.query("UPDATE user_member_info SET name = ? WHERE userid = ?", [name, userid]);
        return "ok";
    } catch (error) {
        if ((error as { code?: string }).code === "ER_DUP_ENTRY") return "duplicate";
        throw error;
    }
}
