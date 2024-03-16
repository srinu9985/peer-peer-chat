const express = require('express');
const app = express();

const httpolyglot = require('httpolyglot');
const fs = require('fs');
const path = require('path');
// const __dirname = path.resolve();
const currentDir = path.resolve();

// const peer = require('socket.io')(server);

const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const { getSupportedRtpCapabilities } = require('mediasoup');

app.get('/', (req, res) => {
  res.send('Hello from mediasoup app!');
});

app.use('/sfu', express.static(path.join(currentDir, 'public')));

// SSL cert for HTTPS access
const options = {
  key: fs.readFileSync('./sever/ssl/key.pem', 'utf-8'),
  cert: fs.readFileSync('./sever/ssl/cert.pem', 'utf-8')
};

const httpsServer = httpolyglot.createServer(options, app);
httpsServer.listen(3000, () => {
  console.log('listening on port: ' + 3000);
});

const io = new Server(httpsServer);

// socket.io namespace (could represent a room?)
const peers = io.of('/mediasoup');

/**
 * Worker
 * |-> Router(s)
 *     |-> Producer Transport(s)
 *         |-> Producer
 *     |-> Consumer Transport(s)
 *         |-> Consumer 
 **/
let worker;
let router;
let producerTransport;
let consumerTransport;
let producer;
let consumer;
let consumer_ids=[];
let producerIds = [];

const createWorker = async () => {
  worker = await mediasoup.createWorker({
    rtcMinPort: 2000,
    rtcMaxPort: 2020,
  });
  console.log(`worker pid ${worker.pid}`);

  worker.on('died', error => {
    // This implies something serious happened, so kill the application
    console.error('mediasoup worker has died');
    setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
  });

  return worker;
};

// We create a Worker as soon as our application starts
worker = createWorker();

// This is an Array of RtpCapabilities
// https://mediasoup.org/documentation/v3/mediasoup/rtp-parameters-and-capabilities/#RtpCodecCapability
// list of media codecs supported by mediasoup ...
// https://github.com/versatica/mediasoup/blob/v3/src/supportedRtpCapabilities.ts
const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000,
    },
  },
];

peers.on('connection', async socket => {
  console.log('produer id',socket.id);
  socket.emit('connection-success', {
    socketId: socket.id,
    existsProducer: producer ? true : false,
  });
  // Add consumer socket ID to the list
  
  consumer_ids.push(socket.id);
  console.log('consumer id',socket.id);

  
  // socket.on('publishStream', () => {
  //   console.log("calling started from prodducer")
  //   // Emit an event to the consumer client to start the stream
  //   io.of('/consumer').emit('startStream');
  // })

  socket.on('publishStream', (callback) => {
    // Assuming some logic here to determine if publishing is successful

    let publishingIsSuccessful=true;
    
    if (publishingIsSuccessful) {
      // Emit success response to the client
      callback('success');
    } else {
      // Emit failure response to the client
      callback('failure');
    }
    // io.of('/socket_io').emit('Stream');
    // Function to send a message to all consumer sockets
    const sendAlertToConsumers = (message) => {
      consumer_ids.forEach(id => {
        io.of('/mediasoup').to(id).emit('alert', message);
      });
    };

    // Example usage of sendAlertToConsumers function
    sendAlertToConsumers('click ok to consuming the video...');
  });

  socket.on('disconnect', () => {
    // do some cleanup
    // Remove consumer socket ID from the list when disconnected
    consumer_ids = consumer_ids.filter(id => id !== socket.id);
    console.log('peer disconnected');
  });

  socket.on('createRoom', async (callback) => {
    if (router === undefined) {
      // worker.createRouter(options)
      // options = { mediaCodecs, appData }
      // mediaCodecs -> defined above
      // appData -> custom application data - we are not supplying any
      // none of the two are required
      router = await worker.createRouter({ mediaCodecs, });
      console.log(`Router ID: ${router.id}`);
    }

    getRtpCapabilities(callback);
  });

  const getRtpCapabilities = (callback) => {
    const rtpCapabilities = router.rtpCapabilities;

    callback({ rtpCapabilities });
  };

  // Client emits a request to create server side Transport
  // We need to differentiate between the producer and consumer transports
  socket.on('createWebRtcTransport', async ({ sender }, callback) => {
    console.log(`Is this a sender request? ${sender}`);
    // The client indicates if it is a producer or a consumer
    // if sender is true, indicates a producer else a consumer
    if (sender)
      producerTransport = await createWebRtcTransport(callback);
    else
      consumerTransport = await createWebRtcTransport(callback);
  });

  // see client's socket.emit('transport-connect', ...)
  socket.on('transport-connect', async ({ dtlsParameters }) => {
    console.log('DTLS PARAMS... ', { dtlsParameters });
    await producerTransport.connect({ dtlsParameters });
  });

  // see client's socket.emit('transport-produce', ...)
  socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
    // call produce based on the prameters from the client
    producer = await producerTransport.produce({
      kind,
      rtpParameters,
    });

    console.log('Producer ID: ', producer.id, producer.kind);

    producer.on('transportclose', () => {
      console.log('transport for this producer closed ');
      producer.close();
    });

    // Send back to the client the Producer's id
    callback({
      id: producer.id
    });
  });

  // see client's socket.emit('transport-recv-connect', ...)
  socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
    console.log(`DTLS PARAMS: ${dtlsParameters}`);
    await consumerTransport.connect({ dtlsParameters });
  });

  socket.on('consume',async ({ rtpCapabilities }, callback) => {
    try {
      // check if the router can consume the specified producer
      if (router.canConsume({
        producerId: producer.id,
        rtpCapabilities
      })) {
        // transport can now consume and return a consumer
        consumer = await consumerTransport.consume({
          producerId: producer.id,
          rtpCapabilities,
          paused: true,
        });

        consumer.on('transportclose', () => {
          console.log('transport close from consumer');
        });

        consumer.on('producerclose', () => {
          console.log('producer of consumer closed');
        });

        // from the consumer extract the following params
        // to send back to the Client
        const params = {
          id: consumer.id,
          producerId: producer.id,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        };

        // send the parameters to the client
        callback({ params });
      }
    } catch (error) {
      console.log(error.message);
      callback({
        params: {
          error: error
        }
      });
    }
  });

  socket.on('consumer-resume', async () => {
    console.log('consumer resume');
    await consumer.resume();
  });
});

const createWebRtcTransport = async (callback) => {
    try {
      // Define WebRTC transport options
      const webRtcTransport_options = {
        listenIps: [
          {
            ip: '0.0.0.0', // replace with relevant IP address
            announcedIp: '127.0.0.1',
          },
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      };
  
      // Create the WebRTC transport
      const transport = await router.createWebRtcTransport(webRtcTransport_options);
      console.log(`transport id: ${transport.id}`);
  
      // Event listeners for the transport
      transport.on('dtlsstatechange', dtlsState => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });
  
      transport.on('close', () => {
        console.log('transport closed');
      });
  
      // Retrieve DTLS parameters, ICE candidates, and ICE parameters
      const { iceParameters, iceCandidates, dtlsParameters } = transport;
  
      // Send transport parameters back to the client
      callback({
        params: {
          id: transport.id,
          iceParameters,
          iceCandidates,
          dtlsParameters,
        },
      });
  
      return transport;
    } catch (error) {
      console.error(error);
      callback({
        params: {
          error: error.message,
        },
      });
    }
  };
// Function to send a message to all consumer sockets
// const sendAlertToConsumers = (message) => {
//   consumer_ids.forEach(id => {
//     io.of('/mediasoup').to(id).emit('alert', message);
//   });
// };

// // Example usage of sendAlertToConsumers function
// sendAlertToConsumers('click ok to consuming the video...');
