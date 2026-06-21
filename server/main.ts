import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import { env } from "./lib/env";
import { createRedis } from "./lib/redis";
import { createGrpc, createJsonRpc } from "./lib/sui";
import { createRoutes } from "./routes/index";
import { createAuthRoutes } from "./routes/auth";
import { createAccountRoutes } from "./routes/account";
import { createBetRoutes } from "./routes/bet";
import { createPoolRoutes } from "./routes/pool";
import { createLeaderboardRoutes } from "./routes/leaderboard";
import { backfillTotals } from "./lib/txlog";
import { listUserIds } from "./services/user";
import { setupSockets } from "./events/index";
import { DiscoveryService } from "./services/discovery";
import { MarketDetailsService } from "./services/market-details";
import { CandlesService } from "./services/candles";
import { SurfaceService } from "./services/surface";
import { CustodyService } from "./services/custody";
import { TreasuryService } from "./services/treasury";
import { BetEngine } from "./services/engine";
import { SettlementService } from "./services/settlement";
import { LiquidationService } from "./services/liquidation";
import { LeverageMeterService } from "./services/leverage-meter";
import { PoolService } from "./services/pool";
import { DepositWatcher } from "./services/deposits";
import { ReconcileService } from "./services/reconcile";

async function main() {
    const redis = createRedis();
    const sub = createRedis();
    const grpc = createGrpc();
    const rpc = createJsonRpc();

    const details = new MarketDetailsService(redis);
    const candles = new CandlesService(redis);
    const surface = new SurfaceService(redis);
    const custody = new CustodyService(redis, rpc);
    const treasury = env.adminSecretKey ? new TreasuryService(redis, rpc) : null;
    const engine = treasury ? new BetEngine(redis, rpc, treasury) : null;

    // seed lifetime deposit/withdraw totals once, before any new credits
    await backfillTotals(redis, await listUserIds(redis));

    const app = express();
    app.use(cors());
    app.use(express.json());
    app.use(createRoutes(redis, details, candles, surface));
    app.use(createAuthRoutes(redis));
    app.use(createAccountRoutes(redis, custody, treasury, rpc));
    app.use(createBetRoutes(redis, engine));
    app.use(createPoolRoutes(redis, !!treasury));
    app.use(createLeaderboardRoutes(redis));

    const http = createServer(app);
    const io = new Server(http, { cors: { origin: "*" } });
    setupSockets(io, redis, sub, details, engine);

    const discovery = new DiscoveryService(grpc, redis);
    await discovery.start();
    await details.start();
    await candles.start();

    // money + bet system need the platform treasury wallet
    if (treasury && engine) {
        await treasury.ensurePlatformManager();
        await new PoolService(redis, treasury).start(); // seed the LP pool from the reserve first
        await new DepositWatcher(redis, rpc).start();
        await new SettlementService(redis, treasury, engine, details).start();
        await new LiquidationService(redis, engine).start();
        await new LeverageMeterService(redis).start();
        await new ReconcileService(redis, treasury).start();
    } else {
        console.log("ADMIN_SECRET_KEY not set, money + bet system disabled");
    }

    http.listen(env.port, () => console.log(`server on :${env.port}`));
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
