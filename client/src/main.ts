import { io } from "socket.io-client";
import * as path from 'path';
import * as fs from 'fs';
import {
    RLN,
    Identity
} from "semaphore-lib";

import {EventType, Message} from "./types"

import {deserializeWitness} from "./utils"

RLN.setHasher('poseidon');
const identity: Identity = RLN.genIdentity();
const identityCommitment: BigInt = RLN.genIdentityCommitment(identity.keypair.privKey);

const PROVER_KEY_PATH: string = path.join('./circuitFiles', 'rln_final.zkey');
const CIRCUIT_PATH: string = path.join('./circuitFiles', 'rln.wasm');

const state = {
    "index": 0,
    "witness": {},
    "isRegistered": false
}


// init socketio
const socket = io("ws://localhost:3000");

// client-side
socket.on("connected", () => {

    if(!state.isRegistered) {
        socket.emit(EventType.REGISTER, identityCommitment.toString(), async (response) => {


            if(response.status === 'success') {
                console.log("user registered successfully!");


                state.isRegistered = true;
                state.index = response.leafIndex;
                state.witness = deserializeWitness(response.witness);

                const epoch = RLN.genExternalNullifier(Date.now().toString());
                const content = "hello!"
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


                socket.emit(EventType.MESSAGE, message, async (msgResponse) => {
                    console.log("message response...", msgResponse)
                })

            }

        })

    }

});

socket.on(EventType.USER_REGISTERED, () => {
    console.log("new user registered")
    if(state.isRegistered) {
        getWitness();
    }
});


socket.on(EventType.USER_SLASHED, () => {
    console.log("user was slashed")
    if(state.isRegistered) {
        getWitness();
    }
});

socket.on(EventType.RECEIVE_MESSAGE, (message) => {

    console.log("new message received:", message)

});

const getWitness = () => {
    if(state.isRegistered) {

        socket.emit(EventType.GET_WITNESS, state.index, async (response) => {
            if(response.status === 'success') {
                console.log("witness obtained successfully!");
                state.witness = deserializeWitness(response.witness);
            }
        });

    }
}