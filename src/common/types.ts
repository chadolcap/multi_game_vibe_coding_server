// 메시지 타입, envelope, 공통 타입 (CLAUDE.md 통신 프로토콜 기준)

// Colyseus 메시지 이름 = type, 메시지 본문 = envelope
export interface Envelope<P = unknown> {
    type: string;
    payload: P;
    ts: number;
}

// 메시지 타입 — payload 가 "(Phase N 확정)" 인 것은 해당 Phase 에서 payload 타입을 정한다
// ENTER_LOBBY / NAME 은 클라이언트-서버 통신 정리 문서(구글 시트) 기준으로, 같은 type 이름을
// 요청(C→S)과 결과 응답(S→C, {result, error?})에 그대로 재사용한다.
// 문서: https://docs.google.com/spreadsheets/d/1zmxIhBU8UsEiI4cFFBs94Y4gNfsl1QbINjZMGQwNzBQ
export const MessageType = {
    // 로비
    ENTER_LOBBY: "ENTER_LOBBY",           // C→S 요청 { partner, mid, gender, phone } / S→C 결과
                                           // { result:"Y", userid, new, name, avatar } 또는 { result:"N", error }.
                                           // 예전엔 성공 시 별도로 LOBBY_ENTERED 를 이어서 보냈는데, 2026-09-30
                                           // 문서 갱신으로 그 필드들이 ENTER_LOBBY 성공 응답 하나로 합쳐졌다
                                           // (LOBBY_ENTERED 는 폐지 — 문서 반영)
    NAME: "NAME",                         // C→S 요청 { name } / S→C 결과 { result, error? }
    PLAY_INFO: "PLAY_INFO",               // C→S 요청(payload 없음) / S→C 결과 { result, total_game_count, ... }
    // C→S 요청(payload 없음) / S→C 같은 type 재사용, { date, list:[[name,score],...], my:{rank,score} }
    // — 일간 랭킹. 2026-10-01 통신규약 시트에 추가됨(문서 기준).
    RANK_DAILY: "RANK_DAILY",
    // C→S 요청(payload 없음) / S→C 같은 type 재사용, { term:{start,end}, list:[[name,score],...], my:{rank,score} }
    // — 주간 랭킹. 2026-10-01 통신규약 시트에 추가됨(문서 기준).
    RANK_WEEKLY: "RANK_WEEKLY",
    JOIN_MATCH: "JOIN_MATCH",             // C→S { select: "Y"|"N" } — Y: 게임 참여(매칭 대기열 등록), N: 매칭 대기 취소
                                           // (CANCEL_MATCH 는 더 이상 안 쓴다 — JOIN_MATCH 로 통합됨, 문서 반영)
    MATCH_FOUND: "MATCH_FOUND",           // S→C
    REJOIN_GAME: "REJOIN_GAME",           // S→C { room_name, room_id, seat_reservation } — 문서에 없는 메시지
                                           // (Phase 6-1 이후 CLAUDE.md 가 기준, MATCH_FOUND 와 같은 자리).
                                           // 게임 중이던 유저가 F5 등으로 다시 ENTER_LOBBY 를 보내면, 평범한
                                           // 로비 입장 대신 이걸 보내고 곧바로 로비 연결을 끊는다(CONSENTED)

    // 게임방 — ENTER_ROOM 부터는 로컬 엑셀본(통신규약) 기준. payload 가 "(Phase 5, 추후 정의)" 인
    // 것만 아직 미정이다.
    ENTER_ROOM: "ENTER_ROOM",             // C→S 요청(payload 없음, 로딩 등 준비 완료 신호) / S→C 결과 { result, room, player1, player2 } — 같은 type 재사용
    OUT_USER: "OUT_USER",                 // S→C — 게임 전/후 상대가 나가면 남은 유저에게 알림
    READY: "READY",                       // C→S { ready: "Y"|"N" } — 응답(ack) 없음
    GAME_START: "GAME_START",             // S→C — 양쪽 ready:Y 확인 후 전송. payload 없음
    RETURN_TO_LOBBY: "RETURN_TO_LOBBY",   // S→C (Phase 5, 추후 정의)
    OPPONENT_JOINED: "OPPONENT_JOINED",   // S→C { player: RoomPlayerInfo } — 기다리는 방에 새 상대 입장
    ONE_START: "ONE_START",               // S→C { count } — 한 판 시작(count=CHOICE_TIMEOUT_SEC). 1판은 GAME_START 후
                                           // GAME_START_DELAY_SEC 뒤, 2/3판은 직전 ONE_RESULT 후 ONE_RESULT_DELAY_SEC 뒤에 전송
    ONE_REMAIN_TIME: "ONE_REMAIN_TIME",   // S→C { count } — ONE_START 이후 남은 초를 1초 단위로 전달. count:0 이 선택 종료 신호
    SELECT_GAME: "SELECT_GAME",           // C→S { select: Choice } — 가위/바위/보 선택. CHOICE_TIMEOUT_SEC 안에 안 보내면 자동 선택
    ONE_RESULT: "ONE_RESULT",             // S→C { player1, player2, win? } — 한 판 결과 (무승부면 win 없음)
    GAME_RESULT: "GAME_RESULT",           // S→C { player1, player2, win } 최종 결과 / C→S { replay: "Y"|"N" } 재시작/나가기 선택 — 같은 type 재사용

    // 공통
    ERROR: "ERROR",                       // S→C

    // 관리자(Watcher, Phase 7) — "통신규약" 문서가 아니라 로컬 엑셀본 "관리자" 시트 기준.
    // ADMIN_LOGIN 은 그 시트에 아직 없는 메시지라 CLAUDE.md 가 기준이다. SEND_NOTICE 는 2026-09-30
    // 시트에 추가됐다 — 문서 쪽이 우선이므로 이 자리를 그 스펙에 맞췄다(아래 SendNoticePayload 참고).
    ADMIN_LOGIN: "ADMIN_LOGIN",           // C→S { id, password } / S→C { result:"Y"|"N", error? } — 문서에 없음
    ADMIN_CHANNEL_COUNT: "ADMIN_CHANNEL_COUNT", // C→S 요청(payload 없음) / S→C { count: { [room_name]: 접속자 수 } }
    ADMIN_CHANNEL_USER: "ADMIN_CHANNEL_USER",   // C→S { lobby: N } 또는 { game: N } / S→C 같은 type 재사용,
                                                 // { lobby?, game?, user: [{userid, room?}], total }
    // C→S { channel, message } — 관리자가 지정한 채널(room_name 목록)에만 즉시 공지를 전파한다
    // (예약 발송 없음 — 문서의 time 필드는 이번 구현 범위 밖, SendNoticePayload 참고).
    // S→C { message } — 그 채널들에 붙어 있는 유저에게 **같은 type 을 재사용**해 전송한다(문서 기준,
    // ENTER_LOBBY/NAME 등과 같은 "요청·응답 type 재사용" 관례). 예전엔 별도 이름 NOTICE 였는데 폐지.
    SEND_NOTICE: "SEND_NOTICE",
} as const;
export type MessageType = typeof MessageType[keyof typeof MessageType];

// ERROR 코드 — ENTER_LOBBY / NAME 처럼 문서에 정의된 결과 응답이 있는 메시지는 각자의
// result/error 로 답하므로(아래 EnterLobbyErrorCode, NameErrorCode) 이 ERROR 는 쓰지 않는다.
// 여기 남은 코드는 "클라이언트가 아직 아무 요청도 보내지 않은 상태"에서 서버가 먼저 끊어야 하는
// 경우(ENTER_LOBBY 를 기다리다 시간 초과)나, 문서 범위 밖의 상황(게임방 부족)에만 쓴다.
export const ErrorCode = {
    ENTER_TIMEOUT: "ENTER_TIMEOUT",           // 제한 시간 안에 ENTER_LOBBY 를 보내지 않음 → 연결 종료
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

// ENTER_LOBBY 결과 응답 (S→C, type 은 ENTER_LOBBY 를 그대로 재사용)
// 문서: https://docs.google.com/spreadsheets/d/1zmxIhBU8UsEiI4cFFBs94Y4gNfsl1QbINjZMGQwNzBQ
// (2026-09-28 로컬 엑셀본 기준으로 번호가 다시 바뀜: 2번에 "중복 접속"이 새로 들어와 DB_ERROR/OTHER 번호가 밀렸다)
export const EnterLobbyErrorCode = {
    INVALID_FORMAT: 1,         // 형식에 맞지 않은 정보
    DUPLICATE_CONNECTION: 2,   // 중복 접속 (같은 유저가 이미 로비 대기 중/게임 중, 또는 이 연결이 이미 입장 완료)
    DB_ERROR: 3,               // DB, Redis 오류
    OTHER: 4,                  // 기타 (채널 인원 초과 등 — 문서에 없는 상황을 여기로 모은다)
} as const;
export type EnterLobbyErrorCode = typeof EnterLobbyErrorCode[keyof typeof EnterLobbyErrorCode];

export interface ResultPayload<E extends number> {
    result: "Y" | "N";
    error?: E;
}

// ENTER_LOBBY 결과 응답 (S→C, 요청과 같은 type 재사용). 2026-09-30 문서 갱신으로 예전 LOBBY_ENTERED 의
// 필드(userid/new/name/avatar)가 이 응답 하나로 합쳐졌다 — 성공(result:"Y")이면 그 넷이 다 있고
// error 는 없다, 실패(result:"N")면 error 만 있고 나머지는 없다.
export interface EnterLobbyResultPayload {
    result: "Y" | "N";
    error?: EnterLobbyErrorCode;
    userid?: string;
    new?: "Y" | "N"; // 새로운 유저 여부
    name?: string;   // 별명. 신규 유저는 빈 문자열 — 클라이언트가 NAME 으로 등록을 받아야 한다
    avatar?: string;
}

// NAME 으로 클라이언트가 보내는 값 (별명 등록 요청)
export interface NamePayload {
    name: string;
}

// NAME 결과 응답 (S→C, type 은 NAME 을 그대로 재사용)
// error:3 은 문서에 없는 코드다. ENTER_LOBBY 의 error:4(기타)와 같은 자리 — DB/Redis 오류처럼
// "중복도 아니고 부적절한 것도 아닌" 서버 쪽 문제를 알릴 방법이 없어서 추가했다. 클라이언트도 반영 필요.
export const NameErrorCode = {
    DUPLICATE: 1,      // 이미 다른 사용자가 사용중인 별명
    INAPPROPRIATE: 2,  // 욕설이 들어간 별명 등 문제가 있는 별명 (형식 오류도 이 코드로 응답한다)
    SERVER_ERROR: 3,   // DB/Redis 오류 등 서버 쪽 문제 (문서에 없는 코드 — 위 설명 참고)
} as const;
export type NameErrorCode = typeof NameErrorCode[keyof typeof NameErrorCode];
export type NameResultPayload = ResultPayload<NameErrorCode>;

// PLAY_INFO 결과 응답 (S→C, type 은 PLAY_INFO 를 그대로 재사용). 문서에 실패 케이스가 없다 —
// ENTER_LOBBY 를 아직 안 했거나 이미 매칭된 연결이 보내면 조용히 무시한다 (LobbyManager 참고).
export interface PlayInfoResultPayload {
    result: "Y";
    total_game_count: number;
    total_win_count: number;
    today_game_count: number;
    today_win_count: number;
}

// 랭킹 조회(Phase 8) — 로컬 엑셀본 "통신규약" 시트에 2026-10-01 RANK_DAILY/RANK_WEEKLY 로 추가됐다.
// 문서가 기준이므로 그 스펙(별도 메시지 2개, list 는 [name, score] 튜플 배열)을 그대로 따른다.
// ⚠️ 문서 비고(H15/H17)에는 "상위 10명"이라고 적혀 있지만, 몇 명을 보여줄지는 클라이언트 표시 문제로
// 보고 서버는 그대로 RANKING_LIST_SIZE(100)개를 보낸다(2026-10-01 사용자 결정) — 클라이언트가 그중
// 원하는 만큼만 잘라서 보여주면 된다.

// 랭킹 목록 한 줄 — 문서 payload 예시(`list:[[name, score], ...]`)대로 튜플이다. 순위 번호(동점자는
// 같은 순위 — db/queries/ranking.ts 의 RANK() 윈도우 함수)는 목록 안에는 안 넣는다(문서에 없음) —
// 필요하면 클라이언트가 배열 인덱스로 매긴다. 본인 순위는 `my.rank` 로 따로 온다.
export type RankListEntry = [name: string, score: number];

// 본인 순위/점수 — rank_daily/rank_weekly 에 이번 기간 기록이 없어도(100위 밖이거나 아예 참여 안 했어도)
// 항상 채워진다(0점 기준으로 순위 계산, db/queries/ranking.ts GetMyRank 참고).
export interface RankMyInfo {
    rank: number;
    score: number;
}

// RANK_DAILY — C→S 요청(payload 없음, 로그인=ENTER_LOBBY 이후) / S→C 같은 type 재사용.
// date 는 오늘 날짜("YYYY.MM.DD", 문서 예시 형식 그대로).
export interface RankDailyResultPayload {
    date: string;
    list: RankListEntry[];
    my: RankMyInfo;
}

// RANK_WEEKLY — C→S 요청(payload 없음) / S→C 같은 type 재사용.
// term 은 이번 주 월요일~일요일("YYYY.MM.DD").
export interface RankWeeklyResultPayload {
    term: { start: string; end: string };
    list: RankListEntry[];
    my: RankMyInfo;
}

// 로비/게임에서 쓰는 유저 정보 — Redis 캐시, ENTER_LOBBY 성공 응답, 좌석 예약에 담기는 값의 바탕이 된다.
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

// Colyseus matchMaker.reserveSeatFor() 가 돌려주는 값(ISeatReservation)의 우리 쪽 서브셋.
// 클라이언트는 이 값으로 consumeSeatReservation() 해서 게임방에 들어간다. userid 등 유저 정보는 들어 있지 않다.
// publicAddress: 이 방이 실제로 있는 채널의 주소(host:port). consumeSeatReservation() 이 이 값으로
// 새로 접속한다 — index.ts 에서 Server 생성 시 publicAddress 를 설정해야 채워진다. (채널마다 포트가
// 다르기 때문에 필수. 없으면 클라이언트가 원래 접속했던 로비 주소로 다시 연결을 시도해 실패한다)
export interface SeatReservation {
    name: string;
    sessionId: string;
    roomId: string;
    processId?: string;
    reconnectionToken?: string;
    publicAddress?: string;
}

// 상대방에게 공개해도 되는 최소 정보 (userid 는 개인정보라 보내지 않는다)
export interface OpponentInfo {
    name: string;
    avatar: string;
}

// JOIN_MATCH 로 클라이언트가 보내는 값. select:"Y" 는 매칭 대기열 등록("게임 참여"), select:"N" 은
// 매칭 대기 취소 — 예전에 따로 있던 CANCEL_MATCH 를 대체한다 (문서 반영, 더 이상 안 씀)
export interface JoinMatchPayload {
    select: "Y" | "N";
}

// MATCH_FOUND 로 클라이언트에 보내는 값
export interface MatchFoundPayload {
    room_name: string;
    room_id: string;
    seat_reservation: SeatReservation;
    opponent: OpponentInfo;
}

// REJOIN_GAME 으로 클라이언트에 보내는 값. MATCH_FOUND 의 seat_reservation(consumeSeatReservation() 으로
// 소비하는 "첫 입장"용 값)과는 달리, 여기 담기는 reconnection_token 은 Colyseus 클라이언트 SDK 의
// client.reconnect(reconnection_token) 하나로 그대로 써야 한다 — 방식이 다르다: matchMaker.reconnect() 가
// 돌려주는 좌석 예약(ISeatReservation)에는 reconnectionToken 필드 자체가 없다(원래 클라이언트가 이미
// 들고 있다고 가정하는 값이라서). F5 등으로 그 값을 잃어버렸을 때 로비가 대신 쥐여주는 것이 이 메시지의
// 목적이다.
// ⚠️ reconnection_token 은 "roomId:토큰" 형식의 합성 문자열이다(SDK 의 room.reconnectionToken 이 저장하는
// 형식과 동일 — client.reconnect() 가 ":" 로 split 해서 쓴다). 서버가 미리 합쳐서 보내므로 클라이언트는
// 이 값을 그대로 client.reconnect() 에 넘기기만 하면 된다.
// 새 상대를 만나는 게 아니라 원래 있던 방/상대로 돌아가는 것이므로 opponent 는 없다 — 재접속
// (onReconnect) 한 뒤로는 새 메시지가 오는 대로 이어서 받을 뿐, 지금까지의 진행 상황(라운드 스코어 등)을
// 다시 보내 주지는 않는다.
export interface RejoinGamePayload {
    room_name: string;
    room_id: string;
    reconnection_token: string;
}

// 좌석 예약(auth data)에 담아 게임방으로 넘기는 값. phone 등 개인정보는 UserInfo 에 애초에 없으므로 그대로 재사용한다.
export interface GameSeatAuth {
    user: UserInfo;
}

// ENTER_ROOM 의 player1/player2 — 문서 필드명 그대로 (userid 는 상대에게도 노출된다 — 로비의
// MatchFoundPayload.opponent 와 달리 여기서는 게임 중이라 서로의 userid 를 알아야 한다)
export interface RoomPlayerInfo {
    userid: string;
    name: string; // 별명 — 문서에는 없던 필드(사용자 요청으로 추가). OPPONENT_JOINED 도 이 타입을 같이 쓴다
    avatar: string;
    win_per: number; // total_win_count / total_game_count 기준 승률 (0~100 정수, 아직 한 판도 안 했으면 0)
}

// ENTER_ROOM 결과 응답 (S→C, type 은 ENTER_ROOM 을 그대로 재사용). 양쪽 다 입장 + 양쪽 다 ENTER_ROOM 을
// 보내면 전송한다 (요청 자체는 payload 없음 — 위 MessageType.ENTER_ROOM 주석 참고)
export interface EnterRoomPayload {
    result: "Y";
    room: string; // 입장한 방번호. 지금은 Colyseus roomId 문자열을 그대로 쓴다 (순번 표시가 필요하면 별도 확인 필요)
    player1: RoomPlayerInfo;
    player2: RoomPlayerInfo;
}

// OUT_USER — 게임 전/후 상대가 나가면 남은 유저에게 S→C 로 알린다
export interface OutUserPayload {
    userid: string;
}

// OPPONENT_JOINED — "기다리는 방"에 새 상대가 들어오면, 기다리던 유저에게 S→C 로 알린다
export interface OpponentJoinedPayload {
    player: RoomPlayerInfo;
}

// READY 로 클라이언트가 보내는 값 (게임 준비 상태). 응답(ack) 없이, 양쪽 다 Y 가 되면 GAME_START 로 알린다
export interface ReadyPayload {
    ready: "Y" | "N";
}

// ONE_START — 한 판 시작을 알린다 (S→C). count 는 이 판의 선택 제한 남은 초(=CHOICE_TIMEOUT_SEC).
// 1판은 GAME_START 뒤 GAME_START_DELAY_SEC, 2/3판은 직전 ONE_RESULT 뒤 ONE_RESULT_DELAY_SEC 만큼 지난 뒤에 보낸다.
export interface OneStartPayload {
    count: number;
}

// ONE_REMAIN_TIME — ONE_START 이후 선택 제한 남은 초를 1초 단위로 전달한다 (S→C).
// count 가 0 이면 선택 시간이 끝났다는 신호(=이 판은 자동 선택으로 마무리됨)다.
export interface OneRemainTimePayload {
    count: number;
}

// 가위바위보 선택 값 — 문서 표기(한글) 그대로 쓴다
export type Choice = "가위" | "바위" | "보";

// SELECT_GAME 으로 클라이언트가 보내는 값 (한 판에 대한 가위/바위/보 선택)
export interface SelectGamePayload {
    select: Choice;
}

// ONE_RESULT — 한 판 결과 (S→C). win 은 그 판을 이긴 유저의 userid.
// 무승부(문서에 없는 상황 — 서버가 추가함)면 win 필드를 아예 보내지 않는다. 무승부 판은 승수에 들어가지 않으므로
// 같은 판을 다시 진행한다 (CLAUDE.md 게임 규칙 8번).
export interface OneResultPayload {
    player1: Choice;
    player2: Choice;
    win?: string;
}

// GAME_RESULT 의 winner/loser — win_count 는 이번 게임에서 이긴 판 수(무승부 제외), win_per 은
// total_win_count 기준 승률(0~100 정수, 0판이면 0). 통신규약 시트는 player1/player2(세션 순서) + win
// (승자 userid) 형태였으나, 2026-10-01 사용자 지시로 승자/패자 기준의 winner/loser 로 바뀌었다(문서는
// 아직 갱신 전 — 이 CLAUDE.md/타입이 최신 기준).
export interface GameResultPlayerInfo {
    userid: string;
    win_count: number;
    win_per: number;
}

// GAME_RESULT — 최종 결과 (S→C). 승자 userid 는 winner.userid 로 알 수 있어 별도 win 필드는 없다.
// 점수(2:0=20점/2:1=10점) 는 클라이언트에 보내지 않는다 — DB/랭킹에만 쓰는 값이라 문서에도 없다.
// ⚠️ win_per 은 이번 게임 결과가 반영된 값이다 — DB 저장(SaveGameResult) 완료를 기다리지 않고 메모리에
// 있는 현재 값(this.players, 재게임 전까지는 지난 게임까지의 DB 값)에 "이번 판 결과"를 더해 즉시
// 계산한다(결과 화면이 DB 왕복 시간만큼 늦어지지 않게 하는 기존 설계 원칙 유지 — GameRoom.FinishGame 참고).
export interface GameResultPayload {
    winner: GameResultPlayerInfo;
    loser: GameResultPlayerInfo;
}

// GAME_RESULT 로 클라이언트가 보내는 값 (재시작 선택, 같은 type 재사용). 문서에는 "replay:Y" 만 있고
// "나가기" 요청은 따로 없었지만, 클라이언트가 명시적으로 나가기를 알릴 수 있도록 replay:"N" 을 서버가
// 추가로 받는다(문서에 없는 확장). replay:"N" 을 보내면 상대 응답을 기다리지 않고 그 유저만 바로 로비로
// 돌아간다. 아무것도 안 보내도 REMATCH_CHOICE_TIMEOUT_SEC(10초) 뒤에 같은 결과(나가기)로 처리된다
// (CLAUDE.md 게임 규칙 11번)
export interface ReplayPayload {
    replay: "Y" | "N";
}

// SEND_NOTICE 결과 (S→C, type 재사용) — 관리자가 지정한 채널에 붙어 있는 유저에게 전송된다.
export interface NoticePayload {
    message: string;
}

// ───────────────────────── 관리자(Watcher, Phase 7) ─────────────────────────
// 로컬 엑셀본 "관리자" 시트 기준. ADMIN_LOGIN / SEND_NOTICE 는 그 시트에 아직 없어 CLAUDE.md 가 기준이다.

// ADMIN_LOGIN 으로 클라이언트(관리자 페이지)가 보내는 값. 계정 정보는 .env 로만 관리한다 — 코드/문서에 적지 않는다.
export interface AdminLoginPayload {
    id: string;
    password: string;
}

// ADMIN_LOGIN 결과 응답 (S→C, type 재사용). 문서에 없어 번호 코드는 두지 않는다 — 실패 이유는 사실상
// "아이디/비밀번호 불일치" 하나뿐이라 result 만으로 충분하다.
export interface AdminLoginResultPayload {
    result: "Y" | "N";
}

// ADMIN_CHANNEL_COUNT 결과 응답 (S→C, type 재사용, C→S 요청은 payload 없음). count 의 키는 room_name
// (lobby_1, game_1 등), 값은 그 채널의 현재 접속자 수(CCU) — matchMaker.query() 로 실시간 집계한다.
export interface AdminChannelCountPayload {
    count: Record<string, number>;
}

// ADMIN_CHANNEL_USER 로 클라이언트가 보내는 값 — lobby 또는 game 중 하나의 채널 번호만 담는다.
export interface AdminChannelUserQuery {
    lobby?: number;
    game?: number;
}

// room 은 게임 채널일 때만 채워진다(그 유저가 들어있는 게임방의 Colyseus roomId) — 로비는 방 개념이
// 없어서 없다. ⚠️ 문서 예시(C6)의 room:1/room:2 처럼 순번 형태가 필요한지는 아직 확인 안 됨 — ENTER_ROOM
// 의 room 필드와 같은 미확정 사항(CLAUDE.md "게임 채널 접속 방식" 참고).
export interface AdminChannelUserEntry {
    userid: string;
    room?: string;
}

// ADMIN_CHANNEL_USER 결과 응답 (S→C, type 재사용) — 요청받은 채널을 그대로 돌려주고(lobby 또는 game),
// user 목록과 total(=user.length)을 채운다.
export interface AdminChannelUserResultPayload extends AdminChannelUserQuery {
    user: AdminChannelUserEntry[];
    total: number;
}

// SEND_NOTICE 의 time 필드 — 엑셀본 "관리자" 시트 예시(G7) 기준. start/end 는 "HH:MM" 형식 24시간제
// 문자열이고, mon/day 는 그 시각이 속한 월/일(연도는 없음 — 서버가 지금 연도를 그대로 쓴다).
export interface NoticeTimeRange {
    mon: number;
    day: number;
    start: string; // "HH:MM"
    end: string;   // "HH:MM"
}

// SEND_NOTICE 로 클라이언트(관리자 페이지)가 보내는 값. channel 에 담은 room_name(예: "lobby_1", "game_1")
// 목록에 붙어 있는 유저에게만 전파된다 — 전체 채널에 보내려면 관리자 페이지가 그 목록을 모두 채워 보낸다.
// time 이 없으면 즉시 1회 전송. time 이 있으면 start~end 구간 동안 1분 간격으로 반복 전송한다
// (사용자 지시, 2026-09-30 — 문서 I7 "시간을 10분 간격으로 선택해서..."는 관리자 페이지 UI 얘기라 서버
// 구현과 무관하다).
export interface SendNoticePayload {
    channel: string[];
    message: string;
    time?: NoticeTimeRange;
}
