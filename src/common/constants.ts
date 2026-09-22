// 규모 스펙 / 게임 규칙 상수 — 숫자는 이곳 한 군데에서만 바꾼다 (CLAUDE.md 기준)

// ── 규모 ──
export const LOBBY_CHANNEL_COUNT = 2;
export const GAME_CHANNEL_COUNT = 3;
export const MAX_CLIENTS_PER_CHANNEL = 300;     // 로비/게임 채널별 최대 동시 접속
export const MAX_ROOMS_PER_GAME_CHANNEL = 100;  // 게임 채널별 방 개수
export const MAX_PLAYERS_PER_GAME_CHANNEL = 200; // 게임 채널별 게임 인원
export const PLAYERS_PER_ROOM = 2;              // 게임방 1개당 인원

// ── 시간 제한 (초) ──
export const ENTER_LOBBY_TIMEOUT_SEC = 10;      // 접속 후 ENTER_LOBBY 제한 시간
export const SEAT_RESERVATION_SEC = 10;         // 좌석 예약 유효 시간
export const CHOICE_TIMEOUT_SEC = 5;            // 가위바위보 선택 제한 (지나면 자동 선택)
export const RECONNECT_WAIT_SEC = 5;            // 끊긴 뒤 봇 투입까지 대기
export const REMATCH_CHOICE_TIMEOUT_SEC = 5;    // 재게임/나가기 선택 제한 (지나면 나가기)

// ── 게임 규칙 ──
export const WIN_COUNT_TO_FINISH = 2;           // 2선승제
export const MAX_DECISIVE_ROUNDS = 3;           // 무승부를 뺀 최대 판 수
export const SCORE_WIN_STRAIGHT = 20;           // 2:0 승리
export const SCORE_WIN_NORMAL = 10;             // 2:1 승리
export const SCORE_LOSE = 0;

// ── 캐시 / 랭킹 ──
export const USER_CACHE_TTL_SEC = 120;          // Redis 유저 정보 TTL (2분)
export const RANKING_LIST_SIZE = 100;           // 랭킹 노출 1~100위

// ── 입력 형식 ──
export const PARTNER_MAX_LENGTH = 11;
export const MID_MAX_LENGTH = 63;
export const PHONE_MAX_LENGTH = 100;
export const ALLOWED_GENDERS = ["F", "M"] as const;
export const USERID_XOR_KEY = 5;
