import * as path from "path";
import * as fs from "fs";

import { RLN, IProof } from "semaphore-lib";
import {
  Message,
  MessageVerificationStatus,
  ReceivedMessages,
  UserRegistrationStatus,
  UserRegisterResponse,
} from "./types";

const VERIFIER_KEY_PATH = path.join("./circuitFiles", "verification_key.json");
const verifierKey = JSON.parse(fs.readFileSync(VERIFIER_KEY_PATH, "utf-8"));

let tree: any = null;

// Array that keeps the identity commitment of banned users
const bannedUsers: BigInt[] = [];

// Received messages mapping, needed for slashing
const receivedMessages: ReceivedMessages = {};

// Identity commitment to leaf index mapping, needed for obtaining the index in the tree, for user removal when slashing
const identityToLeafIndexMapping: Record<string, number> = {};

const init = () => {
  const depth = 15;
  const leavesPerNode = 2;
  const zeroValue = 0;

  RLN.setHasher("poseidon");
  tree = RLN.createTree(depth, zeroValue, leavesPerNode);
};

const register = (identityCommitment: BigInt): UserRegisterResponse => {
  const response: UserRegisterResponse = {
    status: UserRegistrationStatus.VALID,
  };

  if (tree.leaves.includes(identityCommitment)) {
    response.status = UserRegistrationStatus.ALREADY_REGISTERED;
  } else if (bannedUsers.includes(identityCommitment)) {
    response.status = UserRegistrationStatus.BANNED;
  } else {
    tree.insert(identityCommitment);

    const leafIndex = tree.nextIndex - 1;
    identityToLeafIndexMapping[identityCommitment.toString()] = leafIndex;

    response.leafIndex = leafIndex;
  }

  return response;
};

const removeUser = (message: Message) => {
  const nullifierString: string = message.nullifier.toString();
  const prevPkeyShares = receivedMessages[message.epoch][nullifierString];
  const xShare = RLN.genSignalHash(message.content);
  const yShare = BigInt(message.yShare);

  const xSharePrev = BigInt(prevPkeyShares.xShare);
  const ySharePrev = BigInt(prevPkeyShares.yShare);

  const pKey = RLN.retrievePrivateKey(xSharePrev, xShare, ySharePrev, yShare);

  const identityCommitment = RLN.genIdentityCommitment(pKey as Buffer); // generate identity commitment from private key

  const leafIndex = identityToLeafIndexMapping[identityCommitment.toString()];

  // mark the user as banned
  bannedUsers.push(identityCommitment);

  // remove the user from the tree
  tree.update(leafIndex, BigInt(0));
};

const registerValidMessage = (message: Message) => {
  // add entry for the epoch if no such entry exists
  if (!receivedMessages[message.epoch]) {
    receivedMessages[message.epoch] = {};
  }

  const xShare = RLN.genSignalHash(message.content).toString();
  const yShare = message.yShare;

  receivedMessages[message.epoch][message.nullifier] = {
    xShare,
    yShare,
  };
};

const getWitness = (leafIndex: number) => {
  return tree.genMerklePath(leafIndex);
};

const isDuplicate = (message: Message): boolean => {
  const userMessage = receivedMessages[message.epoch]?.[message.nullifier];

  return (
    userMessage &&
    userMessage.xShare === RLN.genSignalHash(message.content).toString() &&
    userMessage.yShare === message.yShare
  );
};

const isSpam = (message: Message): boolean => {
  /**
   * Function called after the duplicate message check and proof verification.
   * We just need to check if there exist a message that the user sent in the same epoch, if yes then we can
   * consider this as a spam, because the message was not duplicate and also the proof was valid.
   */

  const userMessage = receivedMessages[message.epoch]?.[message.nullifier];
  return userMessage && true;
};

const verifyMessage = async (
  message: Message
): Promise<MessageVerificationStatus> => {
  if (isDuplicate(message)) return MessageVerificationStatus.DUPLICATE;

  const proof: IProof = {
    proof: message.proof,
    publicSignals: [
      BigInt(message.yShare),
      tree.root,
      BigInt(message.nullifier),
      RLN.genSignalHash(message.content),
      message.epoch,
    ],
  };

  const status = await RLN.verifyProof(verifierKey, proof);

  if (!status) {
    return MessageVerificationStatus.INVALID;
  }

  if (isSpam(message)) {
    return MessageVerificationStatus.SPAM;
  }

  return MessageVerificationStatus.VALID;
};

export {
  init,
  register,
  getWitness,
  verifyMessage,
  removeUser,
  registerValidMessage,
};
