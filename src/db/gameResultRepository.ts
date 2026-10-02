// 게임 한 판(2선승제)이 끝났을 때 결과를 DB/Redis 에 반영하는 진입점.
// GameRoom(매니저)은 db/queries 를 직접 부르지 않고 이 모듈만 호출한다 (CLAUDE.md 코딩 컨벤션).

import type { Pool } from "mysql2/promise";
import * as constants from "../common/constants.js";
import type { UserInfo } from "../common/types.js";
import * as connection from "./connection.js";
import * as gameResult from "./queries/gameResult.js";
import type { GameLogEntry, PlayRecord } from "./queries/gameResult.js";
import * as userInfo from "./queries/userInfo.js";
import * as rankingZSet from "./rankingZSet.js";
import * as userCache from "./userCache.js";
import * as types from "./types.js";

export type { PlayRecord };

export interface SaveGameResultInput {
    winner_userid: string;
    loser_userid: string;
    loser_win_count: number; // 0 이면 2:0 승리, 1 이면 2:1 승리
    start_time: Date;
    end_time: Date;
    plays: PlayRecord[];
    win_is_bot: boolean;
    lose_is_bot: boolean;
}

export interface SaveGameResultResult {
    winner: UserInfo;
    loser: UserInfo;
}

// user_play_info 갱신 + rank_daily/rank_weekly 점수 누적 + game_log 저장 + Redis 캐시 write-through 를
// 한 번에 처리하고, 갱신된 두 유저의 최신 정보를 돌려준다 (GameRoom 메모리 갱신용).
export async function SaveGameResult(input: SaveGameResultInput): Promise<SaveGameResultResult> {
    const pool = connection.GetDbPool();
    const score = input.loser_win_count === 0 ? constants.SCORE_WIN_STRAIGHT : constants.SCORE_WIN_NORMAL;

    await gameResult.UpdatePlayInfoAfterGame(pool, input.winner_userid, input.loser_userid, score, constants.SCORE_LOSE);
    // rank_daily/rank_weekly(MySQL, 원본)와 랭킹 Sorted Set(Redis, 조회용 인덱스)을 함께 갱신한다 —
    // 2026-10-01 Redis Sorted Set 전환(사용자 요청) 이후의 "이중 쓰기" 지점. 패자도 0점으로 ZINCRBY 해서
    // "오늘(이번 주) 참여했다"는 멤버 자체는 남겨 둔다(AddRankScore 가 MySQL 에 0점 행을 만들어 두는 것과 동일한 이유).
    await Promise.all([
        gameResult.AddRankScore(pool, input.winner_userid, score),
        gameResult.AddRankScore(pool, input.loser_userid, constants.SCORE_LOSE),
        rankingZSet.IncrementRankScore("daily", input.winner_userid, score),
        rankingZSet.IncrementRankScore("daily", input.loser_userid, constants.SCORE_LOSE),
        rankingZSet.IncrementRankScore("weekly", input.winner_userid, score),
        rankingZSet.IncrementRankScore("weekly", input.loser_userid, constants.SCORE_LOSE),
    ]);

    const game_log: GameLogEntry = {
        start_time: input.start_time,
        end_time: input.end_time,
        win: input.winner_userid,
        lose: input.loser_userid,
        vs: input.loser_win_count === 0 ? "2:0" : "2:1",
        score,
        plays: input.plays,
        win_is_bot: input.win_is_bot,
        lose_is_bot: input.lose_is_bot,
    };
    await gameResult.InsertGameLog(pool, game_log);

    const [winner, loser] = await Promise.all([
        RefreshUserCache(pool, input.winner_userid),
        RefreshUserCache(pool, input.loser_userid),
    ]);
    return { winner, loser };
}

// DB 에서 최신 값을 읽어 Redis 캐시에 다시 쓴다 (write-through) — 로비 복귀/재접속 시 DB 재조회 부하를 줄인다
async function RefreshUserCache(pool: Pool, userid: string): Promise<UserInfo> {
    const fresh = await userInfo.FetchUserInfo(pool, userid);
    if (!fresh) {
        // 정상 흐름이면 없을 수 없다 (게임 중이던 유저는 이미 DB 에 등록돼 있음) — 방어적으로 캐시 값이라도 반환
        const cached = await userCache.GetUserCache(userid);
        if (cached) return cached;
        throw new Error(`게임 결과 반영 중 유저 정보를 찾지 못했습니다: userid=${userid}`);
    }
    const public_info = types.ToPublicUserInfo(fresh);
    await userCache.SaveUserCache(public_info);
    return public_info;
}
