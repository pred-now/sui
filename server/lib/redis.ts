import Redis from "ioredis";
import { env } from "./env";

// new connection each call, subscribers need their own
export function createRedis(): Redis {
    return new Redis(env.redisUrl);
}
