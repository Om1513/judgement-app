// Main server entry point

import 'dotenv/config';
import { createServer } from 'http';
import app from './app';
import { connectDB, disconnectDB } from './db/connection';
import { initializeSocket } from './socket';

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

    // Create HTTP server
    const httpServer = createServer(app);

    // Initialize Socket.IO
    initializeSocket(httpServer);

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

main();
