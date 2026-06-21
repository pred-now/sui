import "dotenv/config";

// throw if a required var is missing
function required(name: string): string {
    const v = process.env[name];
    if (!v) throw new Error(`missing env: ${name}`);
    return v;
}

// undefined if missing, gates optional auth methods
function optional(name: string): string | undefined {
    return process.env[name] || undefined;
}

export const env = {
    grpcHost: required("GRPC_HOST"),
    predictPackage: required("PREDICT_PACKAGE"),
    predictId: required("PREDICT_ID"),
    predictServerUrl: required("PREDICT_SERVER_URL"),
    redisUrl: required("REDIS_URL"),
    port: Number(required("PORT")),

    // auth, each method gated by its own keys
    sessionSecret: optional("SESSION_SECRET"),
    googleClientId: optional("GOOGLE_CLIENT_ID"),
    twitchClientId: optional("TWITCH_CLIENT_ID"),
    privyAppId: optional("PRIVY_APP_ID"),
    privyAppSecret: optional("PRIVY_APP_SECRET"),

    // enoki sponsors proxy gas, server api key
    enokiApiKey: optional("ENOKI_API_KEY"),

    // platform treasury, holds the DUSDC reserve and the single manager
    adminSecretKey: optional("ADMIN_SECRET_KEY"),
    platformManagerId: optional("PLATFORM_MANAGER_ID"),

    // LP pool: DeepBook Margin yield is mainnet only (testnet uses mock DUSDC, no Margin pool)
    marginEnabled: process.env.LP_MARGIN_ENABLED === "true",

    // pyth, off-chain price for SUI deposits
    pythHermesUrl: process.env.PYTH_HERMES_URL || "https://hermes.pyth.network",
    suiUsdFeedId:
        process.env.SUI_USD_FEED_ID ||
        "0x23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744",
};
