import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../../data');
const gamesFile = path.join(dataDir, 'games.json');
const USERS_COLLECTION_ID = 'RaccoltaUtenti';

// Initialize data directory and files
const initializeDb = () => {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (!fs.existsSync(gamesFile)) {
    fs.writeFileSync(gamesFile, JSON.stringify({ games: [] }, null, 2));
  }
  // Ensure users collection exists
  ensureUsersCollectionExists();
};

const readData = () => {
  try {
    const data = JSON.parse(fs.readFileSync(gamesFile, 'utf8'));
    // Ensure structure
    if (!data.games) data.games = [];
    return data;
  } catch {
    return { games: [] };
  }
};

const writeData = (data) => {
  fs.writeFileSync(gamesFile, JSON.stringify(data, null, 2));
};

// Helper function: Get or create users collection
const ensureUsersCollectionExists = () => {
  const data = readData();
  const usersCollection = data.games.find(g => g.id === USERS_COLLECTION_ID);
  
  if (!usersCollection) {
    const newCollection = {
      id: USERS_COLLECTION_ID,
      name: USERS_COLLECTION_ID,
      users: []
    };
    data.games.unshift(newCollection);
    writeData(data);
  }
};

// Helper function: Get users collection
const getUsersCollection = () => {
  const data = readData();
  let usersCollection = data.games.find(g => g.id === USERS_COLLECTION_ID);
  
  if (!usersCollection) {
    usersCollection = {
      id: USERS_COLLECTION_ID,
      name: USERS_COLLECTION_ID,
      users: []
    };
    data.games.unshift(usersCollection);
    writeData(data);
  }
  
  return usersCollection.users || [];
};

// Helper function: Save users collection
const saveUsersCollection = (users) => {
  const data = readData();
  const collectionIndex = data.games.findIndex(g => g.id === USERS_COLLECTION_ID);
  
  if (collectionIndex !== -1) {
    data.games[collectionIndex].users = users;
  } else {
    data.games.unshift({
      id: USERS_COLLECTION_ID,
      name: USERS_COLLECTION_ID,
      users
    });
  }
  
  writeData(data);
};

const readGames = () => {
  const data = readData();
  // Return only actual games, exclude users collection
  return (data.games || []).filter(g => g.id !== USERS_COLLECTION_ID);
};

const writeGames = (games) => {
  const data = readData();
  // Preserve users collection
  const usersCollection = data.games.find(g => g.id === USERS_COLLECTION_ID);
  const otherGames = games.filter(g => g.id !== USERS_COLLECTION_ID);
  
  data.games = usersCollection ? [usersCollection, ...otherGames] : otherGames;
  writeData(data);
};

// User operations
export const registerUser = (username, password) => {
  const users = getUsersCollection();
  
  if (users.find(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('User already exists');
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  const hashedPassword = bcrypt.hashSync(password, 10);
  const apiKey = uuidv4() + uuidv4().replace(/-/g, '');
  const newUser = {
    id: uuidv4(),
    username,
    password: hashedPassword,
    apiKey,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveUsersCollection(users);
  return newUser;
};

export const getUserByApiKey = (apiKey) => {
  const users = getUsersCollection();
  return users.find(u => u.apiKey === apiKey);
};

export const getUserById = (userId) => {
  const users = getUsersCollection();
  return users.find(u => u.id === userId);
};

export const getUserByUsername = (username) => {
  const users = getUsersCollection();
  return users.find(u => u.username.toLowerCase() === username.toLowerCase());
};

// Game operations
export const createGame = (userId, gameName, creatorName, gameCode, gameData = null, solo = false) => {
  const games = readGames();
  
  const newGame = {
    id: uuidv4(),
    code: gameCode,
    name: gameName,
    ownerId: userId,
    solo: solo, // partita singleplayer, invisibile agli altri
    players: [
      {
        id: userId,
        name: creatorName,
        joinedAt: new Date().toISOString()
      }
    ],
    moves: [],
    messages: [],
    gameData: gameData || {},
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  games.push(newGame);
  writeGames(games);
  return newGame;
};

export const getGamesByUserId = (userId) => {
  const games = readGames();
  return games.filter(g => g.ownerId === userId);
};

export const getGameById = (gameId) => {
  const games = readGames();
  return games.find(g => g.id === gameId);
};

export const updateGame = (gameId, updates) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  
  if (!game) return null;
  
  Object.assign(game, updates, { updatedAt: new Date().toISOString() });
  writeGames(games);
  return game;
};

export const updateGameData = (gameId, gameData) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  
  if (!game) return null;
  
  game.gameData = gameData;
  game.updatedAt = new Date().toISOString();
  writeGames(games);
  return game;
};

export const deleteGame = (gameId) => {
  const games = readGames();
  const index = games.findIndex(g => g.id === gameId);
  
  if (index === -1) return false;
  
  games.splice(index, 1);
  writeGames(games);
  return true;
};

// Terminate game - removes all players and deletes the game
export const terminateGame = (gameId) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  
  if (!game) return { status: 'not-found' };
  
  const playerCount = game.players.length;
  const gameIndex = games.findIndex(g => g.id === gameId);
  
  if (gameIndex !== -1) {
    games.splice(gameIndex, 1);
    writeGames(games);
  }
  
  return { 
    status: 'terminated', 
    gameId, 
    playerCount,
    playerIds: game.players.map(p => p.id)
  };
};

// Player operations
export const addPlayerToGame = (gameId, userId, playerName) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  
  if (!game) return null;
  
  // Se il giocatore è già nella partita, restituisce il giocatore esistente (es. riconnessione da nuova scheda)
  const existingPlayer = game.players.find(p => p.id === userId);
  if (existingPlayer) {
    return existingPlayer;
  }
  
  const newPlayer = {
    id: userId,
    name: playerName,
    joinedAt: new Date().toISOString()
  };

  game.players.push(newPlayer);
  game.updatedAt = new Date().toISOString();
  writeGames(games);
  return newPlayer;
};

export const removePlayerFromGame = (gameId, playerId) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  
  if (!game) return { status: 'not-found' };
  
  const index = game.players.findIndex(p => p.id === playerId);
  if (index === -1) return { status: 'not-found' };

  // Se il proprietario lascia, ELIMINA la partita completamente
  if (game.ownerId === playerId) {
    const gameIndex = games.findIndex(g => g.id === gameId);
    if (gameIndex !== -1) {
      games.splice(gameIndex, 1);
      writeGames(games);
      return { status: 'deleted', gameId };
    }
  }
  
  // Altrimenti rimuovi solo il giocatore
  game.players.splice(index, 1);
  game.updatedAt = new Date().toISOString();
  
  // Se la partita rimane vuota, eliminala
  if (game.players.length === 0) {
    const gameIndex = games.findIndex(g => g.id === gameId);
    if (gameIndex !== -1) {
      games.splice(gameIndex, 1);
      writeGames(games);
      return { status: 'deleted', gameId, reason: 'empty' };
    }
  }
  
  writeGames(games);
  return { status: 'player-removed', game };
};

export const getGamePlayers = (gameId) => {
  const game = getGameById(gameId);
  return game ? game.players : [];
};

// Move operations
export const addMoveToGame = (gameId, playerId, moveData) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  
  if (!game) return null;
  
  const newMove = {
    id: uuidv4(),
    playerId,
    data: moveData,
    timestamp: new Date().toISOString()
  };

  game.moves.push(newMove);
  game.updatedAt = new Date().toISOString();
  writeGames(games);
  return newMove;
};

export const getGameMoves = (gameId) => {
  const game = getGameById(gameId);
  return game ? game.moves : [];
};

export const getRunningGames = () => {
  const games = readGames();
  // Escludi partite solo (private) e mostra solo quelle multiplayer attive
  return games.filter(g => (g.status === 'active' || g.status === 'waiting') && !g.solo);
};

export const getGameByCode = (code) => {
  const games = readGames();
  const upperCode = code.toUpperCase();
  return games.find(g => g.code === upperCode);
};

// Message operations
export const addMessageToGame = (gameId, userId, username, text) => {
  const games = readGames();
  const game = games.find(g => g.id === gameId);
  
  if (!game) return null;
  
  const newMessage = {
    id: uuidv4(),
    userId,
    username,
    text,
    timestamp: new Date().toISOString()
  };

  if (!game.messages) game.messages = [];
  game.messages.push(newMessage);
  game.updatedAt = new Date().toISOString();
  writeGames(games);
  return newMessage;
};

export const getGameMessages = (gameId) => {
  const game = getGameById(gameId);
  return game && game.messages ? game.messages : [];
};

// Initialize database on module load
initializeDb();