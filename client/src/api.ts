import { io, Socket } from "socket.io-client";
import * as path from 'path';
import {ZkIdentity} from "@libsem/identity"
import {genSignalHash, genExternalNullifier, Rln, FullProof} from "@libsem/protocols"
import poseidonHash from "./hasher";

import {EventType, Message, MessageVerificationStatus, UserRegisterResponse, UserRegistrationStatus} from "./types"

import {deserializeWitness} from "./utils"

const identity: ZkIdentity = new ZkIdentity();
identity.genSecretFromIdentity();
const secretHash: BigInt = poseidonHash(identity.getSecret());
const identityCommitment: bigint = identity.genIdentityCommitment();

const PROVER_KEY_PATH: string = path.join('./circuitFiles', 'rln_final.zkey');
const CIRCUIT_PATH: string = path.join('./circuitFiles', 'rln.wasm');

const state = {
    "connected": false,
    "index": 0,
    "witness": {},
    "rlnIdentifier": BigInt(0),
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

    epoch = genExternalNullifier(epoch);

    const xShare: bigint = genSignalHash(content);
    const [y, nullifier] = Rln.calculateOutput(secretHash, BigInt(epoch), state.rlnIdentifier, xShare)

    const witness: FullProof = Rln.genWitness(secretHash, state.witness, epoch, content, state.rlnIdentifier)
    const fullProof: FullProof = await Rln.genProof(witness, CIRCUIT_PATH, PROVER_KEY_PATH)


    const message: Message = {
        proof: fullProof.proof,
        nullifier: nullifier.toString(),
        content,
        epoch,
        yShare: y.toString(),
        rlnIdentifier: state.rlnIdentifier.toString()
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
                    state.rlnIdentifier = BigInt(response.rlnIdentifier);
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