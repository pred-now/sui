// dummy env so modules that read env load under tests (no network used)
process.env.WALLET_MASTER_KEY ??= "0".repeat(64);
process.env.SESSION_SECRET ??= "0".repeat(64);
process.env.GRPC_HOST ??= "fullnode.testnet.sui.io:443";
process.env.PREDICT_PACKAGE ??= "0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138";
process.env.PREDICT_ID ??= "0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a";
process.env.PREDICT_SERVER_URL ??= "https://predict-server.testnet.mystenlabs.com";
process.env.DUSDC ??= "0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.PORT ??= "4000";
