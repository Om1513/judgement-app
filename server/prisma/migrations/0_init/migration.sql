-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('WAITING', 'IN_GAME', 'COMPLETED');

-- CreateEnum
CREATE TYPE "GameStatus" AS ENUM ('BIDDING', 'PLAYING', 'HAND_WINNER', 'ROUND_COMPLETE', 'ROUND_SCOREBOARD', 'GAME_OVER', 'FINAL_WINNER', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('BIDDING', 'PLAYING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TrickStatus" AS ENUM ('ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "GameActionType" AS ENUM ('BID_SUBMIT', 'CARD_PLAY', 'ROUND_START', 'ROUND_END', 'GAME_START', 'GAME_END');

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "socketId" TEXT,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "botDifficulty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lobby" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(6) NOT NULL,
    "hostPlayerId" TEXT NOT NULL,
    "status" "LobbyStatus" NOT NULL DEFAULT 'WAITING',
    "settings" JSONB NOT NULL DEFAULT '{"rounds": 4, "orderMode": "Kachuful", "scoringMode": "+10", "maxPlayers": 8}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LobbyPlayer" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "seatPosition" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connected" BOOLEAN NOT NULL DEFAULT true,
    "disconnectedAt" TIMESTAMP(3),
    "reconnectDeadline" TIMESTAMP(3),
    "disconnectGeneration" INTEGER NOT NULL DEFAULT 0,
    "controlledByBot" BOOLEAN NOT NULL DEFAULT false,
    "sessionDiscarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LobbyPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "totalRounds" INTEGER NOT NULL DEFAULT 4,
    "currentRound" INTEGER NOT NULL DEFAULT 1,
    "currentHandSize" INTEGER NOT NULL DEFAULT 1,
    "currentTurnPlayerId" TEXT,
    "status" "GameStatus" NOT NULL DEFAULT 'BIDDING',
    "trumpOrderJson" JSONB NOT NULL DEFAULT '[]',
    "gameStateJson" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameResult" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "winnerPlayerIds" JSONB NOT NULL,
    "winningScore" INTEGER NOT NULL,
    "finalScoresJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameRound" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "handSize" INTEGER NOT NULL,
    "trumpKey" TEXT NOT NULL,
    "trumpName" TEXT NOT NULL,
    "trumpSuit" TEXT NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'BIDDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundBid" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "bidValue" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoundBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundTrick" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "trickNumber" INTEGER NOT NULL,
    "leadPlayerId" TEXT NOT NULL,
    "leadSuit" TEXT,
    "winningPlayerId" TEXT,
    "winningCardJson" JSONB,
    "status" "TrickStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RoundTrick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrickCard" (
    "id" TEXT NOT NULL,
    "trickId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "cardJson" JSONB NOT NULL,
    "playOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrickCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundScore" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "bidValue" INTEGER NOT NULL,
    "handsMade" INTEGER NOT NULL,
    "roundScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoundScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreboardConfirmation" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "hasContinued" BOOLEAN NOT NULL DEFAULT false,
    "continuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreboardConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAction" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "actionType" "GameActionType" NOT NULL,
    "actionPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_clientId_key" ON "Player"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_socketId_key" ON "Player"("socketId");

-- CreateIndex
CREATE INDEX "Player_socketId_idx" ON "Player"("socketId");

-- CreateIndex
CREATE INDEX "Player_clientId_idx" ON "Player"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Lobby_code_key" ON "Lobby"("code");

-- CreateIndex
CREATE INDEX "Lobby_code_idx" ON "Lobby"("code");

-- CreateIndex
CREATE INDEX "Lobby_hostPlayerId_idx" ON "Lobby"("hostPlayerId");

-- CreateIndex
CREATE INDEX "Lobby_status_idx" ON "Lobby"("status");

-- CreateIndex
CREATE INDEX "LobbyPlayer_lobbyId_idx" ON "LobbyPlayer"("lobbyId");

-- CreateIndex
CREATE INDEX "LobbyPlayer_playerId_idx" ON "LobbyPlayer"("playerId");

-- CreateIndex
CREATE INDEX "LobbyPlayer_reconnectDeadline_idx" ON "LobbyPlayer"("reconnectDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyPlayer_lobbyId_playerId_key" ON "LobbyPlayer"("lobbyId", "playerId");

-- CreateIndex
CREATE UNIQUE INDEX "LobbyPlayer_lobbyId_seatPosition_key" ON "LobbyPlayer"("lobbyId", "seatPosition");

-- CreateIndex
CREATE INDEX "Game_lobbyId_idx" ON "Game"("lobbyId");

-- CreateIndex
CREATE INDEX "Game_status_idx" ON "Game"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GameResult_gameId_key" ON "GameResult"("gameId");

-- CreateIndex
CREATE INDEX "GameResult_gameId_idx" ON "GameResult"("gameId");

-- CreateIndex
CREATE INDEX "GameRound_gameId_idx" ON "GameRound"("gameId");

-- CreateIndex
CREATE INDEX "GameRound_status_idx" ON "GameRound"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GameRound_gameId_roundNumber_key" ON "GameRound"("gameId", "roundNumber");

-- CreateIndex
CREATE INDEX "RoundBid_gameId_idx" ON "RoundBid"("gameId");

-- CreateIndex
CREATE INDEX "RoundBid_roundId_idx" ON "RoundBid"("roundId");

-- CreateIndex
CREATE INDEX "RoundBid_playerId_idx" ON "RoundBid"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundBid_roundId_playerId_key" ON "RoundBid"("roundId", "playerId");

-- CreateIndex
CREATE INDEX "RoundTrick_gameId_idx" ON "RoundTrick"("gameId");

-- CreateIndex
CREATE INDEX "RoundTrick_roundId_idx" ON "RoundTrick"("roundId");

-- CreateIndex
CREATE INDEX "RoundTrick_status_idx" ON "RoundTrick"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RoundTrick_roundId_trickNumber_key" ON "RoundTrick"("roundId", "trickNumber");

-- CreateIndex
CREATE INDEX "TrickCard_trickId_idx" ON "TrickCard"("trickId");

-- CreateIndex
CREATE INDEX "TrickCard_playerId_idx" ON "TrickCard"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrickCard_trickId_playerId_key" ON "TrickCard"("trickId", "playerId");

-- CreateIndex
CREATE INDEX "RoundScore_gameId_idx" ON "RoundScore"("gameId");

-- CreateIndex
CREATE INDEX "RoundScore_roundId_idx" ON "RoundScore"("roundId");

-- CreateIndex
CREATE INDEX "RoundScore_playerId_idx" ON "RoundScore"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "RoundScore_roundId_playerId_key" ON "RoundScore"("roundId", "playerId");

-- CreateIndex
CREATE INDEX "ScoreboardConfirmation_gameId_idx" ON "ScoreboardConfirmation"("gameId");

-- CreateIndex
CREATE INDEX "ScoreboardConfirmation_roundId_idx" ON "ScoreboardConfirmation"("roundId");

-- CreateIndex
CREATE INDEX "ScoreboardConfirmation_playerId_idx" ON "ScoreboardConfirmation"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreboardConfirmation_gameId_roundId_playerId_key" ON "ScoreboardConfirmation"("gameId", "roundId", "playerId");

-- CreateIndex
CREATE INDEX "GameAction_gameId_idx" ON "GameAction"("gameId");

-- CreateIndex
CREATE INDEX "GameAction_playerId_idx" ON "GameAction"("playerId");

-- CreateIndex
CREATE INDEX "GameAction_actionType_idx" ON "GameAction"("actionType");

-- CreateIndex
CREATE INDEX "GameAction_createdAt_idx" ON "GameAction"("createdAt");

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_hostPlayerId_fkey" FOREIGN KEY ("hostPlayerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyPlayer" ADD CONSTRAINT "LobbyPlayer_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LobbyPlayer" ADD CONSTRAINT "LobbyPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_currentTurnPlayerId_fkey" FOREIGN KEY ("currentTurnPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameResult" ADD CONSTRAINT "GameResult_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameRound" ADD CONSTRAINT "GameRound_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundBid" ADD CONSTRAINT "RoundBid_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundBid" ADD CONSTRAINT "RoundBid_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "GameRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundBid" ADD CONSTRAINT "RoundBid_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundTrick" ADD CONSTRAINT "RoundTrick_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundTrick" ADD CONSTRAINT "RoundTrick_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "GameRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrickCard" ADD CONSTRAINT "TrickCard_trickId_fkey" FOREIGN KEY ("trickId") REFERENCES "RoundTrick"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundScore" ADD CONSTRAINT "RoundScore_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundScore" ADD CONSTRAINT "RoundScore_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "GameRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreboardConfirmation" ADD CONSTRAINT "ScoreboardConfirmation_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreboardConfirmation" ADD CONSTRAINT "ScoreboardConfirmation_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "GameRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAction" ADD CONSTRAINT "GameAction_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAction" ADD CONSTRAINT "GameAction_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

