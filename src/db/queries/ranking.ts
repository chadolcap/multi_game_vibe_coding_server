// 랭킹 관련 MySQL 접근 (Phase 8, 2026-10-01 Redis Sorted Set 전환 후).
// 실시간 순위/점수 계산은 더 이상 여기서 하지 않는다 — db/rankingZSet.ts 의 Redis Sorted Set 이 담당한다.
// 이 모듈은 (1) ZSET 이 비어있을 때(최초 조회, Redis 재시작 등) MySQL 에서 다시 채우는 재구축용 전체
// 조회와 (2) 랭킹 목록에 표시할 이름을 userid 로 한 번에 조회하는 두 가지만 맡는다.

import type { Pool, RowDataPacket } from "mysql2/promise";
import type { RankPeriod } from "../types.js";

interface RankRow extends RowDataPacket {
    userid: string;
    score: number;
}

// period 값은 RankPeriod 유니온 타입으로 제한되어 코드 내부에서만 오므로, 테이블명을 쿼리 문자열에
// 직접 넣어도(파라미터 바인딩 대신) SQL 인젝션 위험이 없다.
function TableAndDateCondition(period: RankPeriod): { table: string; date_condition: string } {
    return period === "daily"
        ? { table: "rank_daily", date_condition: "date_game = CURDATE()" }
        : { table: "rank_weekly", date_condition: "date_start = DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)" };
}

// 그 기간(오늘/이번 주) 전체 (userid, score) 로우. Redis Sorted Set 이 비어있을 때 재구축하는 용도로만 쓴다
// — 평소에는 AddRankScore 의 ZINCRBY 가 ZSET 을 바로 채우므로 이 쿼리가 호출될 일이 거의 없다.
export async function GetAllRankRows(pool: Pool, period: RankPeriod): Promise<{ userid: string; score: number }[]> {
    const { table, date_condition } = TableAndDateCondition(period);
    const [rows] = await pool.query<RankRow[]>(`SELECT userid, score FROM \`${table}\` WHERE ${date_condition}`);
    return rows.map((row) => ({ userid: row.userid, score: row.score }));
}

// userid 목록으로 별명을 한 번에 조회한다 (랭킹 목록에 이름을 붙일 때 씀). 못 찾은 userid 는 결과 Map 에 없다.
export async function GetNamesByUserids(pool: Pool, userids: string[]): Promise<Map<string, string>> {
    if (userids.length === 0) return new Map();
    const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT userid, COALESCE(name, '') as name FROM user_member_info WHERE userid IN (?)`,
        [userids]
    );
    return new Map(rows.map((row) => [row.userid as string, row.name as string]));
}
