import "dotenv/config";
import { createRedis } from "./lib/redis";
import { createJsonRpc } from "./lib/sui";
import { SUI_TYPE_ARG } from "@mysten/sui/utils";
import { USDC } from "./lib/config";
import { listUserIds, getUser } from "./services/user";
import { getLedger } from "./lib/ledger";

const redis = createRedis();
const rpc = createJsonRpc();

const ids = await listUserIds(redis);
console.log("users:", ids.length);

const total = async (owner: string, t: string) =>
    (await rpc.getCoins({ owner, coinType: t })).data.reduce((s, c) => s + Number(c.balance), 0);

for (const id of ids) {
    const u = await getUser(redis, id);
    if (!u) continue;
    const usdc = await total(u.address, USDC);
    const sui = await total(u.address, SUI_TYPE_ARG);
    const l = await getLedger(redis, id);
    const seen = await redis.keys(`deposited:${id}:*`);
    console.log(
        `${id}\n  proxy ${u.address}\n  onchain: USDC=${usdc / 1e6} SUI=${sui / 1e9}` +
            `\n  ledger.balance=${l.balance / 1e6}  depositedKeys=${seen.length}`,
    );
}

await redis.quit();
