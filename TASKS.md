# TASKS.md — 단계별 작업 목록

> 이 문서는 `CLAUDE.md`(프로젝트 설명서)를 바탕으로 **무엇을, 어떤 순서로** 만들지 정리한 체크리스트입니다.
> 한 번에 다 만들려고 하지 말고, **한 Phase 를 끝내고 "완료 확인"을 통과한 뒤** 다음 Phase 로 넘어가세요.
>
> - `[ ]` 할 일 / `[x]` 끝난 일 — 끝날 때마다 체크해 두면 진행 상황을 한눈에 볼 수 있습니다.
> - Phase 번호는 `CLAUDE.md` 에 나오는 "Phase 4 / 5 / 6" 표기와 맞춰 두었습니다.

---

## 전체 흐름 한눈에 보기

```
Phase 0  개발 환경 준비          (Node, MySQL, Redis 설치)
Phase 1  서버 뼈대 만들기        (Colyseus 서버가 켜지기만 하면 성공)
Phase 2  DB / Redis 연결         (유저 정보를 저장하고 꺼내 오기)
Phase 3  로비 채널               (접속 → 유저 확인 → 로비 입장)
Phase 4  매칭 + 게임 채널 이동   (게임 참여 → 좌석 예약 → 게임 채널로 이동)
Phase 5  가위바위보 게임         (2선승제 + 재게임 + 결과 저장)
Phase 6  예외 처리 / 안정성      (끊김, 재접속, 봇, 에러 코드 정리)
Phase 7  Watcher(관리자) 채널    (전체 상태 보기 + 공지 전파)
Phase 8  랭킹                    (일간 / 주간 랭킹)
Phase 9  부하 테스트 / 배포 준비  (300명 동시 접속 확인)
```

### 채널 구성 그림 (이 그림을 머릿속에 두고 진행하세요)

```
                 ┌──────────────────────┐
                 │  Watcher 채널 (1개)  │  ← 모든 채널 감시, 공지 전파
                 └──────────┬───────────┘
                            │ (Redis 로 정보 공유)
      ┌─────────────────────┼─────────────────────┐
      ▼                     ▼                     ▼
┌──────────┐          ┌──────────┐    ┌─────────────────────────────┐
│ 로비 1   │          │ 로비 2   │    │ 게임 채널 1 → 2 → 3 순서로  │
│ lobby_1  │          │ lobby_2  │    │ 채움 (game_1, game_2, ...)  │
└──────────┘          └──────────┘    │ 채널당 방 100개 / 200명     │
  ▲ 클라이언트는 둘 중 랜덤 접속       └─────────────────────────────┘
```

- **채널 = 소켓 = 서버 프로세스 하나(포트 하나)** 라고 생각하면 쉽습니다. 총 6개 (Watcher 1 + 로비 2 + 게임 3).

  | 채널 | 룸 이름 | 포트 |
  |---|---|---|
  | Watcher | - | 6000 |
  | 로비 1 / 2 | `lobby_1` / `lobby_2` | 6011 / 6012 |
  | 게임 1 / 2 / 3 | `game_1` / `game_2` / `game_3` | 6021 / 6022 / 6023 |
- 채널 **번호**는 **1부터** (`lobby_1`) 셉니다. 채널 ID(`lobby-1`)와 같은 값이라 헷갈릴 일이 없습니다.

### 유저 정보가 채널 사이를 오가는 방법 (하이브리드 방식)

```
① 로비 입장     DB(또는 Redis)에서 조회 ──▶ Redis 에 저장 (TTL 120초)
② 로비 → 게임방  좌석 예약(reserveSeatFor)에 유저 정보를 담아 전달 ──▶ 게임방 onJoin 에서 바로 사용
                 (Redis / DB 조회 없음)
③ 게임 종료     DB 업데이트 직후 ──▶ Redis 도 같은 값으로 갱신 (write-through)
④ 게임방 → 로비  Redis 에서 읽기 (없으면 DB)
⑤ 떠날 때       값은 다시 쓰지 않고 TTL 만 120초로 다시 설정
```

> 💡 **왜 "떠날 때 저장"이 아니라 "바뀔 때 저장"인가요?**
> 로비의 `onLeave` 는 연결이 끊긴 **뒤에** 실행됩니다. 클라이언트는 끊기자마자 새 채널에 접속하므로, 새 채널이 Redis 를 먼저 읽으면 값이 비어 있어 DB 를 다시 조회하게 됩니다. 값이 바뀌는 순간 바로 써 두면 이런 순서 문제가 생기지 않습니다.

---

## Phase 0 — 개발 환경 준비

**목표:** 코드를 짜기 전에, 필요한 프로그램이 내 PC 에서 돌아가게 만든다.

- [x] Node.js LTS 설치 → 터미널에서 `node -v`, `npm -v` 확인 — **Node v24.14.1 / npm 11.11.0**
- [x] MySQL 설치 (또는 Docker 로 실행) → 접속 확인 — **XAMPP 의 MariaDB 10.4.32** (포트 3306, MySQL 호환)
  - DB 계정은 Phase 2 에서 `.env` 에 직접 입력 (채팅/코드에 적지 않기)
- [x] Redis 설치 (Windows 는 Docker 또는 WSL 권장) — **포트 6780** 으로 실행
  - 기존에 설치된 **Redis 3.0.504** (6379 서비스, 다른 용도)는 그대로 두고, 프로젝트 전용 인스턴스를 6780 에 추가로 띄움
  - 설정 파일: `redis/redis-6780.conf` (데이터·로그는 `redis/data/`, Git 제외)
  - 실행 (server 폴더에서): `"C:\Program Files\Redis\redis-server.exe" redis\redis-6780.conf`
  - 확인: `"C:\Program Files\Redis\redis-cli.exe" -p 6780 ping` → `PONG` 응답
  - ⚠️ 서비스로 등록하지 않았으므로 **PC 를 재시작하면 다시 실행**해야 함 (Phase 1 에서 npm 스크립트로 만들 예정)
  - ⚠️ Redis 3.0 은 구버전 — Phase 4 에서 Colyseus Redis Presence/Driver 호환 문제가 생기면 최신 버전(Memurai 등)으로 교체
- [ ] (선택) Git 저장소 만들기 → `git init` — `.gitignore` 는 작성 완료 (`node_modules/`, `dist/`, `.env`, `redis/data/`)

**완료 확인**
- [x] Node / MySQL / Redis(6780) 세 가지가 모두 실행되는 것을 확인했다. (2026-09-22)

> 💡 **용어**
> - **MySQL**: 영구 저장소. 서버를 꺼도 데이터가 남는다. (유저 정보, 게임 기록)
> - **Redis**: 메모리 저장소. 아주 빠르지만 임시 보관용. (채널 간 공유 유저 정보, 채널 상태, 공지 전파)

---

## Phase 1 — 서버 뼈대 만들기

**목표:** 아무 기능 없이 "Colyseus 서버가 켜진다" 까지만 만든다.

### 1-1. 프로젝트 초기화
- [x] `npm init -y` — ESM(`"type": "module"`) 으로 설정 (Colyseus 0.18 이 ESM 패키지)
- [x] TypeScript 설치 및 `tsconfig.json` 작성 — TypeScript 7.0.2, `@types/node` 24
- [x] Colyseus 설치 (서버 패키지) — **설치 시점의 최신 안정판**, 설치한 버전을 `CLAUDE.md` 기술 스택에 기록
  - 통합 패키지 `colyseus` 대신 **`@colyseus/core` 0.18.15 + `@colyseus/ws-transport` 0.18.2** 만 설치 (모니터/인증/playground 등 HTTP 기능 제외)
  - `express` 5 추가 설치 — ws-transport 가 파일 맨 위에서 express 를 불러와서 없으면 서버가 켜지지 않음 (우리 코드에서 HTTP API 로 쓰지 않음)
  - `.env` 는 Node 내장 `process.loadEnvFile()` 로 읽음 (dotenv 불필요)
  - [x] 이 버전에서 `matchMaker.reserveSeatFor(room, options, auth_data)` 의 3번째 인자와 `onJoin(client, options, auth)` 의 3번째 인자를 지원하는지 확인 (Phase 4 에서 사용) — **둘 다 지원**
  - 참고: `allowReconnection(client, "manual")` 지원 (Phase 6), 재접속용 `onDrop` / `onReconnect` 훅 있음
- [x] `package.json` 에 스크립트 추가: `dev`(개발 실행), `build`(컴파일), `start`(실행)
  - 채널별 실행: `start:watcher`, `start:lobby1`, `start:lobby2`, `start:game1~3` / Redis 실행: `npm run redis`

### 1-2. 공통 파일 (`src/common/`)
- [x] `config.ts` — `.env` 파일을 읽어서 설정값으로 제공 (포트, DB 주소, Redis 주소/포트 등) — DB 항목은 Phase 2 에서 추가
- [x] `.env.example` 작성 — **실제 비밀번호는 넣지 않은** 예시 파일 (`.env` 는 Git 에 올리지 않음)
  - Redis 포트 기본값 예시: `REDIS_PORT=6780`
  - 채널 포트 예시 (채널 번호는 1부터): `WATCHER_PORT=6000`, `LOBBY_PORTS=6011,6012`, `GAME_PORTS=6021,6022,6023`
  - TLS 설정 예시: `USE_TLS=true`, `TLS_CERT_PATH=...`, `TLS_KEY_PATH=...` — **모든 채널 wss**, 개발 환경에서만 `USE_TLS=false`(ws)
- [x] 모든 통신은 소켓으로만 한다 — HTTP API 를 따로 만들지 않는다 (관리자 페이지 포함)
  - 단, Colyseus 는 방 입장 전 **매칭 요청(`POST /matchmake/...`)을 같은 포트의 HTTP 로 처리**한다. 프레임워크 내부 동작이라 그대로 둔다
- [x] `constants.ts` — 규모/규칙 숫자를 한 곳에 모아 두기
  - 채널당 최대 접속 300 / 게임 채널당 방 100개 · 인원 200 / 방당 2명
  - 선택 제한 5초 / **이기면 끝나는 승수 2 (최대 3판, 2선승제)** / 재접속 대기 5초 / 재게임·나가기 선택 5초
  - Redis TTL 120초 / ENTER_LOBBY 제한 10초 / 좌석 예약 10초
- [x] `channelNames.ts` — 이름 규칙 함수 (`lobby_N`, `game_N`), 채널 ID(`lobby-1`, `game-3` — 종류별로 1부터), 채널 포트 조회
- [x] `types.ts` — 메시지 envelope 타입 `{ type, payload, ts }`, 메시지 타입 목록, ERROR 코드
- [x] `messages.ts` — `SendMessage()`, `SendError()`, `ReadPayload()` 헬퍼

### 1-3. 서버 실행
- [x] `src/index.ts` 작성 — 실행 인자로 "어떤 채널로 켤지" 받아 해당 포트로 서버 기동
  - 사용법: `node dist/index.js <watcher|lobby|game> <채널 번호(1부터)>` (예: `node dist/index.js lobby 1` → 포트 6011)
  - `USE_TLS=true` 이면 https 서버 위에 wss, 아니면 ws
  - 게임/Watcher 채널은 포트만 열고 룸 등록은 Phase 4 / Phase 7 에서
- [x] 빈 `LobbyRoom` 하나를 등록해서 서버가 켜지는지 확인

**완료 확인**
- [x] `npm run dev` 로 서버가 에러 없이 켜진다. (2026-09-22)
  - 매칭 요청 → 좌석 예약 수신 → WebSocket 접속 → `LobbyRoom` 접속/퇴장 로그 확인
  - 잘못된 채널 번호/종류를 넣으면 사용법 에러로 종료되는 것 확인
- [x] 코드 어디에도 비밀번호/계정 정보가 직접 적혀 있지 않다. (모두 `.env` 에서 읽음)

> 💡 **왜 상수를 한 곳에 모으나요?** "5초"를 코드 10군데에 직접 쓰면, 나중에 7초로 바꿀 때 10군데를 다 찾아야 합니다. `constants.ts` 한 곳만 바꾸면 되도록 미리 모아 둡니다.

---

## Phase 2 — DB / Redis 연결 + 유저 정보

**목표:** `(partner, mid)` 로 유저를 찾고, 없으면 새로 만들고, Redis 에 캐시하는 기능을 **게임과 상관없이** 먼저 완성한다.

### 2-1. userid 변환 (`src/common/userid.ts`)
- [x] `ConvertMidToUserid(partner, mid)` 구현
  - mid 의 글자마다 `문자코드 ^ 5` → 10진수 문자열로 이어 붙이기 (예: `'u'(117) ^ 5 = 112` → `"112"`)
  - 결과: `partner + "_" + 변환값`
- [x] 입력 검사 함수
  - partner: 영문/숫자 1~11자(`_` 금지)
  - mid: 영문/숫자 1~63자
  - gender: `F` 또는 `M` 만 허용
  - phone: **빈 값 불가**, 텍스트 최대 100자
- [x] 간단한 테스트: 같은 입력 → 항상 같은 결과, 다른 partner → 다른 결과
  - `ConvertMidToUserid("p", "u")` → `"p_112"` (CLAUDE.md 예시와 일치 확인)
  - `IsValidPartner`/`IsValidMid` 로 `_` 포함, 길이 초과, 한글 등 형식 오류도 확인

### 2-2. DB 스키마 (`src/db/schema.sql`)
- [x] `user_partner_info` — userid(PK), partner, mid, gender, created_at / UNIQUE(partner, mid)
- [x] `user_member_info` — userid, name, avatar, phone, join_date, login_date, certification_date, terms_date
- [x] `user_play_info` — userid, total_game_count, total_win_count, today_game_count, today_win_count, today_date (score_max 없음)
- [x] `user_member_info.phone` — `VARCHAR(100)`
- [x] `game_log_YYYY_MM` — start_time, end_time, win, lose, score, plays, win_is_bot, lose_is_bot (월별 테이블)
  - `src/db/gameLogSchema.ts` 에 `GetGameLogTableName(date)` / `EnsureGameLogTable(pool, date)` 로 구현 (테이블명이 매달 바뀌어 schema.sql 에는 못 넣음)
  - plays 는 `JSON` 컬럼 — 무승부 포함 모든 판을 배열로 저장. 정확한 원소 모양은 Phase 5 에서 확정
  - `npm run db:init` 이 이번 달 테이블을 미리 만들어 둔다. 다음 달 것은 Phase 5 에서 로그 쓰기 직전에 `EnsureGameLogTable` 호출
- [x] `rank_daily`, `rank_weekly` (Phase 8 에서 사용)
- [x] userid 를 담는 모든 컬럼은 `VARCHAR(255)`, partner 는 `VARCHAR(16)`, mid 는 `VARCHAR(64)`
- [x] 모두 `CREATE TABLE IF NOT EXISTS` 로 작성 (여러 번 실행해도 안전)

> ⚠️ **실행 중 발견한 문제:** `rps_game` DB 에 이미 다른 구조의 테이블이 있었다 (phone VARCHAR(20), score_max 존재, `game_log_YYYY_MM` 대신 `game_result_log` 테이블 1개). `IF NOT EXISTS` 라 조용히 넘어가고 실제로는 0개 테이블만 생성됐던 것을 확인 후, 전부 빈 테이블임을 확인하고 지운 뒤 이 설계대로 다시 만들었다. **다른 개발 PC 에서 `db:init` 하기 전에도 기존 테이블 유무를 먼저 확인할 것.**

### 2-3. DB 연결 / 초기화
- [x] `db/connection.ts` — MySQL connection pool (mysql2/promise)
- [x] `db/initDb.ts` — DB 생성 + 스키마 적용, `npm run db:init` 으로 실행
  - schema.sql 은 tsc 가 컴파일하지 않으므로 `scripts/copy-assets.mjs` 가 빌드 때 `dist/db/` 로 복사한다
  - ⚠️ **버그 수정:** 세미콜론으로 SQL 문을 나눌 때, `-- 설명` 주석이 CREATE TABLE 문 바로 위에 붙어 있어서
    "주석으로 시작하면 버린다"는 필터가 문장 전체를 걸러 버렸다 (처음 실행 시 "테이블 0개 생성"으로 조용히 실패).
    주석 줄만 먼저 지우고 나서 세미콜론으로 나누도록 고쳤다.

### 2-4. 쿼리 모듈 (`src/db/queries/`)
- [x] `userPartnerInfo.ts` — (partner, mid) → userid 조회
- [x] `userInfo.ts` — user_partner_info + user_member_info + user_play_info 조회 (phone 포함, DB 내부용 `CachedUserInfo`)
- [x] phone 갱신 쿼리 — 기존 유저가 저장된 값과 **다른 phone** 을 보내면 user_member_info.phone 업데이트 (같으면 쓰지 않음, `UpdatePhoneIfChanged`)
- [x] `userRegistration.ts` — 첫 접속 유저를 3개 테이블에 **한 트랜잭션**으로 등록 (gender 는 user_partner_info, phone 은 user_member_info 에 저장)
  - 동시에 두 번 호출돼도 한 번만 만들어지게 `INSERT IGNORE` 사용

### 2-5. Redis
- [x] `db/redis.ts` — Redis 연결(포트는 `.env` 에서) + JSON 저장/조회/삭제 헬퍼 (ioredis)
  - ⚠️ ioredis 는 CJS 패키지라 `import Redis from "ioredis"` 기본 import 가 TypeScript 7 + `module: nodenext` 조합에서 타입 에러가 났다.
    `import { Redis } from "ioredis"` **named import** 로 바꿔서 해결 (tsconfig 에 `esModuleInterop: true` 도 추가)
- [x] `db/userCache.ts` — 키 `user:info:{userid}`, TTL 120초(2분)
  - [x] `SaveUserCache(user)` — 값 저장 + TTL 설정 (값이 **바뀔 때** 호출)
  - [x] `TouchUserCache(user)` — TTL 만 120초로 다시 설정, 키가 이미 없으면 `SaveUserCache` 로 다시 저장 (**떠날 때** 호출)
- [x] `db/userRepository.ts` — 유저 조회의 **유일한 입구** (`GetOrCreateUser`)
  - Redis 에 있으면 Redis 값 사용 → 없으면 DB 조회 → DB 에도 없으면 새로 등록
  - DB 에서 가져왔거나 새로 만든 경우 바로 Redis 에 저장
  - phone 이 바뀌었으면 DB/Redis 갱신 (write-through)
  - `db/types.ts` 의 `CachedUserInfo`(phone 포함, 서버 내부용) / `common/types.ts` 의 `UserInfo`(phone 제외, 클라이언트용) 로 구분
    → `ToPublicUserInfo()` 로 변환해서 반환. phone 은 Redis 캐시(서버 내부)에는 들어가지만, 클라이언트나 좌석 예약에는 나가지 않는다

**완료 확인**
- [x] `npm run db:init` 으로 테이블이 생성된다. (2026-09-22, 5개 테이블 + 이번 달 game_log)
- [x] 테스트 스크립트로: 처음 부르면 "새 유저"(`is_new_user: true`), 두 번째 부르면 "기존 유저" 가 나온다.
- [x] 두 번째 조회는 DB 가 아니라 Redis 에서 온다. (Redis 키를 지운 뒤 다시 불러도 DB 에서 정상 조회되는 것까지 확인)
- [x] Redis 에 저장한 값의 TTL 이 120초로 잡힌다. (`redis-cli -p 6780 TTL user:info:...` 로 확인)

> 💡 **왜 userRepository 한 곳만 거치나요?** 로비/게임/Watcher 매니저가 각자 SQL 을 짜면, 캐시 규칙(Redis 먼저 → DB)을 빠뜨리는 곳이 생깁니다. 입구를 하나로 두면 규칙이 항상 지켜집니다.

---

## Phase 3 — 로비 채널

**목표:** 클라이언트가 로비에 접속해서 `ENTER_LOBBY` → `LOBBY_ENTERED` 를 주고받는다.

### 3-1. 로비 룸 생성
- [x] 로비 채널 2개를 서로 다른 포트로 실행 (`lobby_1` = 6011, `lobby_2` = 6012)
- [x] 서버 기동 시 로비 룸을 **채널당 1개** 미리 만들어 둔다 (`autoDispose = false` — 사람이 0명이어도 방이 사라지지 않음)
  - `matchMaker.createRoom()` 을 `server.listen()` **이후**에 호출해야 한다 (`matchMaker.accept()` 가 `listen()` 안에서 실행되므로, 그 전에 부르면 실패)
- [x] 로비 최대 접속 300명 제한 — 넘으면 `CHANNEL_FULL` 에러 후 연결 종료 (`WITH_ERROR`)
  - 다른 로비 주소는 알려 주지 않는다. 클라이언트가 알아서 다른 로비로 다시 시도
  - ⚠️ **버그 발견 및 수정:** 처음엔 `onJoin` 에서 바로 인원수를 검사해 에러+종료했는데, Colyseus 클라이언트가
    `JOIN_ROOM` 핸드셰이크를 마치기 전(=`onJoin` 실행 시점)에는 서버가 보낸 메시지를 큐에만 쌓아 두고 실제
    전송하지 않는다. `onJoin` 안에서 곧바로 `client.leave()` 를 부르면 그 큐가 플러시될 기회가 없어
    `CHANNEL_FULL` 에러 내용이 클라이언트에 끝내 전달되지 않았다(연결 종료 코드만 받음). 그래서 인원 제한 검사를
    **`ENTER_LOBBY` 처리 시점**으로 옮겼다 — 그때는 클라이언트가 이미 핸드셰이크를 마친 뒤라 안전하게 전달된다.

### 3-2. 입장 처리 (`LobbyManager.ts`, `LobbyRoom.ts`)
- [x] 접속 후 10초 안에 `ENTER_LOBBY` 가 안 오면 → `ENTER_TIMEOUT` 에러 후 연결 종료 (`this.clock.setTimeout` 사용)
- [x] `ENTER_LOBBY { partner, mid, gender, phone }` 처리 순서
  1. payload 형식 검사 → 틀리면 `INVALID_REQUEST`
  2. partner / mid / gender / phone 형식 검사 → 틀리면 `INVALID_ID`
     - ⚠️ phone 은 개인정보 — 에러 로그에도 값 그대로 남기지 않는다 (뒷자리 4자리만 남기고 마스킹, `MaskPhone()`)
     - 1차 구현은 별도 인증 없음. `VerifyAuth()` 함수를 미리 분리해 둬서 나중에 토큰 검증만 채우면 되게 함
  3. userid 생성 → `userRepository` 로 유저 조회(없으면 생성) — 이 과정에서 Redis 에도 저장됨
  4. 같은 userid 가 이미 로비 대기 중이거나 게임 중 → `ALREADY_CONNECTED`
     (지금은 **이 로비 룸 안에서만** 검사한다 — 다른 채널/게임 중 여부는 CLAUDE.md 흐름 12번대로 아직 막지 않음)
  5. 성공 → `LOBBY_ENTERED { user, is_new_user }` 전송, 대기 목록에 등록
- [x] 이미 입장한 연결이 `ENTER_LOBBY` 를 또 보내면 → `ALREADY_ENTERED` (연결은 유지)
- [x] 기존 유저의 phone 이 바뀌었으면 DB 갱신 → `SaveUserCache` 로 Redis 도 갱신 (write-through) — Phase 2 의 `GetOrCreateUser` 가 이미 처리
- [x] DB 오류 등 → `SERVER_ERROR` 후 연결 종료
- [x] 연결을 끊을 때는 **반드시 종료 코드**를 준다 (`WITH_ERROR` = 4002)

### 3-3. 로비 퇴장
- [x] 대기 목록에서 제거
- [x] `TouchUserCache` 로 Redis TTL 만 다시 설정 (값은 이미 입장 때 저장되어 있음)
  - 퇴장 시점에 Redis 에서 `CachedUserInfo` 를 다시 읽어(phone 포함) `TouchUserCache` 에 넘긴다 — 이미 만료됐으면
    (드문 경우) 그냥 둔다. 다음 `ENTER_LOBBY` 때 DB 에서 다시 채워지므로 문제 없다

**완료 확인**
- [x] 테스트 클라이언트로 접속 → `LOBBY_ENTERED` 수신 (2026-09-22, 직접 만든 최소 프로토콜 클라이언트로 확인 — 아래 참고)
- [x] 각 에러 코드(`INVALID_REQUEST`, `INVALID_ID`, `ALREADY_ENTERED`, `ALREADY_CONNECTED`, `ENTER_TIMEOUT`(실제 10초 대기), `CHANNEL_FULL`)를 일부러 발생시켜 확인
  - `CHANNEL_FULL` 은 `MAX_CLIENTS_PER_CHANNEL` 을 2로 잠시 낮춰서 확인 후 300으로 복구
- [x] 로비를 나갔다가 다시 들어오면 DB 조회 없이 Redis 에서 정보를 가져온다. (실제 `leave()` 후 재접속 + Redis TTL 값(119초)까지 확인)
- [x] `CLAUDE.md` 의 ERROR 코드 표와 실제 동작이 일치한다. (`SERVER_ERROR` 는 코드 리뷰로만 확인 — DB 장애를 실제로 일으키진 않음)

> ⚠️ **테스트 도구 관련 문제:** 공식 클라이언트 SDK `colyseus.js` 는 아직 0.16.x 까지만 배포되어 있어 서버(0.18)와
> 매칭 응답 형식이 달라 호환되지 않았다 (`reservation.room.name` 을 기대하는데 0.18 서버는 `{name, sessionId, roomId, processId}`
> 를 평평하게 반환). 서버 소스(`@colyseus/core` 의 `Protocol.mjs`, `Room.mjs`)를 참고해 ROOM_DATA 프레임만 다루는
> 최소 테스트 클라이언트를 직접 작성해서 확인했다 (`--no-save` 로 설치해 `package.json` 에는 남기지 않음, 테스트 후 삭제).
> 메시지 타입/내용은 `msgpackr` 의 `unpackMultiple()` 로 분리해서 읽으면 된다.

> 💡 **종료 코드를 꼭 줘야 하는 이유:** 코드 없이 끊으면 Colyseus 클라이언트 SDK 는 "네트워크가 잠깐 끊겼나 보다" 하고 **자동 재접속**을 시도합니다. 서버가 의도적으로 내보낸 건데 계속 다시 들어오는 문제가 생깁니다.

> 💡 **onJoin 안에서 메시지를 보낼 때 주의:** Colyseus 는 클라이언트가 `JOIN_ROOM` 핸드셰이크를 마치기 전까지 서버가 보낸
> 메시지를 큐에 쌓아만 두고 전송하지 않습니다. `onJoin` 에서 검사 후 곧바로 연결을 끊어야 하는 로직이 있다면, 메시지가
> 실제로 전달되는지 반드시 확인하세요. (이번 `CHANNEL_FULL` 버그가 정확히 이 문제였습니다 — `ENTER_LOBBY` 처리 시점처럼
> 클라이언트가 이미 메시지를 보낼 수 있는 상태에서 검사하면 안전합니다.)

---

## Phase 4 — 매칭 + 게임 채널 이동

**목표:** 로비에서 "게임 참여" → 게임 채널의 방 좌석을 예약(유저 정보 포함) → 클라이언트가 로비를 떠나 게임방으로 이동한다.

### 4-1. 게임 채널 준비
- [ ] 게임 채널 3개를 서로 다른 포트로 실행 (`game_1` = 6021, `game_2` = 6022, `game_3` = 6023)
- [ ] 게임방은 **잠금 상태**로 만든다 → 이름/roomId 로 직접 못 들어오고, 예약된 좌석으로만 입장
- [ ] 채널당 방 최대 100개 / 인원 200명 제한

### 4-2. 채널 간 정보 공유 (중요!)
- [ ] 여러 프로세스가 하나의 Colyseus 처럼 동작하도록 **Redis 기반 Presence / Driver** 설정
  - 로비 프로세스가 **다른 프로세스(게임 채널)의 방**에 좌석을 예약하려면 반드시 필요합니다.
  - 좌석 예약에 담은 유저 정보도 이 경로(Redis pub/sub)를 통해 게임방 프로세스로 전달됩니다.
- [ ] 각 채널의 현재 인원/방 개수를 Redis 에 기록 (채널 선택과 Watcher 에서 사용)

### 4-3. 매칭 (`LobbyManager.ts` → `RoomManager.ts`)
- [ ] "게임 참여"(`JOIN_MATCH`) 요청을 받으면 대기열에 넣기
- [ ] **매칭 대기 취소**(`CANCEL_MATCH`) — 대기열에서 빼고 로비에 그대로 남긴다
  - 이미 매칭되어 좌석 예약이 진행된 뒤 도착한 취소는 무시 (매칭과 취소가 동시에 일어나는 경우 주의)
  - 대기열에 없는 유저가 보내도 에러 없이 무시
- [ ] `JOIN_MATCH` / `CANCEL_MATCH` payload 확정 → `CLAUDE.md` 메시지 표 반영
- [ ] 매칭할 방을 고르는 순서
  1. **상대를 기다리는 방**(재게임을 신청하고 혼자 남은 유저가 있는 방, Phase 5-4)이 있으면 → 로비 유저 **1명**을 그 방에 넣는다
  2. 없으면 로비 대기열에서 **2명**이 모일 때 새 방을 만든다
  - "기다리는 방" 목록은 Redis 에 기록해 로비 프로세스가 볼 수 있게 한다 (게임방 프로세스가 등록/삭제)
- [ ] 게임 채널 선택 규칙: **1번 채널부터 채우고, 꽉 차면 다음 채널** 로
- [ ] 게임 채널 3개가 **모두 찼으면** → `NO_GAME_ROOM` 에러 전송, 유저는 로비에 그대로 남는다 (연결 유지)
  - message: "접속 가능한 게임방이 없습니다. 잠시 후 다시 참여 해 주세요."
- [ ] `RoomManager` 가 게임방 생성(또는 기다리는 방 찾기)
- [ ] 좌석을 예약하면서 **유저 정보를 함께 담는다**
  - `matchMaker.reserveSeatFor(room, options, { user: ToGameUser(info) })`
  - 3번째 인자를 지원하지 않는 버전이면 2번째 인자(options)에 담는다 — 서버가 넣는 값이라 안전
  - `ToGameUser()` 로 게임에 필요한 값만 추린다 (userid, name, avatar 등). **phone 같은 개인정보는 넣지 않는다.**
- [ ] `MATCH_FOUND { room_name, room_id, seat_reservation, opponent: { name, avatar } }` 전송
  - ⚠️ 상대방 userid 는 보내지 않는다 (개인정보)
- [ ] 로비 연결 종료 — 종료 코드 `CONSENTED`(4000)

### 4-4. 클라이언트 이동 / 게임방 입장
- [ ] 클라이언트는 10초 안에 받은 좌석 예약으로 게임방 입장
- [ ] `GameRoom.onJoin(client, options, auth)` 에서 `auth.user` 를 바로 꺼내 플레이어 목록에 저장 (Redis/DB 조회 없음)
- [ ] 10초 안에 안 오면 좌석 만료 → 새로 만든 방이면 먼저 들어온 한 명은 `RETURN_TO_LOBBY` 로 로비 복귀
  - 기다리는 방에 들어오기로 한 유저가 안 온 경우에는 기다리던 유저를 로비로 보내지 않고 **다시 "기다리는 방"으로 등록**
- [ ] 기다리던 유저에게 새 상대가 들어왔음을 알린다 (예: `OPPONENT_JOINED { name, avatar }` — 상대 userid 는 보내지 않음)

**완료 확인**
- [ ] 테스트 클라이언트 2개로: 로비 접속 → 게임 참여 → `MATCH_FOUND` → 게임방 입장까지 성공
- [ ] 기다리는 방이 있으면 로비 유저 1명이 새 방이 아니라 그 방으로 들어간다.
- [ ] 게임방 입장 시 Redis/DB 조회가 일어나지 않는다. (로그로 확인)
- [ ] 클라이언트가 받은 `seat_reservation` 안에 유저 정보가 들어 있지 않다. (sessionId, 방 정보만 있음)
- [ ] 테스트 클라이언트 여러 개로 1번 채널이 먼저 차는지 확인

> 💡 **좌석 예약에 담은 정보는 왜 조작할 수 없나요?** 클라이언트가 받는 `seat_reservation` 은 "입장권 번호(sessionId)"와 방 주소뿐입니다. 유저 정보는 게임방 프로세스 메모리에 이미 있고, 클라이언트가 입장권을 내밀면 서버가 번호로 찾아서 꺼내 줍니다.

---

## Phase 5 — 가위바위보 게임 (`GameRoom.ts`)

**목표:** 2선승제 게임 규칙을 구현하고, 재게임과 결과 저장까지 처리한다.

### 5-1. 메시지 형식 확정
- [ ] `ROOM_ENTER_ACK`, `GAME_START`, `SUBMIT_CHOICE`, `OPPONENT_CHOICE`, `ROUND_RESULT`, `RETURN_TO_LOBBY` 의 payload 확정
- [ ] 게임 종료 후 선택용 메시지 추가 (예: `GAME_RESULT`(S→C, 최종 결과), `REMATCH_REQUEST` / `LEAVE_ROOM`(C→S))
- [ ] 새 상대 관련 메시지 추가 (예: `WAITING_OPPONENT`(S→C, 새 상대 기다리는 중), `OPPONENT_JOINED`(S→C, 새 상대 입장))
- [ ] 확정한 내용을 `CLAUDE.md` 메시지 표에 반영

### 5-2. 게임 진행
- [ ] 두 명 모두 `ROOM_ENTER_ACK` 를 보내면 → 양쪽에 `GAME_START`
- [ ] 판 시작 → `SUBMIT_CHOICE`(가위/바위/보) 수신
- [ ] 5초 안에 선택하지 않으면 서버가 **자동 선택**
- [ ] 두 명의 선택이 모이면 **동시에** `OPPONENT_CHOICE` 전송 (먼저 낸 사람 값이 새지 않도록!)
- [ ] 승패 판정 → `ROUND_RESULT`
- [ ] 무승부면 같은 판을 다시 진행 (승자가 나올 때까지)
- [ ] **먼저 2판을 이긴 사람이 나오면 즉시 게임 종료** (최대 3판)

### 5-3. 결과 저장 (게임이 끝날 때마다)
- [ ] 점수 계산: 패자 0점, 승자는 **2:0 승리 20점 / 2:1 승리 10점**
  - 무승부 판은 판 수에 들어가지 않으므로 연속 승리를 끊지 않는다 (승-무-승 = 2:0 → 20점)
  - 상대가 봇이어도, 봇이 대신 플레이했어도, 중간에 재접속해 이어서 했어도 같은 규칙
  - 판정 방법: 게임이 끝났을 때 **패자의 이긴 판 수가 0이면 20점**, 1이면 10점 (연속 여부를 따로 셀 필요 없음)
- [ ] `user_play_info` 업데이트 (total_game_count, total_win_count, today_*)
- [ ] `rank_daily`, `rank_weekly` 에 점수 누적 (테이블 자체는 Phase 2, 조회 화면은 Phase 8)
- [ ] `game_log_YYYY_MM` 에 로그 저장 — 시작/종료 시간, 승자, 패자, 최종 스코어(`"2:0"`/`"2:1"`), 각 판에서 낸 값(`plays`, 무승부 포함), 승자/패자의 봇 여부
  - 월별 테이블이므로 "이번 달 테이블이 없으면 만들기" 처리 필요
- [ ] DB 반영 **직후** 바뀐 유저 정보를 `SaveUserCache` 로 Redis 에 저장 (write-through — 로비 복귀 시 사용)
- [ ] 게임방 메모리의 플레이어 정보도 새 값으로 갱신 (재게임할 때 사용)

### 5-4. 게임 종료 후 — 재게임 / 나가기
- [ ] 최종 결과 전송 후 양쪽에 "재게임 / 나가기" 선택 받기
- [ ] **5초 동안 선택하지 않으면 나가기로 처리**
- [ ] 선택 결과에 따른 처리

  | 유저 A | 유저 B | 처리 |
  |---|---|---|
  | 재게임 | 재게임 | 같은 방, 같은 상대로 새 게임 시작 (다시 `GAME_START` 부터) |
  | 재게임 | 나가기(또는 5초 무응답) | B → `RETURN_TO_LOBBY`. A 는 방에 남아 `WAITING_OPPONENT` 받고 **새 상대를 기다림** |
  | 나가기 | 나가기 | 둘 다 `RETURN_TO_LOBBY`, 방 정리 |

- [ ] 혼자 남은 방을 "기다리는 방"으로 Redis 에 등록 → Phase 4-3 매칭에서 로비 유저 1명을 넣어 줌
- [ ] 새 상대가 들어오면 `OPPONENT_JOINED` → 두 명 모두 `ROOM_ENTER_ACK` → `GAME_START` (처음 게임과 같은 흐름)
- [ ] 새 상대를 기다리는 시간에는 **제한을 두지 않는다** (상대가 올 때까지 방 유지)
- [ ] 기다리는 도중 유저가 **나가기**(`LEAVE_ROOM`)를 보내면 → `RETURN_TO_LOBBY` 로 로비 이동
  - 동시에 "기다리는 방" 목록에서 지우고 방 정리 (그 사이 이 방으로 좌석이 예약된 유저가 있으면 다른 방으로 다시 매칭)
- [ ] 기다리던 유저가 연결이 끊겨도 "기다리는 방" 목록에서 지우고 방 정리
- [ ] 로비로 보낼 때 `TouchUserCache` 로 Redis TTL 다시 설정

> ✅ **결정된 규칙**
> - 재게임/나가기 선택을 5초 동안 하지 않으면 **나가기로 처리**한다.
> - 새 상대를 기다리는 시간에는 **제한이 없다.**
> - 기다리는 도중 **나가기**를 고르면 로비로 이동한다.
>
> 💡 제한 시간이 없으므로 기다리는 방은 로비가 한산할 때 오래 남을 수 있습니다. Phase 7 Watcher 화면에서 "기다리는 방 개수"를 함께 보이게 해 두면 채널별 방 100개 한도를 넘지 않는지 확인하기 쉽습니다.

**완료 확인**
- [ ] 테스트 클라이언트 2개로 게임이 끝까지 진행된다. (2:0 이면 2판만에 끝남)
- [ ] 아무것도 안 내도 5초 뒤 자동 선택으로 진행된다.
- [ ] 둘 다 재게임을 고르면 같은 방에서 다시 시작된다.
- [ ] 한 명만 재게임을 고르면, 그 유저는 방에 남고 로비에서 새로 참여한 유저와 게임이 시작된다.
- [ ] 재게임/나가기를 5초 동안 안 고르면 로비로 돌아간다.
- [ ] 새 상대를 기다리는 도중 나가기를 누르면 로비로 돌아가고, 그 방은 더 이상 매칭에 쓰이지 않는다.
- [ ] DB 에 게임 로그와 전적이 저장되고, Redis 값도 같은 값으로 바뀐다.

---

## Phase 6 — 예외 처리 / 안정성

**목표:** "사람이 갑자기 나가는" 상황에서도 서버가 꼬이지 않게 만든다.

### 6-1. 게임 중 연결 끊김
- [ ] 끊기면 5초 동안 재접속 대기 (Colyseus `allowReconnection` 활용)
- [ ] 5초 안에 돌아오면 → 진행 중인 방에 그대로 복귀 (같은 sessionId 라서 `onJoin` 때 저장한 플레이어 정보를 그대로 사용)
- [ ] 5초 안에 못 돌아오면 → **봇**이 대신 플레이 (랜덤 선택)
- [ ] 봇이 플레이하는 도중에도 원래 유저가 재접속하면 → 방에 다시 들어와 **봇 대신 이어서 플레이**
  - 재접속은 "5초"가 아니라 **게임이 끝날 때까지** 받아 준다. 5초는 봇을 투입하는 시점일 뿐이다.
  - Colyseus 에서는 재접속 대기를 게임 종료 시점까지 열어 두고(예: `allowReconnection` 의 수동 모드), 5초 타이머는 따로 둔다 — 설치한 버전의 사용법 확인
- [ ] 봇이 플레이한 게임도 결과 저장 + 종료 처리 (점수는 원래 유저에게 그대로 반영, 봇이 대신한 유저에게는 재게임 없이 종료)

### 6-2. 공통 에러 처리
- [ ] `ERROR` 메시지 처리를 공통 모듈로 정리
- [ ] 로비 / 게임방 / 매칭 각 단계에서 끊겼을 때 "대기 목록", "게임 중 목록" 에서 확실히 지워지는지 점검
- [ ] 좌석 예약 후 입장하지 않은 경우(10초 만료)의 정리 동작 점검
- [ ] 게임 채널 프로세스가 죽었을 때 Redis 의 "기다리는 방" 목록에 남은 방이 매칭에 쓰이지 않도록 정리
- [ ] 서버 재시작 시 Redis 에 남은 오래된 정보(채널 상태 등) 정리

**완료 확인**
- [ ] 게임 중 한쪽 클라이언트를 강제 종료 → 5초 뒤 봇이 이어서 게임을 끝낸다.
- [ ] 5초 안에 다시 접속하면 게임이 이어진다.
- [ ] 봇이 플레이하는 중에 다시 접속하면 봇 대신 이어서 플레이하고, 결과 점수가 정상 반영된다.
- [ ] 끊긴 유저가 다시 로비에 접속할 때 `ALREADY_CONNECTED` 에 잘못 걸리지 않는다.

---

## Phase 7 — Watcher(관리자) 채널 (`WatcherManager.ts`)

**목표:** 모든 채널의 상태를 한곳에서 보고, 공지 메시지를 전체에 보낼 수 있게 한다.

- [ ] Watcher 채널 실행 (포트 6000)
- [ ] 관리자 페이지는 **Watcher 에 소켓으로 연결**한다 — 상태 조회와 공지 전송을 모두 이 소켓으로 주고받음
  - 관리자용 메시지 정의 (예: `ADMIN_LOGIN`, `CHANNEL_STATUS`(S→관리자), `SEND_NOTICE`(관리자→S)) → `CLAUDE.md` 메시지 표에 반영
  - 채널 상태는 주기적으로(예: 5초) 관리자 소켓에 밀어 준다
- [ ] 각 채널이 주기적으로 상태(접속자 수, 방 개수, **새 상대를 기다리는 방 개수**)를 Redis 에 기록 → Watcher 가 모아서 보여줌
- [ ] 공지 전파: 관리자 페이지 → (소켓) → Watcher → Redis Pub/Sub → 로비/게임 채널 → 클라이언트
  - 관리자가 입력하는 **즉시 전송** (예약 발송 없음), 대상은 **전체 채널(로비 + 게임)의 모든 유저**
  - 클라이언트에는 `NOTICE { message }` 로 전송
  - 각 로비/게임 프로세스는 기동 시 공지 채널을 구독(subscribe)하고, 받으면 자기 채널의 모든 룸에 broadcast
- [ ] 관리자 페이지 (Watcher 소켓에 붙는 간단한 웹 화면)
- [ ] 관리자 소켓도 다른 채널과 같이 **wss**(TLS)로 연결 — 인증서 경로는 `.env` 로 관리
- [ ] 관리자 인증 — 연결 직후 `ADMIN_LOGIN { id, password }` 검사, 제한 시간 안에 통과하지 못하거나 틀리면 연결 종료
  - **관리자 계정 정보는 `.env` 로만 관리, 코드/문서에 적지 않기**
  - 로그인 전에는 상태 조회·공지 전송 메시지를 모두 거부
  - Watcher 포트(6000)는 일반 유저에게 알려지지 않도록 외부 공개 범위 제한 검토 (방화벽 / IP 제한)

**완료 확인**
- [ ] 관리자 화면에서 채널별 접속자 수가 보인다.
- [ ] 공지를 보내면 로비와 게임방의 클라이언트 모두 받는다.

---

## Phase 8 — 랭킹

- [ ] "오늘" = 매일 **00:00:00 ~ 23:59:59** (서버 시간 KST 기준)
- [ ] `rank_daily` — 날짜별 점수 기록
- [ ] `rank_weekly` — 주 시작일(월요일 00:00:00, `date_start`) 기준으로 기록 → 매주 월요일 새 주차로 리셋
- [ ] 자정에 `today_game_count`, `today_win_count` 초기화 방법 결정 (스케줄러 또는 "날짜가 바뀌었으면 0 으로" 처리)
  - Redis 캐시에 남은 today_* 값도 같이 맞춰야 함에 주의
  - 23:59:59 에 시작해 00:00 이후에 끝난 게임은 **종료 시각 기준**으로 넣을지 확인 (start/end 중 하나로 통일)
- [ ] 로비에서 랭킹 조회 메시지 추가 (메시지 표에 반영)
  - **1~100위** 목록 + 조회한 유저 **본인의 순위와 점수** (100위 밖이어도 표시)
  - 본인 순위는 "내 점수보다 높은 사람 수 + 1" 로 계산할 수 있다. 조회가 잦으면 Redis Sorted Set(`ZREVRANGE`, `ZREVRANK`) 사용 검토
  - 100위 목록은 모든 유저에게 같으므로 짧게(예: 10초) 캐시해 DB 부하를 줄인다

**완료 확인**
- [ ] 랭킹 조회 시 100위까지 목록과 본인 순위가 함께 온다.
- [ ] 자정이 지나면 today_* 와 일간 랭킹이 새 날짜로 시작된다.

---

## Phase 9 — 부하 테스트 / 배포 준비

- [ ] 부하 테스트 스크립트 작성 (가짜 클라이언트 수백 개)
- [ ] 로비 채널당 300명, 게임 채널당 200명(방 100개) 동시 접속 확인
- [ ] 채널 이동 시 DB 조회 횟수 측정 → 하이브리드 방식으로 DB 부하가 줄었는지 확인
- [ ] 로그 정리 (에러는 반드시 남기고, 개인정보·통계 데이터는 외부로 노출하지 않기)
- [ ] 6개 채널을 한 번에 켜고 끄는 실행 방법 정리 (예: PM2)
- [ ] 운영 환경 TLS 인증서 준비 및 모든 채널 wss 접속 확인 (인증서 갱신 절차 포함)
- [ ] **무중단 게임 서비스** — 배포/재시작 중에도 진행 중인 게임이 끊기지 않게
  1. 재시작할 채널을 "닫는 중" 상태로 표시 (Redis) → 새 매칭/새 입장을 받지 않음
  2. 매칭은 나머지 게임 채널로 보냄, 기다리는 방도 새로 받지 않음
  3. 진행 중인 게임이 모두 끝나면 프로세스 종료 → 새 버전으로 재시작 → "열림" 상태로 복귀
  4. 로비 채널은 2개를 **하나씩** 재시작 (끊긴 클라이언트는 다른 로비로 재접속)
  - 게임 채널 3개도 하나씩 순서대로 진행 (한 번에 모두 닫으면 `NO_GAME_ROOM` 발생)
- [ ] `CLAUDE.md` 의 폴더 구조 / 메시지 표를 실제 코드와 맞게 최종 갱신

---

## 아직 정해야 할 것 (해당 Phase 시작 전에 결정)

정해지면 `CLAUDE.md` 에 기록하고 여기서 체크합니다.

**Phase 1~3 전**
- [x] 6개 채널의 포트 번호 → Watcher 6000 / 로비 6011·6012 / 게임 6021·6022·6023 (채널 번호는 1부터)
- [x] 클라이언트가 로비 주소를 어디서 받는지 → 클라이언트에 고정 (약속된 주소/포트)
- [x] 로비 접속 시 받는 값 → partner, mid, gender, phone
- [x] gender 허용 값 → `F` / `M`
- [x] phone 빈 값 → 허용 안 함
- [x] phone 형식 → 텍스트 최대 100자
- [x] 기존 유저가 다른 phone 을 보내면 → 갱신

**Phase 4 전**
- [x] 게임 채널 3개가 모두 찼을 때 → `NO_GAME_ROOM` 안내, 로비에 남음
- [x] 매칭 대기 취소 메시지 → 필요 (`CANCEL_MATCH`)

**Phase 2 스키마 ~ Phase 5 전**
- [x] 점수 계산 규칙 → 2:0 승리 20점, 2:1 승리 10점, 패자 0점
- [x] 봇이 대신한 게임의 점수 → 원래 유저에게 그대로 반영
- [x] 봇이 들어간 뒤 원래 유저 재접속 → 게임이 끝날 때까지 허용, 봇 대신 이어서 플레이
- [x] 게임 로그에 승자/패자의 봇 여부 기록
- [x] `game_log` 스코어 형식 → `"2:0"` / `"2:1"` score 컬럼 + 판별 기록 유지
- [x] 무승부 판 기록 → 개수 제한 없음, `plays` JSON 배열 컬럼에 모두 저장
- [x] `score_max` → 제거

**Phase 7~9 전**
- [x] "오늘"의 기준 → 매일 00:00:00 ~ 23:59:59 (KST)
- [x] 랭킹 노출 범위 → 1~100위 + 본인 순위
- [x] 게임 중 서버 재시작·배포 → 무중단 서비스 (Phase 9 절차)
- [x] 관리자 페이지 연결 / 공지 방식 → Watcher 에 소켓 연결, 공지도 그 소켓으로 전송
- [x] 관리자 소켓 인증 → wss + ID/PW 로그인 (`ADMIN_LOGIN`)
- [x] 공지 → 실시간 입력 즉시 전체 채널 전송, `NOTICE { message }`
- [x] 통신 방식 → 모든 통신 소켓, 모든 채널 wss

---

## 나중에 할 일 (로비 콘텐츠)

`CLAUDE.md` 에 "추후 추가 예정" 으로 적힌 기능들입니다. 게임이 안정된 뒤 진행합니다.

- [ ] 아이템 구매
- [ ] 충전
- [ ] 광고 보기
- [ ] 닉네임 설정 / 본인 인증 / 약관 동의 흐름 (새 유저 처리)
- [ ] **파트너사 토큰 검증** — 1차 구현은 `partner + mid` 만으로 접속하므로, 상용 오픈 전에 반드시 추가
  - `ENTER_LOBBY` 에 token 추가, 파트너사 서명(HMAC 등) 검증 → 실패 시 새 에러 코드
  - 파트너사와 토큰 형식 협의 필요

---

## 진행할 때 지킬 규칙 (CLAUDE.md 요약)

1. 매니저(Watcher / Lobby / Room)는 **직접 SQL 을 쓰지 않는다.** 반드시 `db/` 모듈을 거친다.
2. 비밀번호·계정 정보는 **`.env` 에만** 둔다.
3. 모든 기능에서 **"연결이 끊기면?"** 을 먼저 생각한다.
4. 서버가 연결을 끊을 때는 **항상 종료 코드**를 준다.
5. 유저 정보는 **바뀔 때 Redis 에 쓰고**, 떠날 때는 TTL 만 다시 설정한다.
6. 함수명은 CamelCase, 변수명은 snake_case, 주석은 한국어.
7. 새 메시지나 구조가 생기면 **`CLAUDE.md` 도 같이 고친다.**
