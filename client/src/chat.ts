import {register, sendMessage, waitForConnection} from './api';


const main = async () => {

        const registerResponse = await register();
        console.log("Register response: ", registerResponse.status)

        const content1 = "hey everyone"
        const content2 = "am i really anon?"

        let response = await sendMessage(content1);
        console.log("Message response (content1, epoch1): ", response)

        // Valid
        response = await sendMessage(content2);
        console.log("Message response (content2, epoch2): ", response)

};

waitForConnection().then(() => main())
