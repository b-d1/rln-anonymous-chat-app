enum EventType {
  USER_REGISTERED = "userRegistered", // event emitted by the server to all of the clients when new user registers successfully
  USER_SLASHED = "userSlashed", // event emitted by the server to the clients when user is slashed
  REGISTER = "register", // event emitted by the clients to the server when they want to register
  MESSAGE = "message", // event emitted by the clients to the server when sending a new message
  RECEIVE_MESSAGE = "receiveMessage", // event emitted by the server to the clients to broadcast an valid client message
  GET_WITNESS = "getWitness", // event emitted by the clients when they need to obtain a new witness (when new user is added or user is slashed)
  RECEIVE_WITNESS = "receiveWitness", // event emitted by the server when the a client requests a new witness (sent only to the connection that requests it)
}

enum MessageVerificationStatus {
  DUPLICATE = "duplicate", // the message is duplicate, it should be ignored and not further broadcasted
  SPAM = "spam", // the message is considered as spam, the user should be slashed
  INVALID = "invalid", // the proof is invalid
  VALID = "valid", // message is not duplicate, the proof is valid and it is not considered as spam
}

enum UserRegistrationStatus {
  ALREADY_REGISTERED = "alreadyRegistered", // user is already registered
  BANNED = "banned", // user is banned and cannot register
  VALID = "valid" // user registration is valid
}

type UserNullifier = BigInt | string;

interface PkeyShares {
  xShare: string;
  yShare: string;
}

interface MessagesPerEpoch {
  [nullifier: string]: PkeyShares;
}

interface ReceivedMessages {
  [epoch: string]: MessagesPerEpoch;
}

interface Message {
  proof: string;
  nullifier: string;
  content: string;
  epoch: string;
  yShare: string; // the xShare is the hash of the content, so we don't need to send that
}

// Upon successfull user registration we will send the registered user the witness and the leafIndex, to save on calls
interface UserRegisterResponse {
  status: UserRegistrationStatus;
  leafIndex?: number;
  witness?: object;
}

export {
  UserNullifier,
  Message,
  EventType,
  ReceivedMessages,
  MessageVerificationStatus,
  UserRegistrationStatus,
  UserRegisterResponse
};
