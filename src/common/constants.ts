// 규모 스펙 / 게임 규칙 상수 — 숫자는 이곳 한 군데에서만 바꾼다 (CLAUDE.md 기준)

// ── 규모 ──
// ⚠️ 지금은 개발 단계라 로비/게임 1채널씩만 운영한다. 실 서비스 목표는 로비 2 / 게임 3 (CLAUDE.md 규모 스펙 참고).
// 로비 채널 수는 .env 의 LOBBY_PORTS 목록 길이로 정해진다(channelNames.ts GetChannelPort 참고) — 여기엔
// 상수가 없다. 게임 채널은 RoomManager 가 "몇 번까지 켜져 있을 수 있는지" 알아야 해서 상수로 둔다.
// 운영 전환/증설 시 여기 값을 되돌리고, .env 의 GAME_PORTS 도 포트를 추가할 것 (LOBBY_PORTS 는 바로 추가 가능).
export const GAME_CHANNEL_COUNT = 1;
export const MAX_CLIENTS_PER_CHANNEL = 300;     // 로비/게임 채널별 최대 동시 접속
export const MAX_ROOMS_PER_GAME_CHANNEL = 100;  // 게임 채널별 방 개수
export const MAX_PLAYERS_PER_GAME_CHANNEL = 200; // 게임 채널별 게임 인원
export const PLAYERS_PER_ROOM = 2;              // 게임방 1개당 인원

// ── 시간 제한 (초) ──
export const ENTER_LOBBY_TIMEOUT_SEC = 10;      // 접속 후 ENTER_LOBBY 제한 시간
export const SEAT_RESERVATION_SEC = 10;         // 좌석 예약 유효 시간
export const CHOICE_TIMEOUT_SEC = 10;           // 가위바위보 선택 제한 (지나면 자동 선택)
export const GAME_START_DELAY_SEC = 5;          // GAME_START 전송 후 첫 판 ONE_START 까지 대기 (클라이언트 연출 시간 확보)
export const ONE_RESULT_DELAY_SEC = 5;          // 2번째 판부터: ONE_RESULT 전송 후 다음 ONE_START 까지 대기 (결과 연출 시간 확보)
export const RECONNECT_WAIT_SEC = 5;            // 끊긴 뒤 봇 투입까지 대기
export const REMATCH_CHOICE_TIMEOUT_SEC = 10;   // 재게임/나가기 선택 제한 (지나면 나가기)

// 채널 하트비트: 게임 채널이 "지금 켜져 있는지"를 Redis 에 TTL 로 표시한다 (db/channelHeartbeat.ts).
// INTERVAL 은 TTL 의 절반 이하로 — 한두 번 갱신을 놓쳐도(Redis 지연 등) 바로 죽은 걸로 오판하지 않게 여유를 둔다.
export const CHANNEL_HEARTBEAT_TTL_SEC = 15;
export const CHANNEL_HEARTBEAT_INTERVAL_SEC = 5;

// ── 게임 규칙 ──
export const WIN_COUNT_TO_FINISH = 2;           // 2선승제
export const MAX_DECISIVE_ROUNDS = 3;           // 무승부를 뺀 최대 판 수
export const SCORE_WIN_STRAIGHT = 20;           // 2:0 승리
export const SCORE_WIN_NORMAL = 10;             // 2:1 승리
export const SCORE_LOSE = 0;

// ── 캐시 / 랭킹 ──
export const USER_CACHE_TTL_SEC = 120;          // Redis 유저 정보 TTL (2분)
export const RANKING_LIST_SIZE = 100;           // 랭킹 노출 1~100위
// 1~100위 목록은 모든 유저에게 같은 값이라 Redis 에 짧게 캐시해 DB 부하를 줄인다(본인 순위는 유저마다
// 달라 캐시하지 않는다 — db/rankingRepository.ts 참고).
export const RANK_LIST_CACHE_TTL_SEC = 10;

// 게임 중인 userid → 게임방 정보(방 재접속용) 기록의 Redis TTL. 정상적으로는 onLeave 에서 즉시 지우므로
// 이 TTL 은 프로세스가 죽는 등 onLeave 가 아예 안 불리는 드문 경우를 대비한 안전망일 뿐이다 — 실제 게임
// 한 판(2선승제) 최대 소요 시간보다 넉넉히 길게 잡는다.
export const ACTIVE_GAME_TTL_SEC = 600;

// ── 관리자(Watcher, Phase 7) ──
export const ADMIN_LOGIN_TIMEOUT_SEC = 10;      // 접속 후 ADMIN_LOGIN 제한 시간 (ENTER_LOBBY_TIMEOUT_SEC 와 동일한 값)
// 각 로비/게임 채널이 자기 채널의 접속자 목록(userid, 게임 채널이면 room 도)을 Redis 에 올리는 주기/TTL.
// ADMIN_CHANNEL_USER 는 이 스냅샷을 읽으므로 최대 이 간격만큼 오래된 값일 수 있다(ADMIN_CHANNEL_COUNT 는
// matchMaker.query() 로 그때그때 집계하므로 여기 해당 없음).
export const CHANNEL_USERS_REPORT_INTERVAL_SEC = 5;
export const CHANNEL_USERS_TTL_SEC = 15;
// SEND_NOTICE 에 time(구간) 이 담겨 오면, 그 구간 동안 이 간격으로 반복 전송한다.
export const NOTICE_REPEAT_INTERVAL_SEC = 60;

// ── 입력 형식 ──
export const PARTNER_MAX_LENGTH = 11;
export const MID_MAX_LENGTH = 63;
export const PHONE_MAX_LENGTH = 100;
export const NAME_MAX_LENGTH = 50;              // user_member_info.name 컬럼 길이와 맞춘다
export const ALLOWED_GENDERS = ["F", "M"] as const;
export const USERID_XOR_KEY = 5;

// ── 기본 아바타 (첫 접속 유저 등록 시 성별로 정함) ──
export const DEFAULT_AVATAR_BY_GENDER: Record<(typeof ALLOWED_GENDERS)[number], string> = {
    M: "a_m_0",
    F: "a_f_0",
};
