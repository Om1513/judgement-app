// Express application setup

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { playerService } from './services/player.service';
import { lobbyService } from './services/lobby.service';
import { validatePlayerName } from './utils/validateLobby';
import { isValidLobbyCode } from './utils/generateLobbyCode';

const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));
app.use(express.json());

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// =====================
// Player REST APIs
// =====================

/**
 * POST /players
 * Creates a new player
 */
app.post('/players', async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    const validation = validatePlayerName(name);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const player = await playerService.createPlayer({ name: validation.sanitized });

    res.status(201).json({
      id: player.id,
      name: player.name,
      createdAt: player.createdAt,
    });
  } catch (error) {
    console.error('Error creating player:', error);
    res.status(500).json({ error: 'Failed to create player' });
  }
});

/**
 * GET /players/:id
 * Gets a player by ID
 */
app.get('/players/:id', async (req: Request, res: Response) => {
  try {
    const player = await playerService.getPlayerById(String(req.params.id));

    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    res.json({
      id: player.id,
      name: player.name,
      createdAt: player.createdAt,
    });
  } catch (error) {
    console.error('Error fetching player:', error);
    res.status(500).json({ error: 'Failed to fetch player' });
  }
});

// =====================
// Lobby REST APIs
// =====================

/**
 * POST /lobbies/create
 * Creates a new lobby (primarily for debugging, use Socket.IO in production)
 */
app.post('/lobbies/create', async (req: Request, res: Response) => {
  try {
    const { hostPlayerId, hostName, settings } = req.body;

    if (!hostPlayerId || !hostName) {
      return res.status(400).json({ error: 'hostPlayerId and hostName are required' });
    }

    const lobby = await lobbyService.createLobby({
      hostPlayerId,
      hostName,
      settings,
    });

    res.status(201).json(lobby);
  } catch (error) {
    console.error('Error creating lobby:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to create lobby',
    });
  }
});

/**
 * POST /lobbies/join
 * Joins an existing lobby (primarily for debugging, use Socket.IO in production)
 */
app.post('/lobbies/join', async (req: Request, res: Response) => {
  try {
    const { code, playerId, playerName } = req.body;

    if (!code || !playerId || !playerName) {
      return res.status(400).json({ error: 'code, playerId, and playerName are required' });
    }

    const codeStr = String(code);
    if (!isValidLobbyCode(codeStr)) {
      return res.status(400).json({ error: 'Invalid lobby code format' });
    }

    const lobby = await lobbyService.joinLobby({
      code: codeStr.toUpperCase(),
      playerId,
      playerName,
    });

    res.json(lobby);
  } catch (error) {
    console.error('Error joining lobby:', error);

    const message = error instanceof Error ? error.message : 'Failed to join lobby';
    const status = message.includes('not found') ? 404 :
                   message.includes('full') ? 409 : 500;

    res.status(status).json({ error: message });
  }
});

/**
 * GET /lobbies/:code
 * Gets a lobby by code
 */
app.get('/lobbies/:code', async (req: Request, res: Response) => {
  try {
    const code = String(req.params.code).toUpperCase();

    if (!isValidLobbyCode(code)) {
      return res.status(400).json({ error: 'Invalid lobby code format' });
    }

    const lobby = await lobbyService.getLobbyByCode(code);

    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }

    res.json(lobby);
  } catch (error) {
    console.error('Error fetching lobby:', error);
    res.status(500).json({ error: 'Failed to fetch lobby' });
  }
});

/**
 * GET /lobbies/id/:id
 * Gets a lobby by ID
 */
app.get('/lobbies/id/:id', async (req: Request, res: Response) => {
  try {
    const lobby = await lobbyService.getLobbyById(String(req.params.id));

    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }

    res.json(lobby);
  } catch (error) {
    console.error('Error fetching lobby:', error);
    res.status(500).json({ error: 'Failed to fetch lobby' });
  }
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
