import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './swagger.js';
import authRoutes from './routes/auth.js';
import gameRoutes from './routes/games.js';
import { apiKeyAuth } from './middleware/auth.js';
import { getRunningGames, getGameByCode, registerUser, getUserByUsername, getUserByApiKey, getGameById, addMessageToGame, removePlayerFromGame, terminateGame, addMoveToGame, deleteGame } from './db/database.js';
import { createDeck, calculateScore, determineWinner, completeDealerTurn, cardToWeb, isBlackjack } from '/workspaces/GameApi/static/games/blackjack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});
const PORT = process.env.PORT || 3000;


// Middleware
app.use(express.json());
app.use(cors());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Static files
app.use('/frontend',express.static(join(__dirname, '../static')));
app.use('/favicon.ico', express.static(join(__dirname, '../static/favicon.ico')));

// Public authentication routes (all users stored in games.json)
// POST /register
app.post('/register', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = registerUser(username, password);
    res.status(201).json({
      message: 'Registration successful',
      user: { id: user.id, username: user.username, apiKey: user.apiKey }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// POST /login
app.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    const user = getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    res.json({
      message: 'Login successful',
      user: { id: user.id, username: user.username, apiKey: user.apiKey }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Public routes (no authentication required)
app.use('/auth', authRoutes);

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Public endpoint: partite disponibili in tempo reale (consultabile da Postman)
app.get('/games/available', (req, res) => {
  try {
    const runningGames = getRunningGames();
    res.json({ count: runningGames.length, games: runningGames });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Public endpoint: trova partita per codice (per join)
app.get('/games/code/:code', (req, res) => {
  try {
    const game = getGameByCode(req.params.code);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    res.json({ game: { id: game.id, name: game.name, status: game.status } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Protected routes (authentication required)
app.use('/games', apiKeyAuth, gameRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ========== BLACKJACK GAME STATE ==========
// Storage per le partite di blackjack attive
const blackjackGames = {}; // { gameId: { playerStates, deck, dealerCards, round, ... } }
const playerTimeouts = {}; // { gameId-playerId: timeoutId }
const spectators = {}; // { gameId: [{ id, name, balance }] } spettatori in attesa del prossimo round

const PLAYER_TIMEOUT = 10000; // 10 secondi per giocatore

function initializeBlackjackGame(gameId, players) {
  const game = {
    gameId,
    players: players.map((p, index) => ({
      id: p.id,
      name: p.name,
      balance: 1000,
      bet: 0,
      cards: [],
      score: 0,
      status: 'betting', // betting, playing, stand, bust, done, timeout
      round: 1,
      turnOrder: index
    })),
    deck: createDeck(),
    dealerCards: [],
    dealerScore: 0,
    status: 'betting', // betting, playing, dealing, complete
    currentPlayerTurn: 0, // Indice del giocatore che sta giocando
    bettingRound: true,
    createdAt: new Date().toISOString()
  };
  
  blackjackGames[gameId] = game;
  console.log(`🎰 Blackjack game initialized for gameId: ${gameId} with ${players.length} players`);
  return game;
}

function getBlackjackGame(gameId) {
  return blackjackGames[gameId] || null;
}

function deleteBlackjackGame(gameId) {
  delete blackjackGames[gameId];
  // Cancella anche i timeout associati
  for (let key in playerTimeouts) {
    if (key.startsWith(gameId)) {
      clearTimeout(playerTimeouts[key]);
      delete playerTimeouts[key];
    }
  }
  console.log(`🗑️ Blackjack game deleted: ${gameId}`);
}

/**
 * Avvia il timeout per il turno del giocatore corrente
 */
function setPlayerTurnTimeout(gameId, playerId, io) {
  const game = getBlackjackGame(gameId);
  if (!game) return;

  const timeoutKey = `${gameId}-${playerId}`;
  
  // Cancella il timeout precedente se esiste
  if (playerTimeouts[timeoutKey]) {
    clearTimeout(playerTimeouts[timeoutKey]);
  }

  // Imposta nuovo timeout
  playerTimeouts[timeoutKey] = setTimeout(() => {
    const player = game.players.find(p => p.id === playerId);
    if (player && player.status === 'playing') {
      console.log(`⏱️ Player ${player.name} timeout!`);
      player.status = 'timeout';
      
      // Notifica il timeout
      io.to(`game-${gameId}`).emit('player-timeout', {
        playerId,
        playerName: player.name,
        message: `${player.name} non ha deciso in tempo - Passa al prossimo`
      });

      // Vai al prossimo giocatore
      nextPlayerTurn(gameId, io);
    }
  }, PLAYER_TIMEOUT);
}

/**
 * Cancella il timeout del giocatore
 */
function clearPlayerTurnTimeout(gameId, playerId) {
  const timeoutKey = `${gameId}-${playerId}`;
  if (playerTimeouts[timeoutKey]) {
    clearTimeout(playerTimeouts[timeoutKey]);
    delete playerTimeouts[timeoutKey];
  }
}

/**
 * Passa al turno del prossimo giocatore
 */
function nextPlayerTurn(gameId, io) {
  const game = getBlackjackGame(gameId);
  if (!game) return;

  // Trova il prossimo giocatore che deve ancora giocare
  let nextTurn = false;
  for (let i = 0; i < game.players.length; i++) {
    const playerIndex = (game.currentPlayerTurn + i + 1) % game.players.length;
    const player = game.players[playerIndex];
    
    if (player.status === 'playing') {
      game.currentPlayerTurn = playerIndex;
      nextTurn = true;
      
      // Avvia il timer per il nuovo giocatore
      setTimeout(() => {
        setPlayerTurnTimeout(gameId, player.id, io);
      }, 500);

      // Notifica il nuovo turno
      io.to(`game-${gameId}`).emit('player-turn', {
        playerId: player.id,
        playerName: player.name,
        message: `È il turno di ${player.name}`,
        timeLimit: PLAYER_TIMEOUT / 1000 // Converti in secondi per frontend
      });

      break;
    }
  }

  // Se nessun giocatore rimanente sta giocando, completa il round
  if (!nextTurn) {
    completeDealerPlay(gameId, io);
  }
}

/**
 * Bot del banchiere che decide intelligentemente
 */
function dealerPlay(dealerCards, deck) {
  let score = calculateScore(dealerCards).score;
  
  // Dealer hits on 16, stands on 17 or higher (soft 17 rule)
  while (score < 17) {
    dealerCards.push(deck.pop());
    score = calculateScore(dealerCards).score;
  }

  return { dealerCards, dealerScore: score };
}

// ========== SOCKET.IO - REAL-TIME CHAT & GAME EVENTS ==========

// Middleware per autenticazione WebSocket
io.use((socket, next) => {
  const apiKey = socket.handshake.auth.token;
  if (!apiKey) {
    return next(new Error('API key missing'));
  }
  
  const user = getUserByApiKey(apiKey);
  if (!user) {
    return next(new Error('Invalid API key'));
  }
  
  socket.user = user;
  next();
});

// Gestione connessioni
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.user.username} (${socket.id})`);

  // EVENTO: Giocatore entra nella lobby
  socket.on('join-lobby', (gameId) => {
    socket.join(`game-${gameId}`);
    const game = getGameById(gameId);
    const blackjackGame = getBlackjackGame(gameId);

    if (game) {
      // Se la partita è in corso, entra come spettatore
      if (blackjackGame && blackjackGame.status === 'playing') {
        // Aggiungi agli spettatori se non già presente
        if (!spectators[gameId]) spectators[gameId] = [];
        const alreadySpectating = spectators[gameId].find(s => s.id === socket.user.id);
        if (!alreadySpectating) {
          const player = game.players.find(p => p.id === socket.user.id);
          spectators[gameId].push({
            id: socket.user.id,
            name: player ? player.name : socket.user.username,
            balance: 500 // saldo fisso per i nuovi entranti
          });
        }

        // Notifica lo spettatore del suo stato
        socket.emit('joined-as-spectator', {
          message: '👀 Partita in corso! Entrerai come giocatore dal prossimo round.',
          currentPlayers: blackjackGame.players.map(p => ({
            id: p.id,
            name: p.name,
            score: p.score,
            status: p.status,
            cards: p.cards.map(cardToWeb)
          })),
          dealerCard: cardToWeb(blackjackGame.dealerCards[0])
        });

        // Notifica gli altri
        io.to(`game-${gameId}`).emit('spectator-joined', {
          username: socket.user.username,
          message: `👀 ${socket.user.username} sta guardando la partita`
        });

        console.log(`👀 ${socket.user.username} joined as spectator: ${gameId}`);
      } else {
        // Lobby normale, partita non ancora iniziata
        io.to(`game-${gameId}`).emit('player-joined', {
          username: socket.user.username,
          players: game.players.map(p => ({ id: p.id, name: p.name })),
          message: `${socket.user.username} è entrato nella lobby`
        });
        console.log(`👤 ${socket.user.username} joined lobby: ${gameId}`);
      }
    }
  });

  // EVENTO: Invia messaggio in chat
  socket.on('send-message', (data) => {
    const { gameId, text } = data;
    
    if (!gameId || !text) return;
    
    // Cerca il gioco e il nome del giocatore
    const game = getGameById(gameId);
    if (!game) return;
    
    // Trova il nome del giocatore dal tavolo (non dal nome account)
    const player = game.players.find(p => p.id === socket.user.id);
    const playerName = player ? player.name : socket.user.username;
    
    // Salva il messaggio nel database
    const savedMessage = addMessageToGame(gameId, socket.user.id, playerName, text);
    
    if (!savedMessage) return;

    // Invia il messaggio a TUTTI nella stanza (real-time)
    io.to(`game-${gameId}`).emit('new-message', savedMessage);
    console.log(`💬 ${playerName}: ${text}`);
  });

  // EVENTO: Giocatore esce dalla lobby
  socket.on('leave-lobby', (gameId, callback) => {
    socket.leave(`game-${gameId}`);
    const game = getGameById(gameId);
    
    if (!game) {
      if (callback) callback({ status: 'not-found' });
      return;
    }
    
    const wasOwner = game.ownerId === socket.user.id;
    const blackjackGame = getBlackjackGame(gameId);
    
    // Se c'è una partita di blackjack in corso, rimuovi il giocatore
    if (blackjackGame) {
      const playerIndex = blackjackGame.players.findIndex(p => p.id === socket.user.id);
      if (playerIndex !== -1) {
        const player = blackjackGame.players[playerIndex];
        const wasPlayerTurn = blackjackGame.currentPlayerTurn === playerIndex;
        
        // Rimuovi il giocatore dalla partita
        blackjackGame.players.splice(playerIndex, 1);
        
        // Se era il suo turno, passa al prossimo
        if (wasPlayerTurn) {
          if (blackjackGame.players.length > 0) {
            // Adatta l'indice del turno
            if (blackjackGame.currentPlayerTurn >= blackjackGame.players.length) {
              blackjackGame.currentPlayerTurn = 0;
            }
            
            // Cancella il timeout del giocatore che ha lasciato
            clearPlayerTurnTimeout(gameId, socket.user.id);
            
            // Passa al prossimo giocatore
            setTimeout(() => {
              nextPlayerTurn(gameId, io);
            }, 500);
            
            console.log(`⏭️ ${player.name} left during their turn, passing to next player`);
          } else {
            // Se non rimangono giocatori, elimina la partita
            deleteBlackjackGame(gameId);
            console.log(`🗑️ Blackjack game ${gameId} deleted - no players left`);
          }
        }
        
        // Notifica che il giocatore ha abbandonato il gioco
        io.to(`game-${gameId}`).emit('player-abandoned', {
          playerName: player.name,
          playerId: socket.user.id,
          message: `${player.name} ha abbandonato la partita durante il gioco 👋`,
          remainingPlayers: blackjackGame.players.length
        });
      }
    }
    
    const result = removePlayerFromGame(gameId, socket.user.id);
    
    if (result.status === 'deleted') {
      // Partita eliminata (owner è uscito OPPURE è rimasta vuota)
      const reason = result.reason === 'empty' ? 'nessun giocatore' : 'host';
      const deleteMessage = {
        message: reason === 'empty' 
          ? `Partita eliminata - Nessun giocatore rimasto ❌`
          : `${socket.user.username} (Host) ha abbandonato la partita. Partita eliminata! ❌`,
        gameId,
        kickedBy: socket.user.username,
        reason: reason,
        deletedAt: new Date().toISOString()
      };
      
      // Notifica all'host stesso (ACK)
      socket.emit('game-deleted', deleteMessage);
      
      // Notifica agli altri giocatori nella stanza (se ce ne sono)
      io.to(`game-${gameId}`).emit('game-deleted', deleteMessage);
      
      // Elimina anche la partita di blackjack se l'host è uscito
      if (wasOwner && blackjackGame) {
        deleteBlackjackGame(gameId);
      }
      
      console.log(`🗑️ Game ${gameId} deleted - Reason: ${reason}`);
      if (callback) callback({ status: 'deleted' });
    } else if (result.status === 'player-removed') {
      // Giocatore rimosso, partita continua
      const leftMessage = {
        username: socket.user.username,
        players: result.game.players.map(p => ({ id: p.id, name: p.name })),
        message: `${socket.user.username} ha abbandonato la partita`,
        playerCount: result.game.players.length
      };
      
      io.to(`game-${gameId}`).emit('player-left', leftMessage);
      
      console.log(`👋 ${socket.user.username} left game: ${gameId}`);
      if (callback) callback({ status: 'player-removed' });
    } else {
      if (callback) callback(result);
    }
  });

  // EVENTO: Host avvia la partita (BLACKJACK)
  socket.on('game-started', (gameId) => {
    const game = getGameById(gameId);
    
    if (game && game.ownerId === socket.user.id) {
      // Inizializza il gioco di blackjack
      const blackjackGame = initializeBlackjackGame(gameId, game.players);
      
      // Notifica tutti i giocatori
      io.to(`game-${gameId}`).emit('start-game', {
        gameId,
        message: 'La partita di Blackjack è iniziata! 🎮',
        timestamp: new Date().toISOString(),
        game: blackjackGame
      });
      
      console.log(`🎮 Blackjack started for game ${gameId} with ${game.players.length} players`);
    }
  });

  // EVENTO: Host termina la partita
  socket.on('terminate-game', (gameId, callback) => {
    const game = getGameById(gameId);
    
    if (!game) {
      if (callback) callback({ status: 'not-found' });
      return;
    }
    
    // Solo il proprietario può terminare
    if (game.ownerId !== socket.user.id) {
      if (callback) callback({ status: 'unauthorized' });
      return;
    }
    
    const playerIds = game.players.map(p => p.id);
    const playerCount = playerIds.length;
    
    // Termina la partita nel database
    terminateGame(gameId);
    
    // Pulisci la partita di blackjack se esiste
    if (getBlackjackGame(gameId)) {
      deleteBlackjackGame(gameId);
    }
    
    // Notifica di terminazione
    const terminateMessage = {
      gameId,
      host: socket.user.username,
      message: `${socket.user.username} (Host) ha terminato la partita! ⛔`,
      playerCount,
      removedPlayers: playerIds,
      reason: 'host-terminated',
      timestamp: new Date().toISOString()
    };
    
    // Notifica TUTTI nella stanza (incluso il mittente)
    io.to(`game-${gameId}`).emit('game-terminated', terminateMessage);
    
    // Disconnetti tutti dalla room
    io.to(`game-${gameId}`).socketsLeave(`game-${gameId}`);
    
    console.log(`⛔ Game ${gameId} terminated by host ${socket.user.username}. Removed ${playerCount} players`);
    
    if (callback) {
      callback({ 
        status: 'terminated', 
        playerCount,
        message: 'Partita terminata e tutti i giocatori rimossi'
      });
    }
  });

  // ========== BLACKJACK GAME EVENTS ==========

  // EVENTO: Giocatore piazza una scommessa
  socket.on('blackjack-bet', (data) => {
    const { gameId, betAmount } = data;
    const blackjackGame = getBlackjackGame(gameId);
    
    if (!blackjackGame) {
      socket.emit('error', { message: 'Partita non trovata' });
      return;
    }
    
    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState) {
      socket.emit('error', { message: 'Giocatore non trovato nella partita' });
      return;
    }
    
    if (betAmount < 10 || betAmount > playerState.balance) {
      socket.emit('error', { message: 'Scommessa non valida' });
      return;
    }
    
    // Piazza la scommessa
    playerState.bet = betAmount;
    playerState.balance -= betAmount;
    playerState.status = 'ready';
    
    // Distribuisci le carte quando tutti hanno scommesso
    const allReady = blackjackGame.players.every(p => p.bet > 0);
    if (allReady) {
      dealInitialCards(gameId, blackjackGame);
    }
    
    // Notifica gli altri giocatori
    io.to(`game-${gameId}`).emit('player-bet', {
      playerId: socket.user.id,
      playerName: playerState.name,
      bet: betAmount,
      balance: playerState.balance
    });
    
    console.log(`💰 ${playerState.name} bet $${betAmount} on game ${gameId}`);
  });

  // Funzione helper per distribuire le carte iniziali
  function dealInitialCards(gameId, blackjackGame) {
    const deck = blackjackGame.deck;
    blackjackGame.dealerCards = [deck.pop(), deck.pop()];
    blackjackGame.status = 'playing';
    blackjackGame.bettingRound = false;
    
    for (let player of blackjackGame.players) {
      player.cards = [deck.pop(), deck.pop()];
      player.score = calculateScore(player.cards).score;
      player.status = 'playing';
      
      // Se è blackjack (21 con 2 carte), passa automaticamente a stand
      if (isBlackjack(player.cards)) {
        player.status = 'stand';
      }
    }
    
    // Invia lo stato del gioco a tutti
    io.to(`game-${gameId}`).emit('cards-dealt', {
      dealerCard: cardToWeb(blackjackGame.dealerCards[0]), // Solo la prima carta del banco è visibile
      players: blackjackGame.players.map(p => ({
        id: p.id,
        name: p.name,
        cards: p.cards.map(cardToWeb),
        score: p.score,
        status: p.status,
        bet: p.bet
      }))
    });
    
    // Avvia il turno del primo giocatore dopo un breve delay
    setTimeout(() => {
      // Trova il primo giocatore che deve ancora giocare
      blackjackGame.currentPlayerTurn = 0;
      const firstPlayer = blackjackGame.players[0];
      
      if (firstPlayer.status === 'playing') {
        setPlayerTurnTimeout(gameId, firstPlayer.id, io);
        
        io.to(`game-${gameId}`).emit('player-turn', {
          playerId: firstPlayer.id,
          playerName: firstPlayer.name,
          message: `È il turno di ${firstPlayer.name}`,
          timeLimit: PLAYER_TIMEOUT / 1000
        });
      } else {
        // Se il primo giocatore ha blackjack, passa al prossimo
        nextPlayerTurn(gameId, io);
      }
    }, 1000);
    
    console.log(`🃏 Cards dealt for game ${gameId}`);
  }

  // EVENTO: Giocatore chiede una carta (Hit)
  socket.on('blackjack-hit', (gameId) => {
    const blackjackGame = getBlackjackGame(gameId);
    
    if (!blackjackGame) {
      socket.emit('error', { message: 'Partita non trovata' });
      return;
    }
    
    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState || playerState.status !== 'playing') {
      socket.emit('error', { message: 'Non è il tuo turno' });
      return;
    }
    
    // Verifica che sia il turno di questo giocatore
    if (blackjackGame.players[blackjackGame.currentPlayerTurn].id !== socket.user.id) {
      socket.emit('error', { message: 'Non è il tuo turno, aspetta il tuo momento' });
      return;
    }
    
    // Cancella il timeout del giocatore
    clearPlayerTurnTimeout(gameId, socket.user.id);
    
    const newCard = blackjackGame.deck.pop();
    playerState.cards.push(newCard);
    playerState.score = calculateScore(playerState.cards).score;
    
    if (playerState.score > 21) {
      playerState.status = 'bust';
      // Passa al prossimo giocatore
      nextPlayerTurn(gameId, io);
    }
    
    // Registra la mossa nel database
    addMoveToGame(gameId, socket.user.id, {
      type: 'hit',
      playerName: playerState.name,
      newCard: cardToWeb(newCard),
      score: playerState.score,
      status: playerState.status
    });
    
    // Notifica a tutti
    io.to(`game-${gameId}`).emit('player-hit', {
      playerId: socket.user.id,
      playerName: playerState.name,
      newCard: cardToWeb(newCard),
      score: playerState.score,
      status: playerState.status
    });
    
    console.log(`🃏 ${playerState.name} hit on game ${gameId} - Score: ${playerState.score}`);
  });

  // EVENTO: Giocatore si ferma (Stand)
  socket.on('blackjack-stand', (gameId) => {
    const blackjackGame = getBlackjackGame(gameId);
    
    if (!blackjackGame) {
      socket.emit('error', { message: 'Partita non trovata' });
      return;
    }
    
    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState || playerState.status !== 'playing') {
      socket.emit('error', { message: 'Non è il tuo turno' });
      return;
    }
    
    // Verifica che sia il turno di questo giocatore
    if (blackjackGame.players[blackjackGame.currentPlayerTurn].id !== socket.user.id) {
      socket.emit('error', { message: 'Non è il tuo turno, aspetta il tuo momento' });
      return;
    }
    
    // Cancella il timeout del giocatore
    clearPlayerTurnTimeout(gameId, socket.user.id);
    
    playerState.status = 'stand';
    
    // Registra la mossa nel database
    addMoveToGame(gameId, socket.user.id, {
      type: 'stand',
      playerName: playerState.name,
      score: playerState.score,
      status: playerState.status
    });

    // Notifica a tutti (una volta sola)
    io.to(`game-${gameId}`).emit('player-stand', {
      playerId: socket.user.id,
      playerName: playerState.name,
      score: playerState.score
    });
    
    // Passa al prossimo giocatore
    nextPlayerTurn(gameId, io);
    
    console.log(`🛑 ${playerState.name} stand on game ${gameId}`);
  });

  // EVENTO: Giocatore fa double down
  socket.on('blackjack-double', (gameId) => {
    const blackjackGame = getBlackjackGame(gameId);

    if (!blackjackGame) {
      socket.emit('error', { message: 'Partita non trovata' });
      return;
    }

    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState || playerState.status !== 'playing') {
      socket.emit('error', { message: 'Non è il tuo turno' });
      return;
    }

    if (blackjackGame.players[blackjackGame.currentPlayerTurn].id !== socket.user.id) {
      socket.emit('error', { message: 'Non è il tuo turno, aspetta il tuo momento' });
      return;
    }

    if (playerState.cards.length !== 2) {
      socket.emit('error', { message: 'Puoi fare double down solo con 2 carte' });
      return;
    }

    if (playerState.balance < playerState.bet) {
      socket.emit('error', { message: 'Saldo insufficiente per il double down' });
      return;
    }

    clearPlayerTurnTimeout(gameId, socket.user.id);

    // Scala il saldo e raddoppia la puntata
    playerState.balance -= playerState.bet;
    playerState.bet *= 2;

    // Pesca una sola carta dal mazzo del server
    const newCard = blackjackGame.deck.pop();
    playerState.cards.push(newCard);
    playerState.score = calculateScore(playerState.cards).score;

    if (playerState.score > 21) {
      playerState.status = 'bust';
    } else {
      playerState.status = 'stand'; // Dopo double, il giocatore non può più agire
    }

    addMoveToGame(gameId, socket.user.id, {
      type: 'double',
      playerName: playerState.name,
      newCard: cardToWeb(newCard),
      score: playerState.score,
      newBet: playerState.bet,
      status: playerState.status
    });

    io.to(`game-${gameId}`).emit('player-double', {
      playerId: socket.user.id,
      playerName: playerState.name,
      newCard: cardToWeb(newCard),
      score: playerState.score,
      newBet: playerState.bet,
      status: playerState.status,
      balance: playerState.balance
    });

    console.log(`💰 ${playerState.name} double down on game ${gameId} - Score: ${playerState.score}`);

    // Passa al prossimo giocatore
    nextPlayerTurn(gameId, io);
  });

  // EVENTO: Giocatore fa split
  socket.on('blackjack-split', (gameId) => {
    const blackjackGame = getBlackjackGame(gameId);

    if (!blackjackGame) {
      socket.emit('error', { message: 'Partita non trovata' });
      return;
    }

    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState || playerState.status !== 'playing') {
      socket.emit('error', { message: 'Non è il tuo turno' });
      return;
    }

    if (blackjackGame.players[blackjackGame.currentPlayerTurn].id !== socket.user.id) {
      socket.emit('error', { message: 'Non è il tuo turno, aspetta il tuo momento' });
      return;
    }

    // Confronta il valore numerico (J/Q/K valgono tutti 10)
    const cardNumericValue = (card) => {
      if (['J','Q','K'].includes(card.value)) return 10;
      if (card.value === 'A') return 11;
      return parseInt(card.value);
    };

    if (playerState.cards.length !== 2 || cardNumericValue(playerState.cards[0]) !== cardNumericValue(playerState.cards[1])) {
      socket.emit('error', { message: 'Non puoi fare split con queste carte' });
      return;
    }

    if (playerState.balance < playerState.bet) {
      socket.emit('error', { message: 'Saldo insufficiente per lo split' });
      return;
    }

    clearPlayerTurnTimeout(gameId, socket.user.id);

    // Esegui lo split
    const splitCard = playerState.cards.pop();
    const newCard1 = blackjackGame.deck.pop();
    const newCard2 = blackjackGame.deck.pop();

    playerState.cards.push(newCard1);
    playerState.splitHand = [splitCard, newCard2];
    playerState.splitBet = playerState.bet;
    playerState.balance -= playerState.bet;
    playerState.score = calculateScore(playerState.cards).score;
    playerState.splitScore = calculateScore(playerState.splitHand).score;
    playerState.isPlayingSplit = false; // prima gioca la mano principale
    playerState.splitStatus = 'waiting'; // la seconda mano aspetta

    addMoveToGame(gameId, socket.user.id, {
      type: 'split',
      playerName: playerState.name,
      hand1: playerState.cards.map(cardToWeb),
      hand2: playerState.splitHand.map(cardToWeb)
    });

    io.to(`game-${gameId}`).emit('player-split', {
      playerId: socket.user.id,
      playerName: playerState.name,
      hand1: playerState.cards.map(cardToWeb),
      hand2: playerState.splitHand.map(cardToWeb),
      score1: playerState.score,
      score2: playerState.splitScore,
      bet: playerState.bet,
      splitBet: playerState.splitBet,
      balance: playerState.balance
    });

    console.log(`✂️ ${playerState.name} split on game ${gameId}`);
  });

  // EVENTO: Giocatore fa stand/hit sulla seconda mano dello split
  socket.on('blackjack-split-stand', (gameId) => {
    const blackjackGame = getBlackjackGame(gameId);
    if (!blackjackGame) return;

    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState || !playerState.splitHand) return;

    clearPlayerTurnTimeout(gameId, socket.user.id);

    playerState.splitStatus = 'stand';
    playerState.status = 'stand'; // entrambe le mani completate

    io.to(`game-${gameId}`).emit('player-split-stand', {
      playerId: socket.user.id,
      playerName: playerState.name,
      splitScore: playerState.splitScore
    });

    console.log(`🛑 ${playerState.name} split-stand on game ${gameId}`);
    nextPlayerTurn(gameId, io);
  });

  socket.on('blackjack-split-hit', (gameId) => {
    const blackjackGame = getBlackjackGame(gameId);
    if (!blackjackGame) return;

    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState || !playerState.splitHand || playerState.splitStatus !== 'playing') return;

    clearPlayerTurnTimeout(gameId, socket.user.id);

    const newCard = blackjackGame.deck.pop();
    playerState.splitHand.push(newCard);
    playerState.splitScore = calculateScore(playerState.splitHand).score;

    if (playerState.splitScore > 21) {
      playerState.splitStatus = 'bust';
      playerState.status = 'stand';
    }

    io.to(`game-${gameId}`).emit('player-split-hit', {
      playerId: socket.user.id,
      playerName: playerState.name,
      newCard: cardToWeb(newCard),
      splitScore: playerState.splitScore,
      splitStatus: playerState.splitStatus
    });

    if (playerState.splitScore > 21) {
      addChatMessage && console.log(`💥 ${playerState.name} bust sulla seconda mano`);
      nextPlayerTurn(gameId, io);
    } else {
      setPlayerTurnTimeout(gameId, socket.user.id, io);
    }
  });

  // EVENTO: Mossa generica (double down, split, etc.)
  socket.on('blackjack-move', (data) => {
    const { gameId, type, details } = data;
    
    if (!gameId || !type) return;
    
    const blackjackGame = getBlackjackGame(gameId);
    if (!blackjackGame) return;
    
    const playerState = blackjackGame.players.find(p => p.id === socket.user.id);
    if (!playerState) return;

    // Registra la mossa nel database
    addMoveToGame(gameId, socket.user.id, {
      type: type,
      playerName: playerState.name,
      details: details,
      timestamp: new Date().toISOString()
    });
    
    // Notifica a tutti sulla partita
    io.to(`game-${gameId}`).emit('player-move', {
      playerId: socket.user.id,
      playerName: playerState.name,
      moveType: type,
      moveDetails: details
    });
    
    console.log(`🎮 ${playerState.name} - ${type}: ${JSON.stringify(details)}`);
  });

  // Disconnessione
  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.user.username}`);
  });
});

// ========== DEALER & ROUND MANAGEMENT ==========

function completeDealerPlay(gameId, io) {
  const blackjackGame = getBlackjackGame(gameId);
  if (!blackjackGame) return;

  const dealerResult = completeDealerTurn(blackjackGame.dealerCards, blackjackGame.deck);
  blackjackGame.dealerCards = dealerResult.dealerCards;
  blackjackGame.dealerScore = dealerResult.dealerScore;

  // Determina i vincitori
  const results = [];
  for (let player of blackjackGame.players) {
    // Mano principale
    if (player.status === 'bust') {
      results.push({
        playerId: player.id,
        playerName: player.name,
        result: 'bust',
        message: `${player.name} ha sforato (BUST) - Perso $${player.bet}`,
        winnings: 0,
        finalBalance: player.balance,
        playerScore: player.score,
        dealerScore: blackjackGame.dealerScore
      });
    } else {
      const winner = determineWinner(player.score, blackjackGame.dealerScore);
      const winnings = player.bet * winner.multiplier;
      player.balance += winnings;

      let chatMessage = '';
      if (blackjackGame.dealerScore > 21) {
        chatMessage = `💥 Banco bust! ${player.name} ha vinto $${winnings} (punteggio: ${player.score})`;
      } else if (winner.result === 'win') {
        chatMessage = `🏆 ${player.name} ha vinto $${winnings}! (${player.score} vs banco ${blackjackGame.dealerScore})`;
      } else if (winner.result === 'lose') {
        chatMessage = `💸 ${player.name} ha perso $${player.bet} (${player.score} vs banco ${blackjackGame.dealerScore})`;
      } else if (winner.result === 'push') {
        chatMessage = `🤝 ${player.name} pareggio - Puntata restituita (${player.score} vs banco ${blackjackGame.dealerScore})`;
      }

      results.push({
        playerId: player.id,
        playerName: player.name,
        result: winner.result,
        message: chatMessage,
        winnings,
        finalBalance: player.balance,
        playerScore: player.score,
        dealerScore: blackjackGame.dealerScore
      });
    }

    // Seconda mano dello split
    if (player.splitHand && player.splitHand.length > 0) {
      if (player.splitStatus === 'bust') {
        results.push({
          playerId: player.id,
          playerName: player.name,
          result: 'bust',
          message: `${player.name} ha sforato sulla 2a mano (BUST) - Perso $${player.splitBet}`,
          winnings: 0,
          finalBalance: player.balance,
          playerScore: player.splitScore,
          dealerScore: blackjackGame.dealerScore,
          isSplitHand: true
        });
      } else {
        const splitWinner = determineWinner(player.splitScore, blackjackGame.dealerScore);
        const splitWinnings = player.splitBet * splitWinner.multiplier;
        player.balance += splitWinnings;

        let splitMessage = '';
        if (blackjackGame.dealerScore > 21) {
          splitMessage = `💥 Banco bust! ${player.name} vince anche sulla 2a mano $${splitWinnings}`;
        } else if (splitWinner.result === 'win') {
          splitMessage = `🏆 ${player.name} ha vinto $${splitWinnings} sulla 2a mano! (${player.splitScore} vs banco ${blackjackGame.dealerScore})`;
        } else if (splitWinner.result === 'lose') {
          splitMessage = `💸 ${player.name} ha perso $${player.splitBet} sulla 2a mano (${player.splitScore} vs banco ${blackjackGame.dealerScore})`;
        } else if (splitWinner.result === 'push') {
          splitMessage = `🤝 ${player.name} pareggio sulla 2a mano - Puntata restituita`;
        }

        results.push({
          playerId: player.id,
          playerName: player.name,
          result: splitWinner.result,
          message: splitMessage,
          winnings: splitWinnings,
          finalBalance: player.balance,
          playerScore: player.splitScore,
          dealerScore: blackjackGame.dealerScore,
          isSplitHand: true
        });
      }
    }
  }

  // Invia i risultati finali
  io.to(`game-${gameId}`).emit('round-complete', {
    dealerCards: blackjackGame.dealerCards.map(cardToWeb),
    dealerScore: blackjackGame.dealerScore,
    results,
    dealerBust: blackjackGame.dealerScore > 21,
    summaryMessages: results.map(r => r.message)
  });

  console.log(`🏁 Round complete for game ${gameId}`);

  // Avvia il prossimo round dopo 8 secondi
  setTimeout(() => {
    startNextRound(gameId, io);
  }, 8000);
}

function startNextRound(gameId, io) {
  const blackjackGame = getBlackjackGame(gameId);
  if (!blackjackGame) return;

  // Rimuovi i giocatori senza saldo
  blackjackGame.players = blackjackGame.players.filter(p => p.balance > 0);

  // Promuovi gli spettatori a giocatori
  const pendingSpectators = spectators[gameId] || [];
  for (let spectator of pendingSpectators) {
    blackjackGame.players.push({
      id: spectator.id,
      name: spectator.name,
      balance: spectator.balance,
      bet: 0,
      cards: [],
      score: 0,
      status: 'betting',
      round: blackjackGame.round + 1,
      turnOrder: blackjackGame.players.length
    });
  }
  spectators[gameId] = [];

  // Se non ci sono più giocatori, chiudi la partita
  if (blackjackGame.players.length === 0) {
    deleteGame(gameId);
    deleteBlackjackGame(gameId);
    io.to(`game-${gameId}`).emit('game-closed', {
      message: '🏁 Nessun giocatore rimasto. Partita chiusa.',
      gameId,
      timestamp: new Date().toISOString()
    });
    console.log(`🗑️ Game ${gameId} closed - no players left`);
    return;
  }

  // Reset per il nuovo round
  blackjackGame.round = (blackjackGame.round || 1) + 1;
  blackjackGame.deck = createDeck();
  blackjackGame.dealerCards = [];
  blackjackGame.dealerScore = 0;
  blackjackGame.status = 'betting';
  blackjackGame.bettingRound = true;
  blackjackGame.currentPlayerTurn = 0;

  for (let player of blackjackGame.players) {
    player.bet = 0;
    player.cards = [];
    player.score = 0;
    player.status = 'betting';
    if (player.splitHand) delete player.splitHand;
    if (player.splitBet) delete player.splitBet;
    if (player.splitScore) delete player.splitScore;
  }

  // Notifica tutti del nuovo round
  io.to(`game-${gameId}`).emit('new-round', {
    round: blackjackGame.round,
    players: blackjackGame.players.map(p => ({
      id: p.id,
      name: p.name,
      balance: p.balance
    })),
    message: `🔄 Round ${blackjackGame.round} inizia! Piazza le tue scommesse.`
  });

  console.log(`🔄 Round ${blackjackGame.round} started for game ${gameId} with ${blackjackGame.players.length} players`);
}

// ========= START SERVER ==========
server.listen(PORT, () => {
  console.log(`Game API server running on port ${PORT}`);
  console.log(`API Documentation: http://localhost:${PORT}/api-docs`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`WebSocket enabled on: ws://localhost:${PORT}`);
});