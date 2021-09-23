import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import { EventType, Message, MessageVerificationStatus } from "./types";
import {
  init,
  register,
  removeUser,
  registerValidMessage,
  getWitness,
  verifyMessage,
} from "./rln";
import { serializeWitness, deserializeWitness } from "./utils";

// init express and SocketIO
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// init RLN
init();

const onError = (callback, error) => {
  callback({
    status: "fail",
    reason: error.statusText,
  });
};

app.get("/", (req, res) => {
  res.send("<h1>Hello world</h1>");
});

io.on("connection", (socket: Socket) => {
  socket.emit("connected");

  socket.on(EventType.REGISTER, (identityCommitment: string, callback) => {
    try {
      const identity = BigInt(identityCommitment);
      const leafIndex = register(identity);
      const witness = getWitness(leafIndex);

      socket.broadcast.emit(EventType.USER_REGISTERED);

      callback({
        status: "success",
        leafIndex,
        witness: serializeWitness(witness),
      });
    } catch (e: any) {
      onError(callback, e);
    }
  });

  socket.on(EventType.GET_WITNESS, (leafIndex: number, callback) => {
    try {
      const witness = getWitness(leafIndex);
      callback({
        status: "success",
        witness: serializeWitness(witness),
      });
    } catch (e: any) {
      onError(callback, e);
    }
  });

  socket.on(EventType.MESSAGE, async (message: Message, callback) => {
    try {
      const verificationStatus: MessageVerificationStatus = await verifyMessage(
        message
      );

      if (verificationStatus === MessageVerificationStatus.INVALID) {
        callback({
          status: "fail",
          reason: "Invalid proof",
        });
      } else if (verificationStatus === MessageVerificationStatus.DUPLICATE) {
        callback({
          status: "fail",
          reason: "Invalid message",
        });
      } else if (verificationStatus === MessageVerificationStatus.SPAM) {
        removeUser(message);
        io.emit(EventType.USER_SLASHED);
        callback({
          status: "fail",
          reason: "You've been slashed",
        });
      } else {
        registerValidMessage(message);
        socket.broadcast.emit(EventType.RECEIVE_MESSAGE, message.content);

        callback({
          status: "success",
        });
      }
    } catch (e: any) {
      onError(callback, e);
    }
  });

  socket.on("disconnect", (reason) => {
    console.log("user disconnected:", reason);
  });
});

server.listen(3000, () => {
  console.log("listening on *:3000");
});
