-- 테이블 스키마 (CLAUDE.md "DB 테이블 기본 구성" 기준)
-- 모두 CREATE TABLE IF NOT EXISTS 로 작성 — 여러 번 실행해도 안전하다.
-- game_log_YYYY_MM 은 월별로 이름이 달라지는 테이블이라 여기 포함하지 않는다.
--   (구조는 src/db/gameLogSchema.ts 참고, initDb.ts 가 이번 달 테이블을 만든다)

-- 파트너사의 유저 기본 정보. userid 를 만드는 원천 데이터.
CREATE TABLE IF NOT EXISTS user_partner_info (
    userid      VARCHAR(255) NOT NULL,
    partner     VARCHAR(16)  NOT NULL,
    mid         VARCHAR(64)  NOT NULL,
    gender      CHAR(1)      NOT NULL,              -- 'F' 또는 'M'
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (userid),
    UNIQUE KEY uq_partner_mid (partner, mid)         -- (partner, mid) 중복 등록 방지
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 유저의 기본 정보 (닉네임, 인증 등)
CREATE TABLE IF NOT EXISTS user_member_info (
    userid              VARCHAR(255) NOT NULL,
    name                VARCHAR(50)  NOT NULL DEFAULT '',   -- 새 유저는 빈 값
    avatar              VARCHAR(255) NOT NULL DEFAULT '',   -- 새 유저는 빈 값
    phone               VARCHAR(100) NOT NULL,
    join_date           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    login_date          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    certification_date  DATETIME     NULL,
    terms_date          DATETIME     NULL,
    PRIMARY KEY (userid),
    CONSTRAINT fk_member_userid FOREIGN KEY (userid) REFERENCES user_partner_info (userid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 유저의 게임 play 정보. score_max 는 두지 않는다 (점수는 rank_daily / rank_weekly 에서 관리).
CREATE TABLE IF NOT EXISTS user_play_info (
    userid             VARCHAR(255)     NOT NULL,
    total_game_count   INT UNSIGNED     NOT NULL DEFAULT 0,
    total_win_count    INT UNSIGNED     NOT NULL DEFAULT 0,
    today_game_count   INT UNSIGNED     NOT NULL DEFAULT 0,
    today_win_count    INT UNSIGNED     NOT NULL DEFAULT 0,
    today_date         DATE             NOT NULL,           -- today_* 가 어느 날짜 기준인지 (Phase 8: 날짜가 바뀌면 0 으로)
    PRIMARY KEY (userid),
    CONSTRAINT fk_play_userid FOREIGN KEY (userid) REFERENCES user_partner_info (userid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 일일 랭킹. date_game(KST 00:00:00~23:59:59 기준) + userid 로 점수를 누적한다.
CREATE TABLE IF NOT EXISTS rank_daily (
    date_game  DATE         NOT NULL,
    userid     VARCHAR(255) NOT NULL,
    score      INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (date_game, userid),
    KEY idx_rank_daily_score (date_game, score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 주간 랭킹. date_start(그 주 월요일 00:00:00) + userid 로 점수를 누적한다.
CREATE TABLE IF NOT EXISTS rank_weekly (
    date_start DATE         NOT NULL,
    userid     VARCHAR(255) NOT NULL,
    score      INT          NOT NULL DEFAULT 0,
    PRIMARY KEY (date_start, userid),
    KEY idx_rank_weekly_score (date_start, score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
