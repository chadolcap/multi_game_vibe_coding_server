// 메시지 타입, envelope, 공통 타입 (CLAUDE.md 통신 프로토콜 기준)

// Colyseus 메시지 이름 = type, 메시지 본문 = envelope
export interface Envelope<P = unknown> {
    type: string;
    payload: P;
    ts: number;
}

// 메시지 타입 — payload 가 "(Phase N 확정)" 인 것은 해당 Phase 에서 payload 타입을 정한다
export const MessageType = {
    // 로비
    ENTER_LOBBY: "ENTER_LOBBY",           // C→S
    LOBBY_ENTERED: "LOBBY_ENTERED",       // S→C
    JOIN_MATCH: "JOIN_MATCH",             // C→S (Phase 4 확정)
    CANCEL_MATCH: "CANCEL_MATCH",         // C→S (Phase 4 확정)
    MATCH_FOUND: "MATCH_FOUND",           // S→C

    // 게임방 (Phase 5 확정)
    ROOM_ENTER_ACK: "ROOM_ENTER_ACK",     // C→S
    GAME_START: "GAME_START",             // S→C
    SUBMIT_CHOICE: "SUBMIT_CHOICE",       // C→S
    OPPONENT_CHOICE: "OPPONENT_CHOICE",   // S→C
    ROUND_RESULT: "ROUND_RESULT",         // S→C
    RETURN_TO_LOBBY: "RETURN_TO_LOBBY",   // S→C

    // 공통
    NOTICE: "NOTICE",                     // S→C (Phase 7)
    ERROR: "ERROR",                       // S→C
} as const;
export type MessageType = typeof MessageType[keyof typeof MessageType];

// ERROR 코드
export const ErrorCode = {
    INVALID_REQUEST: "INVALID_REQUEST",       // ENTER_LOBBY payload 형식 오류 → 연결 종료
    INVALID_ID: "INVALID_ID",                 // partner / mid / gender / phone 형식 오류 → 연결 종료
    ALREADY_CONNECTED: "ALREADY_CONNECTED",   // 같은 유저가 이미 로비 대기 중이거나 게임 중 → 연결 종료
    ALREADY_ENTERED: "ALREADY_ENTERED",       // 이 연결은 이미 로비에 들어와 있음 → 무시
    ENTER_TIMEOUT: "ENTER_TIMEOUT",           // 제한 시간 안에 ENTER_LOBBY 를 보내지 않음 → 연결 종료
    SERVER_ERROR: "SERVER_ERROR",             // 서버 내부 오류 → 연결 종료
    CHANNEL_FULL: "CHANNEL_FULL",             // 로비 채널 인원 초과 → 연결 종료
    NO_GAME_ROOM: "NO_GAME_ROOM",             // 모든 게임 채널이 가득 참 → 연결 유지
} as const;
export type ErrorCode = typeof ErrorCode[keyof typeof ErrorCode];

export interface ErrorPayload {
    code: ErrorCode;
    message: string;
}

// ENTER_LOBBY 로 클라이언트가 보내는 값 (CLAUDE.md 접속 순서 1번)
export interface EnterLobbyPayload {
    partner: string;
    mid: string;
    gender: string;
    phone: string;
}

// 로비/게임에서 쓰는 유저 정보 — Redis 캐시, LOBBY_ENTERED 응답, 좌석 예약에 담기는 값의 바탕이 된다.
// phone 처럼 개인정보 성격이 강한 값은 여기에 넣지 않는다 (userRepository 안에서만 사용)
export interface UserInfo {
    userid: string;
    name: string;
    avatar: string;
    gender: string;
    total_game_count: number;
    total_win_count: number;
    today_game_count: number;
    today_win_count: number;
}
