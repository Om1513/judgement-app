// REST API service for React Native

import { SERVER_URL } from '../config';

/**
 * Makes an API request.
 */
async function request(endpoint, options = {}) {
  const url = `${SERVER_URL}${endpoint}`;

  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  };

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body);
  }

  const response = await fetch(url, config);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// =====================
// Player APIs
// =====================

/**
 * Creates a new player.
 */
export async function createPlayer(name) {
  return request('/players', {
    method: 'POST',
    body: { name },
  });
}

/**
 * Gets a player by ID.
 */
export async function getPlayer(playerId) {
  return request(`/players/${playerId}`);
}

// =====================
// Lobby APIs
// =====================

/**
 * Gets a lobby by code.
 */
export async function getLobbyByCode(code) {
  return request(`/lobbies/${code.toUpperCase()}`);
}

/**
 * Gets a lobby by ID.
 */
export async function getLobbyById(lobbyId) {
  return request(`/lobbies/id/${lobbyId}`);
}

/**
 * Creates a new lobby (for debugging).
 */
export async function createLobby(hostPlayerId, hostName, settings = {}) {
  return request('/lobbies/create', {
    method: 'POST',
    body: { hostPlayerId, hostName, settings },
  });
}

/**
 * Joins a lobby (for debugging).
 */
export async function joinLobby(code, playerId, playerName) {
  return request('/lobbies/join', {
    method: 'POST',
    body: { code, playerId, playerName },
  });
}

// =====================
// Health Check
// =====================

/**
 * Checks if the server is healthy.
 */
export async function healthCheck() {
  return request('/health');
}

export default {
  createPlayer,
  getPlayer,
  getLobbyByCode,
  getLobbyById,
  createLobby,
  joinLobby,
  healthCheck,
};
