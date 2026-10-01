// game_log_YYYY_MM — 월별 게임 로그 테이블. 이름이 매달 바뀌므로 schema.sql 이 아니라 여기서 동적으로 만든다.
// - vs: 승자 기준 "2:0" / "2:1" 문자열 (2026-10-01 전: 이 자리가 "score" 컬럼이었다 — 이름만 바뀜)
// - score: 이번 판에서 승자가 실제로 획득한 점수(2:0=20점/2:1=10점, SCORE_WIN_STRAIGHT/SCORE_WIN_NORMAL)
// - plays: 무승부 판까지 포함한 모든 판을 순서대로 담은 JSON 배열
//   예: [{"win":"R","lose":"S"},{"draw":"P"},{"win":"S","lose":"P"}]
// - win_is_bot / lose_is_bot: 승자/패자가 봇이 대신 플레이했는지

import type { Pool } from "mysql2/promise";

// date 가 속한 달의 테이블 이름 (예: 2026-09-22 → game_log_2026_09)
export function GetGameLogTableName(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `game_log_${year}_${month}`;
}

function GetCreateTableSql(table_name: string): string {
    // 테이블 이름은 GetGameLogTableName() 이 만든 값만 들어오므로 SQL Injection 위험이 없다 (외부 입력을 직접 꽂지 않음)
    return `
        CREATE TABLE IF NOT EXISTS \`${table_name}\` (
            id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            start_time    DATETIME        NOT NULL,
            end_time      DATETIME        NOT NULL,
            win           VARCHAR(255)    NOT NULL,
            lose          VARCHAR(255)    NOT NULL,
            vs            VARCHAR(3)      NOT NULL,
            score         INT UNSIGNED    NOT NULL DEFAULT 0,
            plays         JSON            NOT NULL,
            win_is_bot    TINYINT(1)      NOT NULL DEFAULT 0,
            lose_is_bot   TINYINT(1)      NOT NULL DEFAULT 0,
            PRIMARY KEY (id),
            KEY idx_win (win),
            KEY idx_lose (lose)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `;
}

// date 가 속한 달의 game_log 테이블이 없으면 만든다. Phase 5 에서 로그를 쓰기 직전에 호출한다.
export async function EnsureGameLogTable(pool: Pool, date: Date): Promise<string> {
    const table_name = GetGameLogTableName(date);
    await pool.query(GetCreateTableSql(table_name));
    return table_name;
}
