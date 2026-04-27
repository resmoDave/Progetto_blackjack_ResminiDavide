import express from 'express';
import {
  createGame,
  getGamesByUserId,
  getGameById,
  updateGame,
  deleteGame,
  terminateGame,
  addPlayerToGame,
  removePlayerFromGame,
  getGamePlayers,
  addMoveToGame,
  getGameMoves,
  getGameMessages,
  addMessageToGame
} from '../db/database.js';

const router = express.Router();

/**
 * @swagger
 * /games:
 *   post:
 *     summary: Create a new game
 *     description: Creates a new game owned by the authenticated user
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *                 description: The name of the game
 *             required:
 *               - name
 *             example:
 *               name: Chess Game 1
 *     responses:
 *       201:
 *         description: Game created successfully
 *       400:
 *         description: Invalid game name
 *   get:
 *     summary: Get all games of the authenticated user
 *     description: Retrieves all games owned by the authenticated user
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of games
 */
router.post('/', (req, res) => {
  try {
    const { name, playerName, code, solo } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid game name' });
    }
    
    if (!playerName || typeof playerName !== 'string' || playerName.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid player name' });
    }

    if (!code || typeof code !== 'string' || code.length !== 6) {
      return res.status(400).json({ error: 'Invalid game code' });
    }

    const game = createGame(req.user.id, name.trim(), playerName.trim(), code.toUpperCase(), null, solo === true);
    res.status(201).json({
      message: 'Game created successfully',
      game
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games:
 *   get:
 *     summary: Get all games of the authenticated user
 *     description: Retrieves all games owned by the authenticated user
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of games
 */
// GET /games - Get all games of the authenticated user
router.get('/', (req, res) => {
  try {
    const games = getGamesByUserId(req.user.id);
    res.json({
      count: games.length,
      games
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}:
 *   get:
 *     summary: Get a specific game
 *     description: Retrieves a game by ID (user must own the game)
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: The game ID
 *     responses:
 *       200:
 *         description: Game details
 *       404:
 *         description: Game not found
 *       403:
 *         description: Access denied
 *   put:
 *     summary: Update a game
 *     description: Updates a game's name or status (user must own the game)
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Game updated successfully
 *       404:
 *         description: Game not found
 *       403:
 *         description: Access denied
 *   delete:
 *     summary: Delete a game
 *     description: Deletes a game (user must own the game)
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game deleted successfully
 *       404:
 *         description: Game not found
 *       403:
 *         description: Access denied
 */
// GET /games/:gameId - Get a specific game
router.get('/:gameId', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Allow access if user is owner OR is a player in the game
    const isOwner = game.ownerId === req.user.id;
    const isPlayer = game.players.some(p => p.id === req.user.id);
    
    if (!isOwner && !isPlayer) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ game });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /games/:gameId - Update game
router.put('/:gameId', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { name, status } = req.body;
    const updates = {};
    
    if (name) updates.name = name;
    if (status) updates.status = status;

    const updatedGame = updateGame(req.params.gameId, updates);
    res.json({
      message: 'Game updated successfully',
      game: updatedGame
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// DELETE /games/:gameId - Delete a game
router.delete('/:gameId', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    deleteGame(req.params.gameId);
    res.json({ message: 'Game deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}/terminate:
 *   put:
 *     summary: Terminate a game
 *     description: Terminates a game and removes all players (owner only)
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game terminated successfully
 *       404:
 *         description: Game not found
 *       403:
 *         description: Access denied
 */
// PUT /games/:gameId/terminate - Terminate a game (remove all players)
router.put('/:gameId/terminate', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const playerIds = game.players.map(p => p.id);
    deleteGame(req.params.gameId);
    
    res.json({ 
      message: 'Game terminated successfully',
      gameId: req.params.gameId,
      playerCount: playerIds.length,
      removedPlayers: playerIds
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}/players:
 *   post:
 *     summary: Add a player to a game
 *     description: Adds a new player to a game (user must own the game)
 *     tags:
 *       - Players
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *             required:
 *               - name
 *     responses:
 *       201:
 *         description: Player added successfully
 *       400:
 *         description: Invalid player name
 *       403:
 *         description: Access denied
 *       404:
 *         description: Game not found
 *   get:
 *     summary: Get all players in a game
 *     description: Retrieves all players in a game (user must own the game)
 *     tags:
 *       - Players
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of players
 *       403:
 *         description: Access denied
 *       404:
 *         description: Game not found
 */
// POST /games/:gameId/players - Add a player to a game
router.post('/:gameId/players', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid player name' });
    }

    const player = addPlayerToGame(req.params.gameId, req.user.id, name.trim());
    
    if (!player) {
      return res.status(400).json({ error: 'Player already in game' });
    }
    
    // Return the updated game with all players
    const updatedGame = getGameById(req.params.gameId);
    
    res.status(201).json({
      message: 'Player added successfully',
      player,
      game: updatedGame
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /games/:gameId/players - Get all players in a game
router.get('/:gameId/players', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Allow access if user is owner OR is a player in the game
    const isOwner = game.ownerId === req.user.id;
    const isPlayer = game.players.some(p => p.id === req.user.id);
    
    if (!isOwner && !isPlayer) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const players = getGamePlayers(req.params.gameId);
    res.json({
      gameId: req.params.gameId,
      count: players.length,
      players
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}/players/{playerId}:
 *   delete:
 *     summary: Remove a player from a game
 *     description: Removes a player from a game (user must own the game)
 *     tags:
 *       - Players
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: playerId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Player removed successfully
 *       404:
 *         description: Player or game not found
 *       403:
 *         description: Access denied
 */
// DELETE /games/:gameId/players/:playerId - Remove a player from a game
router.delete('/:gameId/players/:playerId', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Allow owner to remove any player, or player to remove themselves
    const isOwner = game.ownerId === req.user.id;
    const isSelfRemoval = req.params.playerId === req.user.id;
    
    if (!isOwner && !isSelfRemoval) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updatedGame = removePlayerFromGame(req.params.gameId, req.params.playerId);
    
    if (updatedGame === false) {
      return res.status(404).json({ error: 'Player not found' });
    }

    if (updatedGame === null) {
      // la partita non esiste più perché l'ultimo giocatore (host) è uscito
      return res.json({ message: 'Player removed successfully, game closed because no players remaining' });
    }

    res.json({
      message: 'Player removed successfully',
      game: updatedGame
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}/moves:
 *   post:
 *     summary: Add a move to a game
 *     description: Records a move for a player in a game (user must own the game)
 *     tags:
 *       - Moves
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               playerId:
 *                 type: string
 *               data:
 *                 type: object
 *                 description: Move data as JSON object
 *             required:
 *               - playerId
 *               - data
 *     responses:
 *       201:
 *         description: Move added successfully
 *       400:
 *         description: Invalid playerId or move data
 *       403:
 *         description: Access denied
 *       404:
 *         description: Game or player not found
 *   get:
 *     summary: Get all moves in a game
 *     description: Retrieves all moves made in a game (user must own the game)
 *     tags:
 *       - Moves
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of moves
 *       403:
 *         description: Access denied
 *       404:
 *         description: Game not found
 */
// POST /games/:gameId/moves - Add a move to a game
router.post('/:gameId/moves', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Verify that the authenticated user is a player in the game or the game owner
    const currentUserIsPlayer = game.players.some(p => p.id === req.user.id);
    const currentUserIsOwner = game.ownerId === req.user.id;
    if (!currentUserIsPlayer && !currentUserIsOwner) {
      return res.status(403).json({ error: 'Access denied: Only players and the game owner can post moves' });
    }

    const { playerId, data } = req.body;
    
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'Invalid playerId' });
    }

    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Invalid move data (must be JSON object)' });
    }

    // Verify player exists in the game
    const player = game.players.find(p => p.id === playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found in this game' });
    }

    const move = addMoveToGame(req.params.gameId, playerId, data);
    res.status(201).json({
      message: 'Move added successfully',
      move
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// GET /games/:gameId/moves - Get all moves in a game
router.get('/:gameId/moves', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Verify that the authenticated user is a player in the game or the game owner
    const currentUserIsPlayer = game.players.some(p => p.id === req.user.id);
    const currentUserIsOwner = game.ownerId === req.user.id;
    if (!currentUserIsPlayer && !currentUserIsOwner) {
      return res.status(403).json({ error: 'Access denied: Only players and the game owner can view moves' });
    }

    const moves = getGameMoves(req.params.gameId);
    res.json({
      gameId: req.params.gameId,
      count: moves.length,
      moves
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}/moves/{moveId}:
 *   get:
 *     summary: Get a specific move
 *     description: Retrieves a specific move from a game (user must own the game)
 *     tags:
 *       - Moves
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: moveId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Move details
 *       404:
 *         description: Move or game not found
 *       403:
 *         description: Access denied
 */
// GET /games/:gameId/moves/:moveId - Get a specific move (filter from moves array)
router.get('/:gameId/moves/:moveId', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const move = game.moves.find(m => m.id === req.params.moveId);
    
    if (!move) {
      return res.status(404).json({ error: 'Move not found' });
    }

    res.json({ move });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /games/:gameId/start - Start a game
router.post('/:gameId/start', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    if (game.ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied - only owner can start the game' });
    }

    const updatedGame = updateGame(req.params.gameId, { status: 'in-progress' });
    
    res.json({
      message: 'Game started successfully!',
      game: updatedGame
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}/messages:
 *   get:
 *     summary: Get all messages in a game
 *     description: Retrieves all chat messages from a game
 *     tags:
 *       - Chat
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of messages
 *       404:
 *         description: Game not found
 *       403:
 *         description: Access denied
 *   post:
 *     summary: Send a message in a game
 *     description: Sends a chat message in the game
 *     tags:
 *       - Chat
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               text:
 *                 type: string
 *             required:
 *               - text
 *             example:
 *               text: "Nice move!"
 *     responses:
 *       201:
 *         description: Message sent successfully
 *       400:
 *         description: Invalid message text
 *       404:
 *         description: Game not found
 *       403:
 *         description: Access denied
 */
// GET /games/:gameId/messages - Get all messages
router.get('/:gameId/messages', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Allow access if user is owner OR is a player in the game
    const isOwner = game.ownerId === req.user.id;
    const isPlayer = game.players.some(p => p.id === req.user.id);
    
    if (!isOwner && !isPlayer) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = getGameMessages(req.params.gameId);
    res.json({
      gameId: req.params.gameId,
      count: messages.length,
      messages
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /games/:gameId/messages - Send a message
router.post('/:gameId/messages', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Allow access if user is owner OR is a player in the game
    const isOwner = game.ownerId === req.user.id;
    const isPlayer = game.players.some(p => p.id === req.user.id);
    
    if (!isOwner && !isPlayer) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { text } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid message text' });
    }

    // Trova il nome del giocatore dal tavolo (non dal nome account)
    const player = game.players.find(p => p.id === req.user.id);
    const playerName = player ? player.name : req.user.username;

    const message = addMessageToGame(
      req.params.gameId,
      req.user.id,
      playerName,
      text.trim()
    );

    res.status(201).json({
      message: 'Message sent successfully',
      data: message
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * @swagger
 * /games/{gameId}/leave:
 *   post:
 *     summary: Leave a game
 *     description: Leave a game (if owner leaves, game is deleted and all players are kicked out)
 *     tags:
 *       - Games
 *     security:
 *       - ApiKeyAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Successfully left the game
 *       404:
 *         description: Game not found
 *       403:
 *         description: Access denied (not a player in this game)
 */
// POST /games/:gameId/leave - Leave a game
router.post('/:gameId/leave', (req, res) => {
  try {
    const game = getGameById(req.params.gameId);

    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    // Check if user is a player in the game
    const isPlayer = game.players.some(p => p.id === req.user.id);
    const isOwner = game.ownerId === req.user.id;
    
    if (!isPlayer) {
      return res.status(403).json({ error: 'Access denied - not a player in this game' });
    }

    const result = removePlayerFromGame(req.params.gameId, req.user.id);

    if (result.status === 'deleted') {
      res.json({
        message: 'Game deleted and all players kicked out',
        gameId: req.params.gameId,
        gameDeleted: true,
        wasOwner: isOwner
      });
    } else if (result.status === 'player-removed') {
      res.json({
        message: 'Successfully left the game',
        game: result.game,
        gameDeleted: false
      });
    } else {
      return res.status(404).json({ error: 'Game not found' });
    }
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;