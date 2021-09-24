import { io, Socket } from "socket.io-client";
import * as path from 'path';
import * as fs from 'fs';
import {
    RLN,
    Identity
} from "semaphore-lib";

import {EventType, Message, MessageVerificationStatus, UserRegisterResponse, UserRegistrationStatus} from "./types"

import {deserializeWitness} from "./utils"

RLN.setHasher('poseidon');
const identity: Identity = RLN.genIdentity();
const identityCommitment: BigInt = RLN.genIdentityCommitment(identity.keypair.privKey);

const PROVER_KEY_PATH: string = path.join('./circuitFiles', 'rln_final.zkey');
const CIRCUIT_PATH: string = path.join('./circuitFiles', 'rln.wasm');

const state = {
    "connected": false,
    "index": 0,
    "witness": {},
    "isRegistered": false
}

// init socket, connect to server

const socket = io("ws://localhost:3000");


const waitForConnection = (): Promise<boolean> => {
    return new Promise((resolve) => {
        socket.on('connect', () => {
            state.connected = true;
            resolve(true);
        });
    })
}

socket.on("connect", async () => {
    state.connected = true;
});


socket.on(EventType.USER_REGISTERED, () => {
    console.log("New user registered!")
    if(state.isRegistered) {
        getWitness();
    }
});


socket.on(EventType.USER_SLASHED, () => {
    console.log("User was slashed!")
    if(state.isRegistered) {
        getWitness();
    }
});

socket.on(EventType.RECEIVE_MESSAGE, (message) => {
    console.log("New message received:", message)
});


const sendMessage = async (content: string, epoch: string = Date.now().toString()): Promise<MessageVerificationStatus> => {

    epoch = RLN.genExternalNullifier(epoch);
    const fullProof = await RLN.genProofFromBuiltTree(identity.keypair.privKey, state.witness, epoch, content, CIRCUIT_PATH, PROVER_KEY_PATH)

    const xShare: bigint = RLN.genSignalHash(content);

    const a1 = RLN.calculateA1(identity.keypair.privKey, epoch);
    const y = RLN.calculateY(a1, identity.keypair.privKey, xShare);
    const nullifier = RLN.genNullifier(a1);

    const message: Message = {
        proof: fullProof.proof,
        nullifier: nullifier.toString(),
        content,
        epoch,
        yShare: y.toString()
    }
    const res: MessageVerificationStatus = await new Promise((resolve, reject) => {

    socket.emit(EventType.MESSAGE, message, async (msgResponse) => {

        const status = msgResponse.status;
        if(status === 'error') {
            reject(msgResponse.reason)
        } else {
            resolve(status);
        }
    })
    });
    return res;
}


const register = async (): Promise<UserRegisterResponse> => {
    return await new Promise((resolve, reject) => {
        socket.emit(EventType.REGISTER, identityCommitment.toString(), async (response) => {

            if(response.status === 'error') {
                reject(response.reason)
            } else {

                if(response.status === UserRegistrationStatus.VALID) {
                    state.isRegistered = true;
                    state.index = response.leafIndex;
                    state.witness = deserializeWitness(response.witness);
                }
                resolve(response);
            }

        });
    })
}



const getWitness = () => {
        socket.emit(EventType.GET_WITNESS, state.index, async (response) => {
            if(response.status === 'success') {
                console.log("new witness obtained successfully");
                state.witness = deserializeWitness(response.witness);
            }
        });
}


export {
    register,
    sendMessage,
    waitForConnection
}