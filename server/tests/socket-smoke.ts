import { io } from "socket.io-client";
import { env } from "../lib/env";

// manual smoke: connect and print discovery + details events
const socket = io(`http://localhost:${env.port}`);

socket.on("connect", () => console.log("connected:", socket.id));

socket.on("markets:snapshot", snap => {
    const counts = Object.fromEntries(Object.entries(snap).map(([k, v]: any) => [k, v.length]));
    console.log("markets:snapshot", counts);

    // request details for the first market
    const first = (Object.values(snap)[0] as any[])?.[0];
    if (first) {
        socket.emit("market:details:get", first.oracleId, (d: any) =>
            console.log("details ack", d?.oracleId, "spot", d?.price?.spot),
        );
    }
});

socket.on("market:new", m => console.log("market:new", m.underlying, m.oracleId));
socket.on("market:settled", m => console.log("market:settled", m.underlying, m.oracleId));
socket.on("market:details", d => console.log("market:details", d.oracleId, "spot", d.price?.spot));

setTimeout(() => process.exit(0), 60000);
