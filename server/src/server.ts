// Main server entry point

import 'dotenv/config';
import { createServer } from 'http';
import app from './app';
import { connectDB, disconnectDB, getDB } from './db/connection';
import { initializeSocket } from './socket';
import { lobbyReconnectService } from './services/lobbyReconnect.service';
import { gameReconnectService } from './services/gameReconnect.service';

const PORT = process.env.PORT || 3001;

// Keep the server alive on unexpected async errors instead of letting Node
// terminate the process (which would "stop the application" for all players).
// These log the real cause so it can be diagnosed without a hard crash.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server kept alive):', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception (server kept alive):', error);
});

async function main(): Promise<void> {
  try {
    // Connect to database
    await connectDB();

    // Keep the database connection warm. Managed Postgres (Supabase, Neon and
    // similar) idles out pooled connections, and the first query afterwards
    // pays a reconnect penalty that shows up as laggy game actions. A cheap
    // periodic ping keeps it live. unref() so it never blocks process exit.
    const KEEPALIVE_MS = 4 * 60 * 1000;
    const dbKeepAlive = setInterval(() => {
      getDB().$queryRaw`SELECT 1`.catch((err) => {
        console.error('DB keep-alive ping failed:', err);
      });
    }, KEEPALIVE_MS);
    dbKeepAlive.unref();

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize Socket.IO
    initializeSocket(httpServer);

    // Lobby seats held open for a reconnecting player have their deadline in the
    // database, not just in a setTimeout, so a restart can pick the countdown
    // back up instead of holding those seats forever. Deadlines that already
    // passed while the process was down are settled immediately.
    await lobbyReconnectService.recoverPendingGracePeriods();

    // The same for seats in a live game: their bot-takeover deadline is
    // persisted too, so a restart cannot leave a table waiting indefinitely on a
    // seat nobody is driving. Deadlines that already passed are handed to the bot
    // at once.
    await gameReconnectService.recoverPendingTakeovers();

    // Start server
    httpServer.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════╗
║                                                   ║
║   🃏 Kachuful Game Server Running                 ║
║                                                   ║
║   HTTP Server: http://localhost:${PORT}             ║
║   WebSocket:   ws://localhost:${PORT}               ║
║                                                   ║
║   Environment: ${process.env.NODE_ENV || 'development'}                     ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
      `);
    });

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      console.log(`\nReceived ${signal}. Shutting down gracefully...`);

      // Pending grace periods are persisted, so dropping their in-memory timers
      // loses nothing - the next boot resumes them from reconnectDeadline.
      lobbyReconnectService.cancelAll();
      gameReconnectService.cancelAll();

      httpServer.close(async () => {
        console.log('HTTP server closed');
        await disconnectDB();
        process.exit(0);
      });

      // Force exit after 10 seconds
      setTimeout(() => {
        console.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Fire-and-forget bootstrap: main() installs its own error handling and exits
// the process on failure, so there is nothing further to await here.
void main();
