import { SuiGrpcClient } from "@mysten/sui/grpc";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { GrpcTransport } from "@protobuf-ts/grpc-transport";
import { ChannelCredentials } from "@grpc/grpc-js";
import { env } from "./env";

// shared chain constants
export const CLOCK = "0x6";
export const DUSDC_UNIT = 1_000_000; // dusdc has 6 decimals
export const SUI_UNIT = 1_000_000_000; // sui has 9 decimals

// json-rpc client for tx building, coins, balances
export function createJsonRpc(): SuiJsonRpcClient {
    return new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl("testnet"), network: "testnet" });
}

// native gRPC, keepalive keeps long streams alive
export function createGrpc(): SuiGrpcClient {
    const transport = new GrpcTransport({
        host: env.grpcHost,
        channelCredentials: ChannelCredentials.createSsl(),
        clientOptions: {
            "grpc.keepalive_time_ms": 20_000,
            "grpc.keepalive_timeout_ms": 10_000,
            "grpc.keepalive_permit_without_calls": 1,
        },
    });
    return new SuiGrpcClient({ network: "testnet", transport });
}
