import * as path from "path";
import * as fs from "fs";

import { ZkIdentity } from "@libsem/identity";
import {
  genSignalHash,
  genExternalNullifier,
  Rln,
  FullProof,
} from "@libsem/protocols";
import {
  Message,
  MessageVerificationStatus,
  ReceivedMessages,
  UserRegistrationStatus,
  UserRegisterResponse,
} from "./types";
import poseidonHash from "./hasher";
const Tree = require("incrementalquintree/build/IncrementalQuinTree");

const VERIFIER_KEY_PATH = path.join("./circuitFiles", "verification_key.json");
const verifierKey = JSON.parse(fs.readFileSync(VERIFIER_KEY_PATH, "utf-8"));

let tree: any = null;
// RLN app specific identifier
let rlnIdentifier: BigInt = BigInt(0);

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

  tree = new Tree.IncrementalQuinTree(
    depth,
    zeroValue,
    leavesPerNode,
    poseidonHash
  );
  rlnIdentifier = Rln.genIdentifier();
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
    response.rlnIdentifier = rlnIdentifier.toString();
  }

  return response;
};

const removeUser = (message: Message) => {
  const nullifierString: string = message.nullifier.toString();
  const prevPkeyShares = receivedMessages[message.epoch][nullifierString];
  const xShare = genSignalHash(message.content);
  const yShare = BigInt(message.yShare);

  const xSharePrev = BigInt(prevPkeyShares.xShare);
  const ySharePrev = BigInt(prevPkeyShares.yShare);

  const pKey = Rln.retrieveSecret(xSharePrev, xShare, ySharePrev, yShare);

  const identityCommitment = poseidonHash([pKey]); // generate identity commitment from private key

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

  const xShare = genSignalHash(message.content).toString();
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
    userMessage.xShare === genSignalHash(message.content).toString() &&
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

  const proof: FullProof = {
    proof: message.proof,
    publicSignals: [
      BigInt(message.yShare),
      tree.root,
      BigInt(message.nullifier),
      genSignalHash(message.content),
      message.epoch,
      BigInt(message.rlnIdentifier),
    ],
  };

  const status = await Rln.verifyProof(verifierKey, proof);

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
