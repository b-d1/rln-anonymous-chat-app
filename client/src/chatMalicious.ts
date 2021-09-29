import {register, sendMessage, waitForConnection} from './api';

const main = async () => {

        let registerResponse = await register();

        console.log("Malicious Register response (attempt1): ", registerResponse.status)

        registerResponse = await register();

        console.log("Malicious Register response (attempt2): ", registerResponse.status)

        const epoch = Date.now().toString();
        const content1 = "hello!"
        const content2 = "hey!"

        let response = await sendMessage(content1, epoch);
        console.log("Malicious Message response (attempt1, content1, epoch1): ", response);

        // Duplicate
        response = await sendMessage(content1, epoch);
        console.log("Malicious Message response (attempt2, content1, epoch1): ", response);

        // Valid
        response = await sendMessage(content2);
        console.log("Malicious Message response (attempt1, content2, epoch2): ", response);

        // Spam, two messages per the same epoch
        response = await sendMessage(content2, epoch);
        console.log("Malicious Message response (attempt2, content2, epoch1): ", response);

        // The user is banned, cannot register
        registerResponse = await register();
        console.log("Malicious Register (attempt3): ", registerResponse.status);


        // Invalid, the user is banned
        response = await sendMessage(content2);
        console.log("Malicious Message response (attempt1, content2, epoch3): ", response);

};


waitForConnection().then(() => main())
