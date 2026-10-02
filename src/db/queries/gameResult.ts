// 게임 한 판(2선승제)이 끝났을 때 결과를 반영하는 쿼리 모음 (Phase 5-3).
// user_play_info 갱신, rank_daily/rank_weekly 점수 누적, game_log_YYYY_MM 로그 저장을 담당한다.

import type { Pool } from "mysql2/promise";
import type { Choice } from "../../common/types.js";
import * as gameLogSchema from "../gameLogSchema.js";

// game_log 의 plays 컬럼(JSON) 한 판 기록. 무승부 판도 포함한다 (gameLogSchema.ts 참고).
// userid → 그 유저가 낸 값. 승패 여부는 GameLogEntry 의 win/lose/vs 로 이미 알 수 있어서
// (2026-10-02 변경) win/lose/draw 로 구분해 담지 않고, 누가 무엇을 냈는지만 기록한다 — 예전 구조는
// "이겼다/졌다"만 알 수 있고 "누가(어떤 userid가)" 냈는지는 알 수 없어 기록으로서 가치가 없었다.
export type PlayRecord = Record<string, Choice>;

export interface GameLogEntry {
    start_time: Date;
    end_time: Date;
    win: string; // 승자 userid
    lose: string; // 패자 userid
    vs: string; // 승자 기준 "2:0" | "2:1" (예전엔 이 자리가 "score" 컬럼이었다 — 2026-10-01 이름 변경)
    score: number; // 이번 판에서 승자가 실제로 획득한 점수(SCORE_WIN_STRAIGHT/SCORE_WIN_NORMAL)
    plays: PlayRecord[];
    win_is_bot: boolean;
    lose_is_bot: boolean;
}

// 승자/패자의 total_game_count / total_win_count / today_game_count / today_win_count 와
// total_score / today_score(이번 판 획득 점수 누적, 2026-10-01 추가)를 갱신한다.
// today_date 가 오늘과 다르면(자정이 지난 뒤 첫 게임) today_* 를 1(또는 0, 점수는 이번 판 값)로
// 리셋하고 today_date 를 오늘로 갱신한다 — 이게 실제 롤오버가 일어나는 지점이다. 게임을 안 하는 유저는
// today_date 가 영영 안 바뀔 수 있지만, 조회 시점(queries/userInfo.ts SELECT_USER_INFO_SQL)에서 이미
// today_date != CURDATE() 면 0 으로 보정해서 보여주므로 문제없다 (Phase 8, "지연 초기화").
export async function UpdatePlayInfoAfterGame(
    pool: Pool,
    winner_userid: string,
    loser_userid: string,
    winner_score: number,
    loser_score: number
): Promise<void> {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            `UPDATE user_play_info SET
                total_game_count = total_game_count + 1,
                total_win_count  = total_win_count + 1,
                total_score      = total_score + ?,
                today_game_count = IF(today_date = CURDATE(), today_game_count + 1, 1),
                today_win_count  = IF(today_date = CURDATE(), today_win_count + 1, 1),
                today_score      = IF(today_date = CURDATE(), today_score + ?, ?),
                today_date = CURDATE()
             WHERE userid = ?`,
            [winner_score, winner_score, winner_score, winner_userid]
        );
        await connection.query(
            `UPDATE user_play_info SET
                total_game_count = total_game_count + 1,
                total_score      = total_score + ?,
                today_game_count = IF(today_date = CURDATE(), today_game_count + 1, 1),
                today_win_count  = IF(today_date = CURDATE(), today_win_count, 0),
                today_score      = IF(today_date = CURDATE(), today_score + ?, ?),
                today_date = CURDATE()
             WHERE userid = ?`,
            [loser_score, loser_score, loser_score, loser_userid]
        );
        await connection.commit();
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

// rank_daily(오늘, KST 기준 CURDATE())/rank_weekly(이번 주 월요일) 에 점수를 누적한다.
// score:0 이어도(패자) 행을 만들어 둔다 — 본인 순위 조회 시 항상 행이 있도록.
export async function AddRankScore(pool: Pool, userid: string, score: number): Promise<void> {
    await pool.query(
        `INSERT INTO rank_daily (date_game, userid, score) VALUES (CURDATE(), ?, ?)
         ON DUPLICATE KEY UPDATE score = score + VALUES(score)`,
        [userid, score]
    );
    await pool.query(
        `INSERT INTO rank_weekly (date_start, userid, score)
         VALUES (DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), ?, ?)
         ON DUPLICATE KEY UPDATE score = score + VALUES(score)`,
        [userid, score]
    );
}

// game_log_YYYY_MM (end_time 이 속한 달 기준) 에 한 판(2선승제) 로그를 남긴다.
export async function InsertGameLog(pool: Pool, entry: GameLogEntry): Promise<void> {
    const table_name = await gameLogSchema.EnsureGameLogTable(pool, entry.end_time);
    await pool.query(
        `INSERT INTO \`${table_name}\`
            (start_time, end_time, win, lose, vs, score, plays, win_is_bot, lose_is_bot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.start_time,
            entry.end_time,
            entry.win,
            entry.lose,
            entry.vs,
            entry.score,
            JSON.stringify(entry.plays),
            entry.win_is_bot ? 1 : 0,
            entry.lose_is_bot ? 1 : 0,
        ]
    );
}
