// in-memory redis stub: kv + sets + lists + hashes, with NX flag support for set
export function fakeRedis() {
    const kv = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    const lists = new Map<string, string[]>();
    const hashes = new Map<string, Map<string, string>>();
    return {
        async hset(key: string, field: string, val: string) {
            const h = hashes.get(key) ?? new Map<string, string>();
            const isNew = !h.has(field);
            h.set(field, String(val));
            hashes.set(key, h);
            return isNew ? 1 : 0;
        },
        async hget(key: string, field: string) {
            return hashes.get(key)?.get(field) ?? null;
        },
        async hgetall(key: string) {
            return Object.fromEntries(hashes.get(key) ?? []);
        },
        async publish(_channel: string, _msg: string) {
            return 0; // no subscribers in tests
        },
        async lpush(key: string, ...vals: string[]) {
            const l = lists.get(key) ?? [];
            l.unshift(...vals);
            lists.set(key, l);
            return l.length;
        },
        async ltrim(key: string, start: number, stop: number) {
            const l = lists.get(key);
            if (l) lists.set(key, l.slice(start, stop === -1 ? undefined : stop + 1));
            return "OK";
        },
        async lrange(key: string, start: number, stop: number) {
            const l = lists.get(key) ?? [];
            return l.slice(start, stop === -1 ? undefined : stop + 1);
        },
        async get(k: string) {
            return kv.has(k) ? kv.get(k)! : null;
        },
        async set(k: string, v: string, ...flags: any[]) {
            if (flags.includes("NX") && kv.has(k)) return null;
            kv.set(k, String(v));
            return "OK";
        },
        async incrbyfloat(k: string, delta: number | string) {
            const v = Number(kv.get(k) ?? 0) + Number(delta);
            kv.set(k, String(v));
            return String(v);
        },
        async incrby(k: string, delta: number | string) {
            const v = Number(kv.get(k) ?? 0) + Number(delta);
            kv.set(k, String(v));
            return v;
        },
        async del(...ks: string[]) {
            let n = 0;
            for (const k of ks) if (kv.delete(k)) n++;
            return n;
        },
        async sadd(key: string, ...members: string[]) {
            const s = sets.get(key) ?? new Set<string>();
            members.forEach(m => s.add(m));
            sets.set(key, s);
            return members.length;
        },
        async smembers(key: string) {
            return [...(sets.get(key) ?? [])];
        },
        async srem(key: string, ...members: string[]) {
            const s = sets.get(key);
            if (!s) return 0;
            let n = 0;
            members.forEach(m => {
                if (s.delete(m)) n++;
            });
            return n;
        },
    } as any;
}
