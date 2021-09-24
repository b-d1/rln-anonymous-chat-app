import express from "express";
import http from "http";
import { Server, Socket } from "socket.io";
import {
  EventType,
  Message,
  MessageVerificationStatus,
  UserRegistrationStatus,
  UserRegisterResponse,
} from "./types";
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

app.get("/", (req, res) => {
  res.send("<h1>Hello world</h1>");
});

const onError = (callback, error) => {
  callback({
    status: "error",
    reason: error.statusText,
  });
};

io.on("connection", (socket: Socket) => {
  socket.emit("connected");

  socket.on(EventType.REGISTER, (identityCommitment: string, callback) => {
    try {
      const identity = BigInt(identityCommitment);

      const response: UserRegisterResponse = register(identity);

      if (response.status !== UserRegistrationStatus.VALID) {
        callback({ status: response.status });
      } else {
        response.witness = getWitness(response.leafIndex as number);
        response.witness = serializeWitness(response.witness);

        socket.broadcast.emit(EventType.USER_REGISTERED);

        callback(response);
      }
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

      callback({
        status: verificationStatus,
      });

      if (verificationStatus === MessageVerificationStatus.VALID) {
        registerValidMessage(message);
        socket.broadcast.emit(EventType.RECEIVE_MESSAGE, message.content);
      } else if (verificationStatus === MessageVerificationStatus.SPAM) {
        removeUser(message);
        socket.broadcast.emit(EventType.USER_SLASHED);
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
  console.log("Server running on port: 3000");
});
