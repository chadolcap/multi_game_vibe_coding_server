// PM2 로 6개 채널(Watcher 1 + 로비 2 + 게임 3)을 한 번에 켜고 끄기 위한 설정 (TASKS.md Phase 9).
// package.json 이 "type": "module" 이라, PM2 설정 파일은 Node 가 ESM 으로 해석하지 않도록 .cjs
// 확장자(CommonJS)로 둔다 — PM2 자체도 설정 파일을 require() 로 읽는다.
//
// 사용법 (이 디렉터리 — server/ — 에서 실행):
//   npm run build                                          코드가 바뀔 때마다 먼저 한 번
//   npx pm2 start ecosystem.config.cjs                      전체 6개 채널 시작 (운영 규모)
//   npx pm2 start ecosystem.config.cjs --only watcher,lobby_1,game_1   지금처럼 1채널씩만 켜고 싶을 때
//     (CLAUDE.md "로컬 실행 방법" 참고 — 지금은 개발 단계라 로비/게임 1채널씩만 운영)
//   npx pm2 stop ecosystem.config.cjs                        전체 정지 (SIGINT 전송 → graceful shutdown)
//   npx pm2 restart ecosystem.config.cjs                     전체 재시작
//   npx pm2 delete ecosystem.config.cjs                      PM2 관리 목록에서 제거
//   npx pm2 logs                                             전체 로그 스트리밍
//   npx pm2 status                                           채널별 상태(켜짐/재시작 횟수 등) 확인
// 채널 하나만 다루고 싶으면 이름을 지정한다: npx pm2 restart game_1 / npx pm2 logs lobby_2
//
// ⚠️ game_2/game_3 를 실제로 쓰려면 src/common/constants.ts 의 GAME_CHANNEL_COUNT 를 먼저 3 으로
// 올리고 재빌드해야 한다(지금은 개발 단계라 1 로 막아 둠). lobby_2 는 코드 제한이 없어 지금도 바로 켤
// 수 있다. (CLAUDE.md "로컬 실행 방법" / "규모 스펙" 참고)
//
// kill_timeout: Colyseus 는 SIGINT/SIGTERM 을 받으면 자체적으로 graceful shutdown 을 시도하는데,
// PM2 기본 kill_timeout(1.6초)으로는 그 전에 SIGKILL 로 강제 종료될 수 있어 넉넉하게 늘려 둔다.
// "채널 단위로 새 입장을 막고 진행 중인 게임이 끝난 뒤 재시작"하는 무중단 로직(TASKS.md Phase 9)이
// 아직 없어서 당장은 안전 마진 성격의 값이다 — 그 로직이 들어가면 실제 게임 한 판 최대 소요 시간을
// 기준으로 다시 맞출 것.
const KILL_TIMEOUT_MS = 60_000;

function Channel(name, channel_type, channel_no) {
    return {
        name,
        script: "dist/index.js",
        args: [channel_type, String(channel_no)],
        cwd: __dirname,
        autorestart: true,
        kill_timeout: KILL_TIMEOUT_MS,
    };
}

module.exports = {
    apps: [
        Channel("watcher", "watcher", 1),
        Channel("lobby_1", "lobby", 1),
        Channel("lobby_2", "lobby", 2),
        Channel("game_1", "game", 1),
        Channel("game_2", "game", 2),
        Channel("game_3", "game", 3),
    ],
};
