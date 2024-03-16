
const io = require('socket.io-client');
const mediasoupClient = require('mediasoup-client');

const socket = io("/mediasoup");
// console.log("ssssss",socket);
// const socket_io=io("/consumer");

let device;
let rtpCapabilities;
let consumerTransport;
let consumer;

// Function to create the consumer
const createConsumer = async () => {

    try {
        if (!rtpCapabilities) {
            console.error("No RTP capabilities available. Cannot create consumer.");
            getRtpCapabilities();
        }

        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });

        consumerTransport = await createWebRtcTransport(false);

        socket.emit('consume', { rtpCapabilities: device.rtpCapabilities }, async ({ params }) => {
            console.log("Consume Response:", params);
            if (params.error) {
                console.log("Cannot Consume:", params.error);
                return;
            }

            consumer = await consumerTransport.consume({
                id: params.id,
                producerId: params.producerId,
                kind: params.kind,
                rtpParameters: params.rtpParameters
            });

            const { track } = consumer;
            remoteVideo.srcObject = new MediaStream([track]);

            socket.emit('consumer-resume');
        });

        console.log("Consumer created successfully");
    } catch (error) {
        console.error("Error creating consumer:", error);
    }
};

// Function to create WebRTC transport
const createWebRtcTransport = async (sender) => {
    try {
        const { params } = await createTransport(sender);
        const transport = device.createRecvTransport(params);

        transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                await socket.emit('transport-recv-connect', { dtlsParameters });
                console.log(params);
                callback();
            } catch (error) {
                errback(error);
            }
        });

        return transport;
    } catch (error) {
        console.error("Error creating WebRTC transport:", error);
        throw error;
    }
};

// Function to create transport
const createTransport = async (sender) => {
    try {
        return new Promise((resolve, reject) => {
            socket.emit('createWebRtcTransport', { sender }, ({ params }) => {
                if (params.error) {
                    reject(params.error);
                } else {
                    resolve({ params });
                }
            });
        });
    } catch (error) {
        console.error("Error creating transport:", error);
        throw error;
    }
};

// Function to get RTP capabilities
const getRtpCapabilities = () => {
    socket.emit('createRoom', ({ rtpCapabilities }) => {
        console.log("Router RTP Capabilities:", rtpCapabilities);
        setRtpCapabilities(rtpCapabilities);
    });
};

// Function to set RTP capabilities
const setRtpCapabilities = (caps) => {
    rtpCapabilities = caps;
};

// Add event listener to handle 'alert' event from server
socket.on('alert', (message) => {
    // Display a confirm dialog with the message
    if (confirm(message)) {
        // If user clicks OK, call createConsumer
        createConsumer();
    } else {
        // Handle cancellation
        console.log("User canceled video consumption.");
         
    }
});


// Function to initialize consumer
const initConsumer = () => {
    socket.on('connection-success', ({ socketId, existsProducer }) => {
        console.log("Connected to server");
        console.log(socketId, existsProducer);
        getRtpCapabilities();
    });
    // socket.emit('publishStream', (result) => {
    //     // // Display an alert box when the server signals that the producer has published the stream
    //     // if (confirm("The producer has published the stream. Do you want to start consuming?")) {
    //     //     // User clicked OK, start consuming the video
    //     //     createConsumer();
    //     // } else {
    //     //     // User clicked Cancel, handle accordingly
    //     //     console.log("User canceled video consumption.");
    //     //     // Handle cancellation
    //     // }
    //     if (result === 'success') {
    //         alert('Stream is consuming');
            
    //         createConsumer();
    //         // Now, wait for the server to notify the consumer page to start the stream
    //     } else {
    //         console.error('Failed to publish stream.'); // Handle failure
    //     }
    // });

    // Add event listener to handle 'alert' event from server
    // socket.on('alert', (message) => {
    //     alert(message);
    //     if(message){
    //         createConsumer();
    //     }
     
    // });

    socket.on('disconnect', () => {
        console.log("Disconnected from server");
    });
};
initConsumer();

// Add event listener for the "Consume" button
// const btnConsume = document.getElementById('btnRecvSendTransport');
// btnConsume.addEventListener('click', () => {
//     // Call function to start consuming stream
//     createConsumer();
//  });



