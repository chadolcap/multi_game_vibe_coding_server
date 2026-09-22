// user_partner_info + user_member_info + user_play_info 조회 (CachedUserInfo)

import type { Pool, RowDataPacket } from "mysql2/promise";
import type { CachedUserInfo } from "../types.js";

interface UserInfoRow extends RowDataPacket {
    userid: string;
    gender: string;
    name: string;
    avatar: string;
    phone: string;
    total_game_count: number;
    total_win_count: number;
    today_game_count: number;
    today_win_count: number;
}

const SELECT_USER_INFO_SQL = `
    SELECT
        p.userid,
        p.gender,
        m.name,
        m.avatar,
        m.phone,
        g.total_game_count,
        g.total_win_count,
        g.today_game_count,
        g.today_win_count
    FROM user_partner_info p
    JOIN user_member_info m ON m.userid = p.userid
    JOIN user_play_info   g ON g.userid = p.userid
    WHERE p.userid = ?
    LIMIT 1
`;

export async function FetchUserInfo(pool: Pool, userid: string): Promise<CachedUserInfo | null> {
    const [rows] = await pool.query<UserInfoRow[]>(SELECT_USER_INFO_SQL, [userid]);
    if (rows.length === 0) return null;

    const row = rows[0];
    return {
        userid: row.userid,
        gender: row.gender,
        name: row.name,
        avatar: row.avatar,
        phone: row.phone,
        total_game_count: row.total_game_count,
        total_win_count: row.total_win_count,
        today_game_count: row.today_game_count,
        today_win_count: row.today_win_count,
    };
}
