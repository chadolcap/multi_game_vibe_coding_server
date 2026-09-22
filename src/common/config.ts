// .env 로딩 및 설정 값
// - 접속 정보/계정/인증서 경로는 반드시 .env 로만 관리한다. (코드에 하드코딩 금지)
// - .env 가 없으면 기본값으로 동작한다. (개발용 기본값만 둔다. 비밀번호 기본값은 두지 않는다)

// Node 22+ 내장 기능으로 .env 를 읽는다 (dotenv 패키지 불필요)
try {
    process.loadEnvFile();
} catch {
    // .env 파일이 없으면 환경 변수만 사용한다
}

function ReadString(key: string, default_value: string): string {
    const value = process.env[key];
    return value === undefined || value === "" ? default_value : value;
}

function ReadNumber(key: string, default_value: number): number {
    const value = process.env[key];
    if (value === undefined || value === "") return default_value;

    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new Error(`[config] ${key} 는 정수여야 합니다: ${value}`);
    }
    return parsed;
}

function ReadNumberList(key: string, default_value: number[]): number[] {
    const value = process.env[key];
    if (value === undefined || value === "") return default_value;

    return value.split(",").map((item) => {
        const parsed = Number(item.trim());
        if (!Number.isInteger(parsed)) {
            throw new Error(`[config] ${key} 는 쉼표로 구분한 정수 목록이어야 합니다: ${value}`);
        }
        return parsed;
    });
}

function ReadBoolean(key: string, default_value: boolean): boolean {
    const value = process.env[key];
    if (value === undefined || value === "") return default_value;
    return value.toLowerCase() === "true";
}

export const config = {
    // 채널별 포트 (CLAUDE.md 규모 스펙)
    watcher_port: ReadNumber("WATCHER_PORT", 6000),
    lobby_ports: ReadNumberList("LOBBY_PORTS", [6011, 6012]),
    game_ports: ReadNumberList("GAME_PORTS", [6021, 6022, 6023]),

    // wss(TLS) — 운영 환경은 반드시 true. 개발 환경에서만 false(ws) 로 켠다
    use_tls: ReadBoolean("USE_TLS", false),
    tls_cert_path: ReadString("TLS_CERT_PATH", ""),
    tls_key_path: ReadString("TLS_KEY_PATH", ""),

    // Redis
    redis_host: ReadString("REDIS_HOST", "127.0.0.1"),
    redis_port: ReadNumber("REDIS_PORT", 6780),

    // MySQL — 계정/비밀번호는 기본값을 두지 않는다 (.env 필수)
    db_host: ReadString("DB_HOST", "127.0.0.1"),
    db_port: ReadNumber("DB_PORT", 3306),
    db_user: ReadString("DB_USER", ""),
    db_password: ReadString("DB_PASSWORD", ""),
    db_name: ReadString("DB_NAME", ""),
} as const;
