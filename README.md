# Anonymous proof of concept application for instant chat, created using RLN (Rate limiting nullifier)

### Description
Proof-of-concept application created for the [ETHOnline hackathon](https://online.ethglobal.com/). The project is simple messaging protocol that uses the [RLN](https://medium.com/privacy-scaling-explorations/rate-limiting-nullifier-a-spam-protection-mechanism-for-anonymous-environments-bbe4006a57d) construct via [libsemaphore](https://github.com/appliedzkp/libsemaphore). The circuits implementation can be found [here](https://github.com/appliedzkp/rln). The main goal is to show how to integrate RLN easily, and how to enable anonymity and spam protection on app level. The high barrier for entry/staking component is not implemented in this application, thus slashing is only applied by removing the member from the group. If we had staking, the slashing would include revoking the user's stake once their identity secret is revealed.

The app features client-server architecture, and is completely offchain.

The app is a monorepo which contains 2 packages: `server` and `client`. The chat protocol is implemented using the [SocketIO](https://socket.io/) library. 
The spam threshold is one message per epoch, and the epoch can be user specified (the default is the unix timestamp in the moment of sending the message).

##### Server
The server is implemented as a simple [express.js](https://expressjs.com/) which includes the [SocketIO](https://socket.io/) server as a communication protocol. 

The server stores the membership tree for the registered users, ban list and additional metadata needed for operation. It also verifies the proofs from the user sent messages, and slashes the user if they spam. If the sent messages are valid, the chat server broadcasts the received message to the other chat clients. If the messages are duplicates, they are just ignored. If the messages represent a spam, then the user is removed from the membership tree and they cannot send messages or re-register with the same `identityCommitment` again.

##### Client

In the client there are two scripts: `chat` and `chatMalicious`. Both are used for simulating a chat client, the `chat` is simpler one displaying simple message communication, while the `chatMalicious` tests more options such as sending duplicate messages, more messages than allowed per the spam threshold, double registration and registration after banning.

The users can send messages, but only after they register. 
The RLN construct allows for anonymous signaling, in our case anonymity is achieved by knowing that the user is part of the group but not being able to determine their identity. The signal is the message.


##### Chat protocol

The chat protocol can be specified by the following events:

```typescript

enum EventType {
  USER_REGISTERED = "userRegistered", // event emitted by the server to all the clients when new user registers successfully
  USER_SLASHED = "userSlashed", // event emitted by the server to the clients when a user is slashed
  REGISTER = "register", // event emitted by the clients to the server when they want to register
  MESSAGE = "message", // event emitted by the clients to the server when sending a new message
  RECEIVE_MESSAGE = "receiveMessage", // event emitted by the server to the clients to broadcast a valid client message
  GET_WITNESS = "getWitness", // event emitted by the clients when they need to obtain a new witness (when new user is register or user is slashed)
  RECEIVE_WITNESS = "receiveWitness" // event emitted by the server when the client requests a new witness (sent only to the connection that requests it)
}

enum MessageVerificationStatus {
  DUPLICATE = "duplicate", // the message is duplicate, it should be ignored and not further broadcasted
  SPAM = "spam", // the message is considered as spam, the user should be slashed
  INVALID = "invalid", // the proof is invalid
  VALID = "valid" // message is not duplicate, the proof is valid and it is not considered as spam
}

enum UserRegistrationStatus {
  ALREADY_REGISTERED = "alreadyRegistered", // user is already registered
  BANNED = "banned", // user is banned and cannot register
  VALID = "valid" // user registration is valid
}
```



### Installation & startup

1. First clone this repository
2. Install the dependencies by running: `yarn`
3. Build the packages: `yarn build`
4. Start the server (terminal 1): `yarn server`
5. Start simple chat (terminal 2): `yarn chat`
6. Start simple chat (terminal 3): `yarn chatMalicious`
7. Observe the logs in terminal 2 and terminal 3.

### Tutorial

The following is a high level tutorial on how the app works, please follow the code provided in the `client` and `server` packages for more clarity. Please note that this is a PoC and a work-in-progress, the code might get updated in the future.

#### The server

On the server we store everything that is needed for the chat protocol and spam prevention, that is the Membership merkle tree for user registrations, received messages mapping per epoch and user nullifier - which is needed to prevent duplicate messages per epoch, ie. the same message sent multiple times per epoch (note: the messages for the epochs that have passed can be removed), as well as the ban list for the already banned users - so that they cannot register again.


The users need to register first. For that we've provided the `register` function. Users register by providing their `identityCommitment` which they generate from the `client`. We insert the user's `identityCommitment` in the membership tree (`tree`), and that is how we perform the user registration. We return the `leafIndex` (the index in the membership tree) and the `witness` (proof of membership) to the user. These two fields will be needed for the clients, so that they can generate valid proof when sending messages.


```typescript
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
```


After successful registration, the users can send messages. The users can send messages by emitting the `MESSAGE` event to the server. The message sent by the clients to the server must be in the following format:

```typescript
interface Message {
  proof: string; // user generated proof
  nullifier: string; // the user's nullifier, according to the RLN protocol
  content: string; // unencrypted message content
  epoch: string; // enrypted epoch
  rlnIdentifier: string; // the app specific RLN identifier, received on user registration
  yShare: string; // only the yShare needs to be sended, the xShare is the hash of the content, so we don't need to send that
}
```

On the server we validate the message in the following way:

```typescript
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
```

In order for the users to generate valid proofs, they need to have an up-to-date proof of their membership in the membership tree (witness). The users need to update their witness on new user registration and user removal. They can do so by emitting the `WITNESS` event to the server, upon which the server executes the following code:

```typescript
    const getWitness = (leafIndex: number) => {
      return tree.genMerklePath(leafIndex);
    };
```

#### The client

In order to be able to use the chat app (sending messages, anyone can receive the messages), the clients need to create an identity and register to the application with the identity. User identity consists of public identity hash generated from their `secretHash`, called `identityCommitment`. The users perform the registration with the `identityCommitment`. 

```typescript

    const identity: ZkIdentity = new ZkIdentity();
    identity.genSecretFromIdentity();
    const secretHash: BigInt = poseidonHash(identity.getSecret());
    const identityCommitment: bigint = identity.genIdentityCommitment();

    // Register to the chat app
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

```

After the users have registered, they can now send messages. To be able to send messages, they first need to generate a zero-knowledge proof, to be able to prove that they can actually send messages and that their message is valid without revealing their identity.
The inputs for proof generation are:
-  the proof of their membership in the member tree (which is stored on the server)
-  the epoch
-  the message content (the signal) 
-  the rln identifier, an app specific identifier received upon user registration
-  the user's `secretHash` used to generate the `identityCommitment` hash


The users can generate the proof and send a message in the following way:

```typescript

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
```

