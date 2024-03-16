// producer.js
// import io from 'socket.io-client';
// import mediasoupClient from 'mediasoup-client';

// Import necessary modules
const io =require('socket.io-client');
const mediasoupClient = require('mediasoup-client');

// Connect to the server socket
const socket = io("/mediasoup");

// Event listener for successful connection
socket.on('connection-success', ({ socketId, existsProducer }) => {
  console.log(socketId, existsProducer);
});

// Declare variables for mediasoup client
let device;
let rtpCapabilities;
let producerTransport;
let producer;
let isProducer = true;

// Parameters for media encoding
let params = {
  encodings: [
    {
      rid: 'r0',
      maxBitrate: 100000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r1',
      maxBitrate: 300000,
      scalabilityMode: 'S1T3',
    },
    {
      rid: 'r2',
      maxBitrate: 900000,
      scalabilityMode: 'S1T3',
    },
  ],
  codecOptions: {
    videoGoogleStartBitrate: 1000
  }
};

let localStream; // Variable to store the local stream

const streamSuccess = (stream) => {
    localStream = stream; // Store the local stream
    localVideo.srcObject = stream;
    const track = stream.getVideoTracks()[0];
    params = {
        track,
        ...params
    };

    goConnect(true);
};

const getLocalStream = () => {
    navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
            width: {
                min: 640,
                max: 1920,
            },
            height: {
                min: 400,
                max: 1080,
            }
        }
    })
    .then(streamSuccess)
    .catch(error => {
        console.log(error.message);
    });
};

const stopLocalStream = () => {
    if (localStream) {
        localStream.getTracks().forEach(track => {
            track.stop(); // Stop each track in the local stream
        });
        localVideo.srcObject = null; // Clear the video element
    }
};

const goConsume = () => {
    goConnect(false);
};

const goConnect = (producerOrConsumer) => {
    isProducer = producerOrConsumer;
    device === undefined ? getRtpCapabilities() : goCreateTransport();
};

const goCreateTransport = () => {
    isProducer ? createSendTransport() : createRecvTransport();
};

// Add event listener for the "Cancel" button
const btnStopVideo = document.getElementById('btnStopVideo');
btnStopVideo.addEventListener('click', stopLocalStream);

// Function to create the mediasoup client device
const createDevice = async () => {
  try {
    device = new mediasoupClient.Device();
    await device.load({
      routerRtpCapabilities: rtpCapabilities
    });

    console.log('Device RTP Capabilities', device.rtpCapabilities);
    goCreateTransport();
  } catch (error) {
    console.log(error);
    if (error.name === 'UnsupportedError')
      console.warn('browser not supported');
  }
};

// Function to request Router RTP Capabilities from the server
const getRtpCapabilities = () => {
  socket.emit('createRoom', (data) => {
    console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
    rtpCapabilities = data.rtpCapabilities;
    createDevice();
  });
};

// Function to create the send transport for producing media
const createSendTransport = () => {
  socket.emit('createWebRtcTransport', { sender: true }, ({ params }) => {
    if (params.error) {
      console.log(params.error);
      return;
    }

    console.log(params);
    producerTransport = device.createSendTransport(params);

    producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await socket.emit('transport-connect', {
          dtlsParameters,
        });
        callback();
      } catch (error) {
        errback(error);
      }
    });

    producerTransport.on('produce', async (parameters, callback, errback) => {
      console.log(parameters);

      try {
        await socket.emit('transport-produce', {
          kind: parameters.kind,
          rtpParameters: parameters.rtpParameters,
          appData: parameters.appData,
        }, ({ id }) => {
          callback({ id });
        });
      } catch (error) {
        errback(error);
      }
    });

    connectSendTransport();
  });
};

// Function to connect the send transport
const connectSendTransport = async () => {
  producer = await producerTransport.produce(params);

  producer.on('trackended', () => {
    console.log('track ended');
  });

  producer.on('transportclose', () => {
    console.log('transport ended');
  });
};

// Get reference to the "Publish" button
const btnPublish = document.getElementById('btnLocalVideo');

// Add event listener for the "Publish" button
btnPublish.addEventListener('click', publishStream);

// Function to handle publishing the stream
function publishStream() {
  // Call getlocalstream function to acquire the local stream
  getLocalStream();
  // Emit an event to the server indicating that the "publish" action has occurred
  // Emit an event to the server indicating that the "publish" action has occurred
  socket.emit('publishStream', (response) => {
    // This function is called when the server responds to the 'publishStream' event
    if (response === 'success') {
      console.log('Stream publishing initiated...');
      // Now, wait for the server to notify the consumer page to start the stream
    } else {
      console.error('Failed to publish stream.'); // Handle failure
    }
  });
}
