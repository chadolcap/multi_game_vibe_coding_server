# 프로젝트 개요

상업용 실시간 2인 대전 보드게임(1차 구현: 가위바위보) 서버.
멀티플레이어 프레임워크로 Colyseus를 사용하는 Node.js/TypeScript 서버.

이 파일은 Claude Code가 매 세션마다 읽어야 하는 프로젝트 컨텍스트입니다.
새 기능을 요청할 때도 이 문서의 구조/컨벤션을 벗어나지 않도록 합니다.

## 기술 스택

- Runtime: Node.js
- Language: TypeScript
- Multiplayer Framework: Colyseus **0.18** (`@colyseus/core` 0.18.15 + `@colyseus/ws-transport` 0.18.2, 통합 패키지 `colyseus` 는 쓰지 않음)
  - `express` 는 ws-transport 가 내부에서 불러오기 때문에 설치만 해 둔다 (HTTP API 용도 아님)
  - 모듈 형식: ESM (`"type": "module"`), TypeScript 7 (`esModuleInterop: true`), 상대 경로 import 는 `.js` 확장자로 쓴다
  - 실행: `npm run build` 후 `node dist/index.js <watcher|lobby|game> <채널 번호(1부터)>` (채널별 npm 스크립트 `start:lobby1` 등)
  - `npm run build` 는 `tsc` 뒤에 `scripts/copy-assets.mjs` 를 실행해 `.sql` 등 정적 파일을 `dist/` 로 복사한다 (tsc 가 컴파일하지 않으므로)
- DB: MySQL — 드라이버 `mysql2` (개발 PC: XAMPP 의 MariaDB 10.4, MySQL 호환. root 계정 비밀번호 없음)
- Cache / 세션 저장: Redis(port 6780) — 클라이언트 `ioredis`
  - `import { Redis } from "ioredis"` **named import** 로 쓴다. 기본 import(`import Redis from "ioredis"`)는 ioredis(CJS) + TypeScript 7 + `module: nodenext` 조합에서 타입 에러가 난다.
  - 개발 PC: Redis 3.0.504 를 `redis/redis-6780.conf` 로 별도 실행. 기존 6379 서비스는 다른 용도라 건드리지 않는다
- 클라이언트-서버 통신 포맷: JSON
- 통신 방식: **모든 통신은 소켓**으로 한다 (HTTP API 없음). 관리자 페이지도 동일.
  (Colyseus 가 방 입장 전 매칭 요청 `POST /matchmake/...` 을 같은 포트의 HTTP 로 처리하는 것은 프레임워크 내부 동작이라 예외)
- 암호화: Watcher / 로비 / 게임 **모든 채널에 wss(TLS)** 적용. 인증서 경로는 .env 로 관리하고, 개발 환경에서만 ws 로 켤 수 있게 설정으로 분리한다.

## 규모 스펙

- 로비와 게임룸을 전체를 감시 하는 watcher 채널1개, 랜덤하게 접속하는 로비 채널 2개, 사용자를 순차적으로 채우는 채널 3개(채널 == 소켓 의 개념)
- 채널별 포트 (로비 포트는 클라이언트와 약속한 고정값)

  | 채널 | 룸 이름 | 포트 |
  |---|---|---|
  | Watcher | - | 6000 |
  | 로비 1 / 로비 2 | `lobby_1` / `lobby_2` | 6011 / 6012 |
  | 게임 1 / 게임 2 / 게임 3 | `game_1` / `game_2` / `game_3` | 6021 / 6022 / 6023 |
- 로비와 게임 채널별 최대 동시 접속 인원: 300명
- 게임(Room) 채널별 방 개수: 100개, 인원 : 200명
- 게임방 1개당 인원: 2명 (채널당 동시 게임 인원 200명, 나머지 200명은 로비 대기)
- 사용자가 랜던한 포트로 로비 채널에 접속한다.
  (로비 채널의 주소/포트는 서버와 클라이언트가 미리 약속한 값이다. 클라이언트에 고정해 두고, 서버가 따로 알려 주지 않는다)
- 모든 게임 채널이 가득 찬 경우 "접속 가능한 게임방이 없습니다. 잠시 후 다시 참여 해 주세요." 를 안내하고, 유저는 로비에 그대로 남는다.
- **무중단 게임 서비스**: 서버 재시작/배포 중에도 진행 중인 게임이 끊기지 않아야 한다. (채널 단위로 새 입장을 막고, 진행 중인 게임이 끝난 뒤 재시작)
- 로비에서 '게임참여' 버튼을 선택하면 사용자가 많은 첫번째 게임 채널로 접속을 유도하고, 첫번째 게임 채널에 사용자가 차면 2번째 게임 채널로 유도 한다.
- 유도의 방식을 클라이언트에 접속한 게임서버 주소와 포트 번호를 알려 주는 방식으로 하고, 클라이언트에서는 로비 채널 접속을 종료하고, 받은 정보로 게임 채널에 접속한다.
- 추후 로비 채널에서 할 수 있는 컨텐츠를 추가할 예정(예: 아이템 구매, 충전, 광고 보기 등)

## 폴더/파일 구조 (참고, 강제 아님 — 변경 시 이 문서도 함께 갱신)

```
src/
  watch/
    WatcherManager.ts        # LobbyManager/RoomManager 감시하여, 각 채널의 상태를 어드민 페이지를 통해서 볼 수 있도록 한다.
                             사용자 알림 메시지 출력 등을 로비나 게임 채널로 전파 할 수 있는 전용 관리자 채널로 만든다.(전파 방식은 레디스 이용 가능)
                             관리자 페이지는 WatcherManager(포트 6000)에 **소켓으로 연결**하여 상태 조회/공지 전송을 모두 소켓 통신으로 한다.
                             관리자 소켓은 **wss**(TLS 암호화)로 연결하고, 연결 직후 ID/PW 로그인을 통과해야 한다 (실패 시 연결 종료).
                             관리자 계정 정보는 .env 에만 둔다.
                             공지 흐름: 관리자 페이지 → (소켓) → Watcher → Redis Pub/Sub → 로비/게임 채널 → 클라이언트
                             공지는 관리자가 입력하는 즉시 **전체 채널(로비 + 게임)의 모든 유저**에게 실시간 전송한다 (예약 발송 없음).
  game/
    lobby/
      LobbyManager.ts       # 로비 접속 유저 정보 처리. 게임 참여를 선택하면 게임 채널의 참여 가능한 방정보를 클라이언트에 전달 한다.
      LobbyRoom.ts          # 로비에서 이뤄지는 구매, 광고 보기 등의 컨텐츠 처리
    room/
      RoomManager.ts        # 로비에서 온 유저를 room 에 입장 시키기, GameRoom 을 감시하여 참여자를 입장 시키는 역활
      GameRoom.ts	        # 실제 게임룰이 진행 되는 모듈. 종료 시 Lobby로 복귀(2인이 게임을 하는 로직이 실행 됨. 게임방이 100개라면 GameRoom 클래스가 100개 생성 되는 방식)
  db/
    connection.ts           # MySQL connection pool 관리 (mysql2/promise)
    redis.ts                # Redis 클라이언트 관리 + JSON 저장/조회/삭제 헬퍼, 채널간 공유 정보 저장 (ioredis)
    userCache.ts            # 유저 정보 Redis 캐시 (키 user:info:{userid}, TTL 120초)
    userRepository.ts       # 유저 정보 조회 진입점 (Redis → DB 순). 매니저는 이 모듈만 호출
    types.ts                # DB/Redis 전용 타입. CachedUserInfo(phone 포함, 서버 내부용) → ToPublicUserInfo() 로 UserInfo(phone 제외) 변환
    schema.sql               # 테이블 스키마 (CREATE TABLE IF NOT EXISTS). game_log_YYYY_MM 은 이름이 매달 바뀌어 여기 없음
    gameLogSchema.ts         # game_log_YYYY_MM 동적 생성 (GetGameLogTableName, EnsureGameLogTable)
    initDb.ts               # DB 생성 + 스키마 적용 + 이번 달 game_log 테이블 생성 (npm run db:init)
    queries/                # 테이블별 쿼리 모듈
      userPartnerInfo.ts    # (partner, mid) → userid 조회
      userInfo.ts           # user_partner_info + user_member_info + user_play_info 조회 (CachedUserInfo)
      userRegistration.ts   # 첫 접속 유저 등록(3개 테이블, 한 트랜잭션, 중복 호출에 안전) + phone 갱신 쿼리
  common/
    config.ts               # .env 로딩 및 설정 값 (채널 포트, TLS, Redis, MySQL)
    constants.ts            # 규모 스펙/게임 규칙 상수
    channelNames.ts         # 채널 ID / 룸 이름 / 포트 규칙 (lobby_N, game_N, 채널 ID 는 lobby-1 / game-3 처럼 종류별로 1부터)
    messages.ts             # 클라이언트 메시지 송수신 헬퍼 (SendMessage / SendError / ReadPayload)
    userid.ts               # (partner, mid) → userid 변환 + partner/mid/gender/phone 형식 검사
    types.ts                # 메시지 타입, envelope, 공통 타입, EnterLobbyPayload, UserInfo(phone 제외)
scripts/
  copy-assets.mjs           # tsc 가 컴파일하지 않는 정적 파일(schema.sql 등)을 빌드 후 dist/ 로 복사
    ...                     # 기타 유틸
```

## 채널 / 룸 구성

- 채널 번호(N)는 **1부터**. 채널 ID 와 같은 값이다 (예: 로비 1번 채널 = `lobby-1` = 룸 이름 `lobby_1` = 포트 6011).
- Colyseus 룸 이름은 채널마다 따로 등록하며, 채널별 통계도 이 이름으로 구분한다.
  - 로비 룸: `lobby_1`, `lobby_2` — 채널당 **1개**, 서버 기동 시 ChannelManager 가 생성 (`autoDispose=false`)
  - 게임 룸: `game_1`, `game_2`, `game_3` — 채널당 최대 100개, RoomManager 가 필요할 때 생성 (Phase 4)
- 클라이언트에서 로비 소켓 접속(2개의 채널에 랜덤하게)  -> 로비 접속 후 게임 참여 버튼 -> 서버에서 룸채널에서 참여 가능한 채널 정보를 정보 전달 -> 로비 소켓 끊고 -> 받은 정보의 소켓 연결
- 클라이언트 연결은 **이동형**: 로비 룸에 접속 → 매칭되면 로비를 떠나 게임 룸으로 이동 → 종료 후 로비로 복귀. (연결은 항상 1개)


## 흐름 (채널 → 로비 → 게임방)

1. 클라이언트가 채널에 접속하면 해당 채널의 Lobby(대기실)에 들어간다.
2. 로비 진입 시 클라이언트가 보낸 mid 등올 DB에서 userid를 검색해서 모든 정보 처리의 기준은 userid로 한다.
3. userid 는 mid 를 xor 로 암호화한 값으로 정한다. 암호화 key 는 5
   - 클라이언트는 partner 와 mid 를 함께 보낸다.
   - 최종 userid = `partner + "_" + XOR(mid)` (파트너가 달라도 userid 가 겹치지 않도록)
   - xor 은 문자 하나하나의 문자 코드에 key 를 적용하고, 결과 숫자를 10진수 문자열로 이어 붙인다.
     (예: 'u'(117) ^ 5 = 112 → "112") — 한 글자당 2~3자로 늘어난다.
   - partner: 영문/숫자 1~11자 (구분자 '_' 포함 금지), DB VARCHAR(16)
   - mid: 영문/숫자 1~63자, DB VARCHAR(64) — 영문/숫자로 제한해야 XOR 숫자열끼리 충돌하지 않는다.
   - userid: 최대 201자(11 + 1 + 63×3), DB VARCHAR(255) (userid 를 담는 모든 컬럼 동일)
   - 단방향 변환이다. userid 로 mid 가 필요하면 user_partner_info 에서 조회한다.
   - 구현: `src/common/userid.ts` 의 `ConvertMidToUserid()`   
4. 게임 채널에 입장, 게임 참여를 요청하면 참여가능한 게임방의 정보를 클라이트에 전달하여 채널로 이동시켜 게임방에 입장하도록 진행
5. 게임방에서 가위바위보 게임 진행 (아래 게임 규칙 참고).
6. 게임 종료(승자 결정) 후 양쪽 클라이언트가 모두 재게임을 요청 할 경우, 매칭 된 상태에서 재게임 진행. 나가기 의 선택한 유저는 로비로 보낸다. 재게임 요청 사용자는 해당방에서 다른 유저를 대기한다.
   (5초 무응답 = 나가기, 대기 시간 제한 없음, 대기 중 나가기 가능 — 아래 게임 규칙 11~12 참고)
7. 게임 결과 정보는 바로 DB에 업데이트 한다.
8. 처음 소켓 접속시 redis 에서 사용자의 정보를 가져오고 없을 경우 DB에서 정보를 가져온다.
9. 채널 간 유저 정보 전달은 **하이브리드 방식**으로 한다. (아래 "유저 정보 처리 단계" 5~6 참고)
   - 로비 → 게임방: 좌석 예약(`reserveSeatFor`)에 서버가 유저 정보를 담아 전달. 게임방은 `onJoin` 에서 바로 사용 (Redis/DB 조회 없음)
   - Redis 는 **값이 바뀔 때 쓴다(write-through)**: 로비 입장 직후, 게임 결과 DB 반영 직후
   - 게임방 → 로비 복귀, 로비 재접속: Redis 에서 읽고, 없으면 DB
10. redis 에 저장한 정본느 2분 후 소멸 시킨다.
11. 첫 접속 유저(DB 에 없음)는 로비 진입 시 user_partner_info / user_member_info / user_play_info 에 새로 만든다.
    (name, avatar 는 빈 값. 여러 번/동시에 호출돼도 한 번만 만들어진다)
12. 같은 userid 가 이미 로비 대기 중이거나 게임 중이면 새 접속을 거부한다 (ALREADY_CONNECTED). 다른 채널과의 중복은 아직 막지 않는다.
13. 유저가 로비/게임방을 떠날 때는 Redis 값을 새로 쓰지 않고 TTL(120초)만 다시 설정한다. (키가 이미 만료됐으면 메모리의 값으로 다시 저장)
    매칭되어 게임방으로 가는 경우의 유저 정보는 좌석 예약으로 전달되므로 Redis 에 의존하지 않는다.

## 유저 정보 처리 단계

1. 클라이언트에서 받은 partner, mid, gender, phone 중 partner, mid 로 user_partner_info 테이블을 검색하여, userid 를 얻는다.
   - gender 는 user_partner_info, phone 은 user_member_info 에 저장한다.
   - gender: `F` 또는 `M` 만 허용. phone: **빈 값 불가**, 텍스트 최대 100자 (DB VARCHAR(100)). 형식이 틀리면 `INVALID_ID`.
   - 기존 유저가 저장된 값과 다른 phone 을 보내면 user_member_info.phone 을 **새 값으로 갱신**하고, Redis 캐시도 함께 갱신한다.
   - phone 은 개인정보다. 다른 유저에게 보내지 않고, 좌석 예약·로그·Redis 공유 정보에 넣지 않는다.
2. 만약 user_partner_info 테이블에 정보가 없다면, 받은 정보를 토태로 user_partner_info, user_member_info, user_play_info 테이블에 기본 정보를 insert 한 후 서버로 리턴 한다.
3. user_partner_info 에 존재하는 유저일 경우 user_member_info, user_play_info 테이블의 정보를 가져온다.
4. 가져온 정보를 토태로 클라이언트에 해당 유저의 상태를 알려준다. 새로운 유저 or 기존 유저 에 따른 '별명', '인증요청' 등 추가 정보 처리를 진행하게 한다.
5. 로비 채널에서 게임 채널로 이동 전 사용자 정보를 redis 에 저장을 하여 게임 채널에서 사용 하도록 한다.
6. 5번의 방식은 채널 이동시 정보를 DB에서 계속 가져오는 부하를 줄이기 위한 방식으로 더 좋은 방식이 있다면 추천
   → **결정: 하이브리드 방식** (흐름 9번 참고)
   - 로비 → 게임방은 좌석 예약에 유저 정보를 담아 전달한다. 클라이언트는 sessionId 만 받으므로 내용을 조작할 수 없고,
     10초 안에 입장하지 않으면 예약과 함께 자동으로 사라진다.
   - 좌석 예약에는 게임에 필요한 값만 담는다 (userid, name, avatar 등). phone 같은 개인정보는 넣지 않는다.
   - 떠날 때 저장하는 방식은 로비 onLeave 보다 새 채널 접속이 먼저 도착하면 캐시가 비어 DB 를 다시 조회하게 되므로 쓰지 않는다.
   - `reserveSeatFor` / `onJoin` 의 auth 인자 지원 여부는 Colyseus 버전마다 다르다. 지원하지 않으면 options 인자에 담는다 (서버가 넣는 값이라 안전).

## 게임 규칙 — 가위바위보 (1차 구현)

1. 매칭된 2명이 게임방에 입장한다.
2. 서버는 양쪽 클라이언트로부터 "입장 완료" 신호를 모두 받아야 한다.
3. 양쪽 모두 입장 완료가 확인되면 서버가 양쪽에 "게임 시작" 신호를 전송한다.
4. 서버는 양쪽 클라이언트로부터 가위,바위,보 선택 값을 수신한다. 5초간 선택이 없을 경우 자동 선택
5. 서버는 양쪽이 제시한 값을 동시에 서로에게 브로드캐스트한다.
6. 서버가 승패를 판정하고 결과를 양쪽에 전송한다.
7. 총 3판이 진행되며, 2판을 먼저 이긴 유저가 발생하면 게임 종료
8. 1판마다 무승부 일 경우 승자가 나올때 까지 계속 진행한다.
9. 게임중 한명이 연결이 끊겼을때 5초간 대기 후 연결이 다시 되면 자동으로 진행중인 방에 입장을 하고,
5초간 재연결이 안되는 경우 자동 플레이 해주는 봇이 대신 게임을 하고, 게임이 종료 되면 결과를 보여주고 게임이 종료 되게 한다.
   - 봇이 대신하는 도중에도 원래 유저가 재접속하면 방에 다시 들어와 **봇 대신 이어서 플레이**한다. (게임이 끝나기 전까지 재접속 허용)
10. 2선승으로 종료 될때마다 해당 정보를 DB에 로그로 남긴다. 게임 시작 시간, 각 3판의 승패 정보, 승패에 낸 가위바위보 값등이 들어간다.
11. 게임 종료 후 양쪽에 "재게임 / 나가기" 선택을 받는다. **5초간 선택이 없으면 나가기로 처리**한다.
    - 둘 다 재게임: 같은 방, 같은 상대로 새 게임 시작
    - 한 명만 재게임: 나가기 유저는 로비로 보내고, 재게임 유저는 방에 남아 새 상대를 기다린다
    - 둘 다 나가기: 둘 다 로비로 보내고 방 정리
12. 새 상대를 기다리는 방("기다리는 방")은 Redis 에 목록으로 등록하고, 로비 매칭 시 **새 방보다 먼저** 로비 유저 1명을 넣는다.
    - 새 상대를 기다리는 시간에는 **제한을 두지 않는다.**
    - 기다리는 도중 **나가기**를 선택하면 로비로 이동시키고, 기다리는 방 목록에서 지우고 방을 정리한다. (연결이 끊긴 경우도 동일)
    - 새 상대가 들어오면 처음 게임과 같은 흐름(입장 완료 → 게임 시작)으로 진행한다.
13. 점수 규칙: 패자 0점. 승자는 **2:0 승리(두 판 연속 승리) 20점, 2:1 승리 10점.**
    - 무승부 판은 판 수에 들어가지 않으므로 연속 승리를 끊지 않는다. (승-무-승 = 2:0 → 20점)
    - 상대가 봇이어도 같은 점수를 준다.
    - 봇이 대신 플레이한 유저도 결과를 그대로 반영한다 (봇이 이기면 원래 유저가 10점). 중간에 재접속해 이어서 한 경우도 동일.
    - 점수는 rank_daily / rank_weekly 에 누적한다.

## DB 테이블 기본 구성

구현: `src/db/schema.sql` (`npm run db:init` 으로 적용, 여러 번 실행해도 안전). 실제 컬럼 목록은 그 파일이 기준이다.

- user_partner_info(파트너사의 유저 기본 정보) : userid(PK), partner, mid, gender, created_at / UNIQUE(partner, mid)
- user_member_info(유저의 기본 정보) : userid(PK, FK→user_partner_info), name, avatar, phone(VARCHAR(100)), join_date, login_date, certification_date(본인 인증 날짜), terms_date(약관인증 동의 날짜)
- user_play_info(유저의 게임 play 정보) : userid(PK, FK→user_partner_info), total_game_count, total_win_count, today_game_count, today_win_count, today_date (score_max 는 두지 않는다 — 점수는 rank_daily/rank_weekly 에서만 관리)
- game_log_2026_09(게임 로그 정보, 월별) : start_time, end_time, win(승자 userid), lose(패자 userid), score, plays, win_is_bot, lose_is_bot
  - 테이블 이름이 매달 바뀌므로 schema.sql 에 없다. `src/db/gameLogSchema.ts` 의 `EnsureGameLogTable()` 이 필요할 때 동적으로 만든다 (`db:init` 이 이번 달 것을 미리 만들어 둠)
  - 승자/패자 각각 **게임이 끝날 때 유저가 직접 했는지, 봇이 했는지** 기록한다 (win_is_bot, lose_is_bot)
  - 최종 스코어는 승자 기준 `"2:0"` / `"2:1"` 문자열로 score 컬럼에 저장한다. 판별 가위바위보 값도 계속 기록한다.
  - 무승부 판은 **개수 제한 없이** 모두 기록한다. 판 수가 정해져 있지 않으므로 play1~playN 고정 컬럼 대신
    **plays 컬럼 하나(JSON 배열)** 에 무승부 판을 포함한 모든 판을 순서대로 저장한다.
- rank_weekly (주간 랭킹 테이블/월요일 리셋/date_start 로 주간별 정보 체크) : date_start, userid, score
- rank_daily (일일 랭킹 테이블) : date_game, userid, score

> ⚠️ 개발 PC 의 `rps_game` DB 에 이 설계와 다른 옛 테이블(phone VARCHAR(20), score_max 있음, `game_result_log` 단일 테이블)이 미리 있었던 적이 있다.
> 전부 빈 테이블이라 지우고 이 설계로 다시 만들었다. **다른 환경에서 `db:init` 하기 전에도 기존 테이블 구조를 먼저 확인할 것.**
- "오늘"의 기준은 매일 00:00:00 ~ 23:59:59 (서버 시간 KST 기준). today_game_count / today_win_count 와 rank_daily 모두 이 기준을 따른다.
- 랭킹은 **1~100위**까지 보여 주고, 조회한 유저 **본인의 순위와 점수**를 함께 보여 준다 (100위 밖이어도 표시).
- 필요한 테이블 추가 생성

## 통신 프로토콜 — JSON 메시지 envelope

Colyseus 메시지 이름 = `type`, 메시지 본문 = envelope.

```json
{ "type": "MESSAGE_TYPE", "payload": { }, "ts": 0 }
```

- S→C: 항상 envelope 전체를 보낸다. (`common/messages.ts` 의 `SendMessage`)
- C→S: 서버는 `payload` 만 읽는다. 클라이언트는 `{ "payload": { ... } }` 만 보내도 된다.
- 서버가 연결을 끊을 때는 종료 코드를 반드시 준다. 코드를 주지 않으면 클라이언트 SDK 가 자동 재접속을 시도한다.
  - 매칭되어 게임방으로 옮겨 가는 경우: `CloseCode.CONSENTED` (4000)
  - 오류로 내보내는 경우: `CloseCode.WITH_ERROR` (4002)

### 접속 순서 (Phase 4)

1. `ENTER_LOBBY` `{ partner, mid, gender, phone }` 전송. 접속 후 10초 안에 보내지 않으면 `ENTER_TIMEOUT` 후 연결 종료
2. 서버: userid 생성 → 유저 조회(없으면 생성) → `LOBBY_ENTERED` → 대기열 등록
3. 게임 참여를 신청하면 게임 채널 배정 → 'MATCH_FOUND' 서버가 로비 연결을 끊음
4. 클라이언트는 10초 안에 게임방에 입장
   (게임방은 잠겨 있어 이름/roomId 로 직접 들어올 수 없고, 서버가 예약한 좌석으로만 입장 가능)

### 메시지 타입

| type | 방향 | payload | 용도 |
|---|---|---|---|
| ENTER_LOBBY | C→S | `{ partner, mid, gender, phone }` | 로비 진입 요청 (gender: F/M, phone: 필수 — 기존 유저는 phone 갱신) |
| LOBBY_ENTERED | S→C | `{ user: UserInfo, is_new_user }` | 유저 게임 정보 전달 (본인 정보라 userid 포함) |
| JOIN_MATCH | C→S | (Phase 4 확정) | "게임 참여" — 매칭 대기열 등록 |
| CANCEL_MATCH | C→S | (Phase 4 확정) | 매칭 대기 취소 — 대기열에서 빼고 로비에 남음. 이미 매칭된 뒤 도착하면 무시 |
| MATCH_FOUND | S→C | `{ room_name, room_id, seat_reservation, opponent: { name, avatar } }` | 매칭 완료. 상대 userid 는 보내지 않는다 |
| ROOM_ENTER_ACK | C→S | (Phase 5 확정) | 게임방 입장 완료 신호 |
| GAME_START | S→C | (Phase 5 확정) | 양쪽 입장 완료 확인 후 게임 시작 신호 |
| SUBMIT_CHOICE | C→S | (Phase 5 확정) | 가위/바위/보 선택 제출 |
| OPPONENT_CHOICE | S→C | (Phase 5 확정) | 상대방 선택 값 브로드캐스트 |
| ROUND_RESULT | S→C | (Phase 5 확정) | 승/패/무승부 결과 |
| RETURN_TO_LOBBY | S→C | (Phase 5 확정) | 로비 복귀 지시 |
| NOTICE | S→C | `{ message }` | 관리자 공지. 로비/게임 채널의 모든 유저에게 실시간 전송 (Phase 7) |
| ERROR | S→C | `{ code, message }` | 에러/예외 상황 (Phase 6 에서 공통 처리 확장) |

### ERROR 코드

| code | 의미 | 서버 동작 |
|---|---|---|
| INVALID_REQUEST | ENTER_LOBBY payload 형식 오류 | 연결 종료 |
| INVALID_ID | partner / mid / gender / phone 형식 오류 | 연결 종료 |
| ALREADY_CONNECTED | 같은 유저가 이미 로비 대기 중이거나 게임 중 | 연결 종료 |
| ALREADY_ENTERED | 이 연결은 이미 로비에 들어와 있음 | 무시 (연결 유지) |
| ENTER_TIMEOUT | 제한 시간 안에 ENTER_LOBBY 를 보내지 않음 | 연결 종료 |
| SERVER_ERROR | 서버 내부 오류 (DB 등) | 연결 종료 |
| CHANNEL_FULL | 로비 채널 최대 접속 인원(300명) 초과 | 연결 종료 (다른 로비 채널 안내 없음, 클라이언트가 다른 로비로 재시도) |
| NO_GAME_ROOM | 모든 게임 채널이 가득 참. message: "접속 가능한 게임방이 없습니다. 잠시 후 다시 참여 해 주세요." | 무시 (연결 유지, 로비에 남음) |

## 코딩 컨벤션

- WatcherManager / LobbyManager / RoomManager는 역할을 분리하고 서로 직접 DB 쿼리를 하지 않는다. DB 접근은 반드시 `db/` 모듈을 통한다.
- DB/Redis 접속 정보는 `.env`로 관리하고 코드에 하드코딩하지 않는다.
- 연결 종료/재접속 시나리오를 각 매니저에서 반드시 고려한다.
- 1차 구현은 `partner + mid` 만으로 유저를 식별한다 (별도 인증 없음). 파트너사 토큰 검증은 추후 추가하므로,
  `ENTER_LOBBY` 검증 코드는 인증 단계를 끼워 넣기 쉬운 구조로 둔다. (XOR userid 변환은 암호화가 아니라 형식 변환이다)

