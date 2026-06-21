# events

The live updates layer. This is the Socket.IO setup and the Redis fan-out that pushes
changes to the web app in real time.

## How it works

- `index.ts` wires Socket.IO to Redis pub/sub. When a socket connects, it can authenticate
  with a session token and join its own user room. It handles the bet quote, subscribe,
  place, and close messages, and answers market detail requests.

The flow is simple. A service (the engine, settlement, the pool) publishes an event to a
Redis channel using the helpers in `../lib/bus.ts`. This file listens on that channel and
forwards each event to the right place: a market room for odds and book updates, a user room
for fills, balances, and closes, or a broadcast for pool updates. Running the fan-out through
Redis means many server instances could share one socket layer later.
