// 랭킹 순위/점수를 Redis Sorted Set 으로 관리한다 (Phase 8, 2026-10-01 — 사용자 요청으로 MySQL 의
// RANK() 윈도우 함수 방식에서 전환). MySQL(rank_daily/rank_weekly)이 여전히 원본(source of truth)이고,
// 이 모듈은 "그 원본을 빠르게 조회하기 위한 인덱스" 역할만 한다 — ZSET 이 비어있으면(최초 조회, Redis
// 재시작 등) MySQL 에서 자동으로 다시 채운다(아래 EnsureZSet).
//
// 키는 "rank_zset:daily:{YYYY-MM-DD}" / "rank_zset:weekly:{그 주 월요일 YYYY-MM-DD}" 형태라 날짜가
// 바뀌면 자동으로 새 키(빈 ZSET)가 되므로 — 자정 롤오버가 MySQL 쪽(날짜별 PK)과 동일하게 저절로 처리된다.
//
// 왜 RANK() 대신 이 방식인가: MySQL RANK() OVER (ORDER BY score DESC) 는 "본인 순위 1명"을 구할 때도
// 그 기간 전체 로우를 정렬해야 한다 — idx_rank_daily_score(date_game, score) 인덱스가 있어도 활용하기
// 어려운 구조였다. Sorted Set 은 ZSCORE(본인 점수)/ZCOUNT(본인보다 높은 사람 수)가 모두 O(log N) 이라,
// 동시 조회가 몰려도(사용자가 우려한 지점) 비용이 거의 안 늘어난다.

import type { Pool } from "mysql2/promise";
import { RANK_ZSET_TTL_SEC, RANKING_LIST_SIZE } from "../common/constants.js";
import { GetAllRankRows } from "./queries/ranking.js";
import { GetRedisClient } from "./redis.js";
import type { RankPeriod } from "./types.js";

function TodayDateStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// 이번 주 월요일 날짜 문자열 — MySQL 의 DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) 와 같은 기준
function ThisWeekMondayStr(): string {
    const now = new Date();
    const day = now.getDay(); // 0=일, 1=월, ..., 6=토
    const diff_from_monday = day === 0 ? 6 : day - 1;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff_from_monday);
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`;
}

function GetZSetKey(period: RankPeriod): string {
    return period === "daily" ? `rank_zset:daily:${TodayDateStr()}` : `rank_zset:weekly:${ThisWeekMondayStr()}`;
}

// ZSET 이 비어있으면(키가 없으면) MySQL 전체를 읽어 다시 채운다. 평소에는 IncrementRankScore 가 이미
// ZINCRBY 로 키를 만들어 두므로 거의 호출될 일이 없다 — Redis 재시작처럼 드문 경우에만 실제로 채운다.
async function EnsureZSet(pool: Pool, period: RankPeriod): Promise<string> {
    const key = GetZSetKey(period);
    const redis = GetRedisClient();

    const exists = await redis.exists(key);
    if (!exists) {
        const rows = await GetAllRankRows(pool, period);
        if (rows.length > 0) {
            const args: (string | number)[] = [];
            for (const row of rows) args.push(row.score, row.userid);
            await redis.zadd(key, ...args);
        }
        await redis.expire(key, RANK_ZSET_TTL_SEC);
    }
    return key;
}

// 게임 결과 반영 시(AddRankScore 와 함께) 호출한다 — MySQL 과 Redis 를 둘 다 갱신(dual write)한다.
export async function IncrementRankScore(period: RankPeriod, userid: string, score: number): Promise<void> {
    const key = GetZSetKey(period);
    const redis = GetRedisClient();
    // ZINCRBY 는 키/멤버가 없으면 그냥 새로 만들어 준다 — 평소 흐름에서는 이 한 줄로 ZSET 이 저절로 채워진다.
    // EXPIRE 를 매번 다시 걸어서(sliding) 활동이 있는 한 TTL 이 끊기지 않게 한다.
    await redis.multi().zincrby(key, score, userid).expire(key, RANK_ZSET_TTL_SEC).exec();
}

export interface ZSetRankEntry {
    userid: string;
    score: number;
}

// 1~RANKING_LIST_SIZE(100)위 목록 — (userid, score) 만. 이름은 rankingRepository.ts 에서 별도로 붙인다.
export async function GetTopRankEntries(pool: Pool, period: RankPeriod): Promise<ZSetRankEntry[]> {
    const key = await EnsureZSet(pool, period);
    const raw = await GetRedisClient().zrevrange(key, 0, RANKING_LIST_SIZE - 1, "WITHSCORES");
    const result: ZSetRankEntry[] = [];
    for (let i = 0; i < raw.length; i += 2) {
        result.push({ userid: raw[i], score: Number(raw[i + 1]) });
    }
    return result;
}

// 본인 순위/점수. 오늘(이번 주) 기록이 없으면 0점 취급 — "0점보다 높은 사람 수 + 1" 로 순위를 매긴다
// (동점자는 같은 순위 — ZCOUNT 로 "본인보다 점수가 높은 멤버 수" 를 세는 방식이라 ZREVRANK 와 달리
// 공동 순위가 유지된다. ZREVRANK 는 동점자도 서로 다른 순위를 매겨서 쓰지 않는다).
export async function GetMyRankFromZSet(pool: Pool, period: RankPeriod, userid: string): Promise<{ rank: number; score: number }> {
    const key = await EnsureZSet(pool, period);
    const redis = GetRedisClient();

    const score_raw = await redis.zscore(key, userid);
    const score = score_raw !== null ? Number(score_raw) : 0;
    const higher_count = await redis.zcount(key, `(${score}`, "+inf");
    return { rank: higher_count + 1, score };
}
