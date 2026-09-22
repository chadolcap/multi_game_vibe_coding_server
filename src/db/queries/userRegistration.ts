// 첫 접속 유저 등록 (3개 테이블, 한 트랜잭션, 중복 호출에 안전)
// 기존 유저의 phone 갱신 쿼리도 여기서 함께 다룬다.

import type { Pool } from "mysql2/promise";
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
        await connection.query(
            "INSERT IGNORE INTO user_member_info (userid, phone) VALUES (?, ?)",
            [input.userid, input.phone]
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
