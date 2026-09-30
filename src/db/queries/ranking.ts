// 랭킹 조회 쿼리 (Phase 8). rank_daily/rank_weekly 에서 상위 RANKING_LIST_SIZE(100)위 목록과 특정
// 유저의 순위/점수를 가져온다. 동점자는 같은 순위를 받는다 — RANK() 윈도우 함수를 쓴다(개발 PC의
// XAMPP MariaDB 10.4 는 윈도우 함수를 지원한다). "내 점수보다 높은 사람 수 + 1"(TASKS.md Phase 8)과
// 같은 결과를 낸다.

import type { Pool, RowDataPacket } from "mysql2/promise";
import { RANKING_LIST_SIZE } from "../../common/constants.js";
import type { RankEntry, RankPeriod } from "../../common/types.js";

interface RankListRow extends RowDataPacket {
    userid: string;
    name: string;
    score: number;
    rnk: number;
}

// period 값은 RankPeriod 유니온 타입으로 제한되어 코드 내부에서만 오므로, 테이블명을 쿼리 문자열에
// 직접 넣어도(파라미터 바인딩 대신) SQL 인젝션 위험이 없다.
function TableAndDateCondition(period: RankPeriod): { table: string; date_condition: string } {
    return period === "daily"
        ? { table: "rank_daily", date_condition: "date_game = CURDATE()" }
        : { table: "rank_weekly", date_condition: "date_start = DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)" };
}

// 1~RANKING_LIST_SIZE(100)위 목록. 동점자 처리 때문에 LIMIT 경계에서 같은 점수의 다음 등수가 잘릴 수
// 있지만, 실용적으로 "상위 100행"으로만 자른다.
export async function GetRankList(pool: Pool, period: RankPeriod): Promise<RankEntry[]> {
    const { table, date_condition } = TableAndDateCondition(period);
    const [rows] = await pool.query<RankListRow[]>(
        `SELECT r.userid, COALESCE(m.name, '') as name, r.score, RANK() OVER (ORDER BY r.score DESC) as rnk
         FROM \`${table}\` r
         JOIN user_member_info m ON m.userid = r.userid
         WHERE r.${date_condition}
         ORDER BY rnk
         LIMIT ${RANKING_LIST_SIZE}`
    );
    return rows.map((row) => ({ rank: row.rnk, userid: row.userid, name: row.name, score: row.score }));
}

// 특정 유저의 순위/점수. 오늘(이번 주) 기록이 아예 없는 유저는 0점 취급하고 "0점보다 높은 사람 수 + 1"
// 로 순위를 매긴다 — 100위 밖이어도, 이번 기간에 한 판도 안 했어도 항상 값을 준다.
export async function GetMyRank(pool: Pool, period: RankPeriod, userid: string): Promise<{ rank: number; score: number }> {
    const { table, date_condition } = TableAndDateCondition(period);

    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT rnk, score FROM (
            SELECT userid, score, RANK() OVER (ORDER BY score DESC) as rnk
            FROM \`${table}\` WHERE ${date_condition}
         ) t WHERE userid = ?`,
        [userid]
    );
    if (rows.length > 0) {
        return { rank: rows[0].rnk as number, score: rows[0].score as number };
    }

    const [count_rows] = await pool.query<RowDataPacket[]>(
        `SELECT COUNT(*) + 1 as rnk FROM \`${table}\` WHERE ${date_condition} AND score > 0`
    );
    return { rank: count_rows[0].rnk as number, score: 0 };
}
