// Real Socket.IO server + real clients, for the socket integration tests.
//
// Nothing here is mocked: it boots the same express app and the same
// initializeSocket() the production server boots, on an ephemeral port, and
// connects genuine socket.io-client instances to it. Assertions are therefore
// about what a phone would actually receive.
//
// Every wait is event-driven with an explicit timeout - there are no
// "sleep and hope" delays, which is what makes socket tests flaky.

import { createServer, Server as HTTPServer } from 'http';
import { AddressInfo } from 'net';
import { io as createClient, Socket as ClientSocket } from 'socket.io-client';

import app from '../../app';
import { initializeSocket } from '../../socket';

export interface Harness {
  url: string;
  close(): Promise<void>;
}

/** Boots the server on a free port. */
export async function startTestServer(): Promise<Harness> {
  const httpServer: HTTPServer = createServer(app);
  const io = initializeSocket(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    async close() {
      await io.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

export interface TestClient {
  socket: ClientSocket;
  playerId: string;
  name: string;
  /** Events received since connect, in order. Used to assert on duplicates. */
  received: { event: string; payload: unknown }[];
  disconnect(): void;
}

/** Every server-to-client event, so a client can record all of them. */
const OBSERVED_EVENTS = [
  'connected',
  'error',
  'session:restore',
  'lobby:created',
  'lobby:joined',
  'lobby:update',
  'lobby:error',
  'lobby:kicked',
  'lobby:player-joined',
  'lobby:player-left',
  'game:started',
  'game:update',
  'game:error',
  'game:trick-completed',
  'game:round-complete',
  'game:over',
  'game:completed',
  'hand:winner-announced',
  'hand:next-started',
  'game:final-winner',
  'game:final-scoreboard',
  'scoreboard:state',
  'scoreboard:player-continued',
  'scoreboard:all-continued',
  'round:bidding-started',
];

/**
 * Connects a client and identifies it, resolving once the server has issued a
 * player id.
 */
export async function connectClient(
  url: string,
  name: string,
  clientId = `test-${name}-${Math.random().toString(36).slice(2)}`
): Promise<TestClient> {
  const socket = createClient(url, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });

  const received: { event: string; payload: unknown }[] = [];
  for (const event of OBSERVED_EVENTS) {
    socket.on(event, (payload: unknown) => received.push({ event, payload }));
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} never connected`)), 5000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  const ack = await waitFor<{ playerId: string }>(socket, 'connected', () =>
    socket.emit('player:connect', { name, clientId })
  );

  return {
    socket,
    playerId: ack.playerId,
    name,
    received,
    disconnect: () => socket.disconnect(),
  };
}

/**
 * Waits for the next `event` on `socket`, optionally triggering an action once
 * the listener is attached so there is no window in which the event can be
 * missed.
 */
export function waitFor<T>(
  socket: ClientSocket,
  event: string,
  trigger?: () => void,
  timeoutMs = 8000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${event}"`));
    }, timeoutMs);

    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
    trigger?.();
  });
}

/**
 * Waits for an event that satisfies `predicate`, ignoring earlier ones. Needed
 * where the server emits several updates in a row and the test cares about a
 * particular one (e.g. "the update where it is finally my turn").
 */
export function waitForMatching<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean,
  trigger?: () => void,
  timeoutMs = 8000
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for a matching "${event}"`));
    }, timeoutMs);

    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
    trigger?.();
  });
}

/** Counts how many times an event has been received by a client so far. */
export function countReceived(client: TestClient, event: string): number {
  return client.received.filter((r) => r.event === event).length;
}

/** Lets pending server-side broadcasts settle, without asserting on timing. */
export function flush(ms = 60): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
