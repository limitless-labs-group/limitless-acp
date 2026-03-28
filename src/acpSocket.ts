import { io, type Socket } from "socket.io-client";
import { SocketEvent, type AcpJobEventData } from "./acpTypes.js";
import { logger } from "./logger.js";

export interface AcpSocketCallbacks {
  onNewTask: (data: AcpJobEventData) => void;
  onEvaluate?: (data: AcpJobEventData) => void;
}

export interface AcpSocketOptions {
  acpUrl: string;
  walletAddress: string;
  callbacks: AcpSocketCallbacks;
}

export function connectAcpSocket(opts: AcpSocketOptions): () => void {
  const { acpUrl, walletAddress, callbacks } = opts;

  const socket: Socket = io(acpUrl, {
    auth: { walletAddress },
    transports: ["websocket"],
  });

  socket.on(
    SocketEvent.ROOM_JOINED,
    (_data: unknown, callback?: (ack: boolean) => void) => {
      logger.info("[acp] Joined ACP room");
      if (typeof callback === "function") callback(true);
    },
  );

  socket.on(
    SocketEvent.ON_NEW_TASK,
    (data: AcpJobEventData, callback?: (ack: boolean) => void) => {
      if (typeof callback === "function") callback(true);
      logger.info(
        `[acp] onNewTask  jobId=${data.id}  phase=${data.phase}`,
      );
      callbacks.onNewTask(data);
    },
  );

  socket.on(
    SocketEvent.ON_EVALUATE,
    (data: AcpJobEventData, callback?: (ack: boolean) => void) => {
      if (typeof callback === "function") callback(true);
      logger.info(`[acp] onEvaluate  jobId=${data.id}  phase=${data.phase}`);
      if (callbacks.onEvaluate) {
        callbacks.onEvaluate(data);
      }
    },
  );

  socket.on("connect", () => {
    logger.info("[acp] Connected to ACP");
  });

  socket.on("disconnect", (reason) => {
    logger.warn(`[acp] Disconnected: ${reason}`);
  });

  socket.on("connect_error", (err) => {
    logger.error(`[acp] Connection error: ${err.message}`);
  });

  const disconnect = () => {
    socket.disconnect();
  };

  process.on("SIGINT", () => {
    disconnect();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    disconnect();
    process.exit(0);
  });

  return disconnect;
}
