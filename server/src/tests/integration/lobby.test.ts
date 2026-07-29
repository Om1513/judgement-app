// Lobby lifecycle against a real database.
//
// Host creates -> players join -> seats assigned -> host kicks -> host leaves
// and the lobby is handed on. Every step goes through lobbyService, so what is
// asserted is the behaviour the socket handlers actually get.

import test, { describe, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

import { db, resetDatabase, closeDatabase } from '../helpers/db';
import { createLobbyWithPlayers } from '../helpers/gameFlow';
import { playerService } from '../../services/player.service';
import { lobbyService } from '../../services/lobby.service';
import { isValidLobbyCode } from '../../utils/generateLobbyCode';

before(async () => {
  await resetDatabase();
});

beforeEach(async () => {
  await resetDatabase();
});

after(async () => {
  await closeDatabase();
});

describe('creating a lobby', () => {
  test('generates a valid code and seats the host', async () => {
    const host = await playerService.createPlayer({ name: 'Host', clientId: 'c-host' });
    const lobby = await lobbyService.createLobby({
      hostPlayerId: host.id,
      hostName: host.name,
    });

    assert.equal(isValidLobbyCode(lobby.code), true, `"${lobby.code}" is not a valid code`);
    assert.equal(lobby.hostPlayerId, host.id);
    assert.equal(lobby.hostName, 'Host');
    assert.equal(lobby.status, 'WAITING');
    assert.equal(lobby.playerCount, 1);
    assert.equal(lobby.players[0].playerId, host.id);
    assert.equal(lobby.players[0].isHost, true);
    assert.equal(lobby.players[0].seatPosition, 0);
  });

  test('persists the row so it can be found by code', async () => {
    const { code, lobbyId } = await createLobbyWithPlayers(1);

    const stored = await db.lobby.findUnique({ where: { code } });
    assert.ok(stored, 'lobby row exists');
    assert.equal(stored.id, lobbyId);

    const fetched = await lobbyService.getLobbyByCode(code);
    assert.equal(fetched?.id, lobbyId);
  });

  test('applies the requested settings, filling in the rest from defaults', async () => {
    const { lobbyId } = await createLobbyWithPlayers(1, {
      rounds: 6,
      scoringMode: '+1',
      orderMode: 'Random',
    });

    const lobby = await lobbyService.getLobbyById(lobbyId);
    assert.deepEqual(lobby?.settings, {
      rounds: 6,
      orderMode: 'Random',
      scoringMode: '+1',
      maxPlayers: 8,
    });
  });

  test('rejects settings outside the allowed range', async () => {
    const host = await playerService.createPlayer({ name: 'Host', clientId: 'c-bad' });
    await assert.rejects(
      () =>
        lobbyService.createLobby({
          hostPlayerId: host.id,
          hostName: host.name,
          settings: { rounds: 99 },
        }),
      /Rounds must be between/
    );
  });

  test('two lobbies never share a code', async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const { code } = await createLobbyWithPlayers(1);
      assert.ok(!codes.has(code), `code ${code} was issued twice`);
      codes.add(code);
    }
  });
});

describe('players joining', () => {
  test('a second and third player join and appear in the list in seat order', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);

    const lobby = await lobbyService.getLobbyById(lobbyId);
    assert.equal(lobby?.playerCount, 3);
    assert.deepEqual(
      lobby?.players.map((p) => p.playerId),
      playerIds
    );
    assert.deepEqual(
      lobby?.players.map((p) => p.seatPosition),
      [0, 1, 2]
    );
    assert.deepEqual(
      lobby?.players.map((p) => p.isHost),
      [true, false, false]
    );
  });

  test('two players are enough to start; one is not', async () => {
    const one = await createLobbyWithPlayers(1);
    assert.equal((await lobbyService.getLobbyById(one.lobbyId))?.canStart, false);

    const two = await createLobbyWithPlayers(2);
    assert.equal((await lobbyService.getLobbyById(two.lobbyId))?.canStart, true);
  });

  test('joining a code that does not exist fails', async () => {
    const player = await playerService.createPlayer({ name: 'Late', clientId: 'c-late' });
    await assert.rejects(
      () =>
        lobbyService.joinLobby({ code: 'ZZZZZZ', playerId: player.id, playerName: 'Late' }),
      /Lobby not found/
    );
  });

  test('the same player cannot join twice', async () => {
    const { code, playerIds } = await createLobbyWithPlayers(2);
    await assert.rejects(
      () =>
        lobbyService.joinLobby({ code, playerId: playerIds[1], playerName: 'Player2' }),
      /Already in this lobby/
    );
  });

  test('a full lobby turns players away', async () => {
    const { code } = await createLobbyWithPlayers(2, { maxPlayers: 2 });
    const extra = await playerService.createPlayer({ name: 'Extra', clientId: 'c-extra' });

    await assert.rejects(
      () => lobbyService.joinLobby({ code, playerId: extra.id, playerName: 'Extra' }),
      /Lobby is full/
    );
  });

  test('a freed seat is reused rather than left as a gap', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(3);
    await lobbyService.kickPlayer(lobbyId, hostId, playerIds[1]);

    const newcomer = await playerService.createPlayer({ name: 'New', clientId: 'c-new' });
    const lobby = await lobbyService.joinLobby({
      code: (await lobbyService.getLobbyById(lobbyId))!.code,
      playerId: newcomer.id,
      playerName: 'New',
    });

    const seats = lobby.players.map((p) => p.seatPosition).sort();
    assert.deepEqual(seats, [0, 1, 2], 'seat 1 was reused');
  });
});

describe('the host removing a player', () => {
  test('the removed player disappears from the list', async () => {
    const { lobbyId, hostId, playerIds } = await createLobbyWithPlayers(3);

    const after = await lobbyService.kickPlayer(lobbyId, hostId, playerIds[2]);

    assert.equal(after.playerCount, 2);
    assert.ok(!after.players.some((p) => p.playerId === playerIds[2]));

    const row = await db.lobbyPlayer.findFirst({
      where: { lobbyId, playerId: playerIds[2] },
    });
    assert.equal(row, null, 'the membership row is gone');
  });

  test('only the host may remove anyone', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);
    await assert.rejects(
      () => lobbyService.kickPlayer(lobbyId, playerIds[1], playerIds[2]),
      /Only the host can kick/
    );
  });

  test('the host cannot remove themselves', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(3);
    await assert.rejects(
      () => lobbyService.kickPlayer(lobbyId, hostId, hostId),
      /cannot kick themselves/
    );
  });

  test('removing someone who is not in the lobby fails', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(2);
    const stranger = await playerService.createPlayer({ name: 'Nobody', clientId: 'c-none' });

    await assert.rejects(
      () => lobbyService.kickPlayer(lobbyId, hostId, stranger.id),
      /not in lobby/i
    );
  });
});

describe('leaving', () => {
  test('a non-host leaving just shrinks the lobby', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);

    const after = await lobbyService.leaveLobby(lobbyId, playerIds[1]);

    assert.equal(after?.playerCount, 2);
    assert.equal(after?.hostPlayerId, playerIds[0], 'host is unchanged');
  });

  test('the host leaving hands the lobby to the next player', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(3);

    const after = await lobbyService.leaveLobby(lobbyId, playerIds[0]);

    assert.equal(after?.playerCount, 2);
    assert.equal(after?.hostPlayerId, playerIds[1], 'host transferred');
    assert.equal(
      after?.players.find((p) => p.playerId === playerIds[1])?.isHost,
      true
    );
  });

  test('the last player leaving deletes the lobby', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(1);

    const after = await lobbyService.leaveLobby(lobbyId, hostId);

    assert.equal(after, null);
    assert.equal(await db.lobby.findUnique({ where: { id: lobbyId } }), null);
  });
});

describe('settings updates', () => {
  test('the host can change settings before the game starts', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(2);

    const updated = await lobbyService.updateSettings({
      lobbyId,
      hostPlayerId: hostId,
      settings: { rounds: 8, scoringMode: '+1' },
    });

    assert.equal(updated.settings.rounds, 8);
    assert.equal(updated.settings.scoringMode, '+1');
  });

  test('a non-host cannot change settings', async () => {
    const { lobbyId, playerIds } = await createLobbyWithPlayers(2);
    await assert.rejects(
      () =>
        lobbyService.updateSettings({
          lobbyId,
          hostPlayerId: playerIds[1],
          settings: { rounds: 8 },
        }),
      /Only the host/
    );
  });

  test('maxPlayers cannot be dropped below who is already seated', async () => {
    const { lobbyId, hostId } = await createLobbyWithPlayers(4);
    await assert.rejects(
      () =>
        lobbyService.updateSettings({
          lobbyId,
          hostPlayerId: hostId,
          settings: { maxPlayers: 2 },
        }),
      /below current player count/
    );
  });
});

describe('player identity across reconnects', () => {
  test('the same clientId resolves to the same player row and keeps their seat', async () => {
    const first = await playerService.getOrCreatePlayer('Ana', 'socket-1', 'stable-client');
    const lobby = await lobbyService.createLobby({
      hostPlayerId: first.id,
      hostName: first.name,
    });

    // Reconnect: brand new socket id, same device.
    const second = await playerService.getOrCreatePlayer('Ana', 'socket-2', 'stable-client');

    assert.equal(second.id, first.id, 'same player row');
    assert.equal(second.socketId, 'socket-2', 'live socket refreshed');

    const stillIn = await lobbyService.getPlayerLobby(second.id);
    assert.equal(stillIn?.id, lobby.id, 'seat survived the reconnect');
  });

  test('a disconnect clears the socket but keeps the player and their lobby', async () => {
    const player = await playerService.getOrCreatePlayer('Bo', 'socket-9', 'client-bo');
    await lobbyService.createLobby({ hostPlayerId: player.id, hostName: player.name });

    const afterDisconnect = await playerService.handleDisconnect('socket-9');

    assert.equal(afterDisconnect?.id, player.id);
    assert.equal(afterDisconnect?.socketId, null);
    assert.ok(await lobbyService.getPlayerLobby(player.id), 'still a lobby member');
  });
});
