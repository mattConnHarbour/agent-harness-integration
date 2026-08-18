import { Hocuspocus } from '@hocuspocus/server';
import Fastify from 'fastify';
import { WebSocketServer } from 'ws';

const app = Fastify();
const hocuspocus = new Hocuspocus({ quiet: true, stopOnSignals: false });
const websocketServer = new WebSocketServer({ noServer: true });

websocketServer.on('connection', (socket, request) => {
  socket.on('error', (error) => app.log.error(error));
  void hocuspocus.handleConnection(socket, request);
});

app.server.on('upgrade', (request, socket, head) => {
  void hocuspocus.hooks('onUpgrade', { request, socket, head, instance: hocuspocus })
    .then(() => {
      websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        websocketServer.emit('connection', websocket, request);
      });
    })
    .catch((error) => {
      app.log.error(error);
      socket.destroy();
    });
});

app.get('/', async () => ({ status: 'ok' }));
await app.listen({ host: '127.0.0.1', port: 1234 });

const stop = async () => {
  websocketServer.close();
  await hocuspocus.destroy();
  await app.close();
};

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
