// 랭킹 조회 진입점. LobbyManager 는 이 모듈만 호출한다 (db/ 밖에서 db/queries 를 직접 부르지 않는다 —
// CLAUDE.md 코딩 컨벤션). Top 100 목록은 모든 유저에게 같은 값이라 Redis 에 짧게 캐시해 DB 부하를
// 줄인다(TASKS.md Phase 8). 본인 순위는 유저마다 달라 캐시하지 않는다 — 단순 인덱스 스캔이라 부하가 낮다.

import { RANK_LIST_CACHE_TTL_SEC } from "../common/constants.js";
import type { RankEntry, RankPeriod } from "../common/types.js";
import { GetDbPool } from "./connection.js";
import { GetMyRank, GetRankList } from "./queries/ranking.js";
import { GetJson, SetJson } from "./redis.js";

function RankListCacheKey(period: RankPeriod): string {
    return `rank_list:${period}`;
}

async function GetCachedRankList(period: RankPeriod): Promise<RankEntry[]> {
    const cached = await GetJson<RankEntry[]>(RankListCacheKey(period));
    if (cached) return cached;

    const list = await GetRankList(GetDbPool(), period);
    await SetJson(RankListCacheKey(period), list, RANK_LIST_CACHE_TTL_SEC);
    return list;
}

export interface RankInfoResult {
    rank_list: RankEntry[];
    my_rank: number;
    my_score: number;
}

export async function FetchRankInfo(period: RankPeriod, userid: string): Promise<RankInfoResult> {
    const [rank_list, my_rank_result] = await Promise.all([
        GetCachedRankList(period),
        GetMyRank(GetDbPool(), period, userid),
    ]);
    return { rank_list, my_rank: my_rank_result.rank, my_score: my_rank_result.score };
}
