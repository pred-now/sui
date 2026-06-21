import type Redis from "ioredis";
import { EVENTS_CHANNEL } from "./market";

// publish a socket event through the redis fan-out. room targets a socket.io room.
export function publish(redis: Redis, type: string, data: unknown, room?: string): Promise<number> {
    return redis.publish(EVENTS_CHANNEL, JSON.stringify({ type, data, room }));
}

export const userRoom = (userId: string) => `user:${userId}`;
export const marketRoom = (oracleId: string, strike: number) => `mkt:${oracleId}:${strike}`;
