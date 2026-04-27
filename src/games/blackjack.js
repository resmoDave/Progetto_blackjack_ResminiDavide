/**
 * Blackjack Game Logic
 * Questa utility centralizza la logica del blackjack per il backend
 */

const SUITS = ['♠', '♥', '♣', '♦'];
const VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// Rappresentazione delle carte per il trasporto Web
const CARD_SYMBOLS = {
    '♠': 'S',  // Spade
    '♥': 'H',  // Hearts
    '♣': 'C',  // Clubs
    '♦': 'D'   // Diamonds
};

/**
 * Crea un mazzo di 52 carte
 * @returns {Array} Array di carte
 */
function createDeck() {
    let deck = [];
    for (let suit of SUITS) {
        for (let value of VALUES) {
            deck.push({ value, suit });
        }
    }
    // Shuffle del mazzo (Fisher-Yates shuffle)
    return shuffleDeck(deck);
}

/**
 * Algoritmo Fisher-Yates per shufflare il mazzo
 * @param {Array} deck - Mazzo da shufflare
 * @returns {Array} Mazzo shufflato
 */
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

/**
 * Calcola il punteggio di una mano di carte
 * @param {Array} cards - Array di carte
 * @returns {Object} { score: numero, softScore: boolean }
 */
function calculateScore(cards) {
    let score = 0;
    let aces = 0;

    // Prima passa: conta gli assi come 11
    for (let card of cards) {
        if (card.value === 'A') {
            aces++;
            score += 11;
        } else if (['J', 'Q', 'K'].includes(card.value)) {
            score += 10;
        } else {
            score += parseInt(card.value);
        }
    }

    // Seconda passa: converte gli assi da 11 a 1 se bust
    let usedAces = 0;
    while (score > 21 && usedAces < aces) {
        score -= 10;
        usedAces++;
    }

    return {
        score,
        softScore: (usedAces < aces) // Se ha assi come 11, è "soft"
    };
}

/**
 * Determina il vincitore tra giocatore e banco
 * @param {number} playerScore - Punteggio del giocatore
 * @param {number} dealerScore - Punteggio del banco
 * @returns {Object} { result: 'win'|'lose'|'push', message: string }
 */
function determineWinner(playerScore, dealerScore) {
    // Giocatore bust
    if (playerScore > 21) {
        return {
            result: 'bust',
            message: 'Hai sforato (BUST) - Hai perso!',
            multiplier: 0
        };
    }

    // Banco bust
    if (dealerScore > 21) {
        return {
            result: 'win',
            message: 'Il banco ha sforato (BUST) - Hai vinto!',
            multiplier: 2
        };
    }

    // Entrambi sono validi, confronta
    if (playerScore > dealerScore) {
        return {
            result: 'win',
            message: 'Hai vinto!',
            multiplier: 2
        };
    } else if (playerScore < dealerScore) {
        return {
            result: 'lose',
            message: 'Il banco ha vinto!',
            multiplier: 0
        };
    } else {
        return {
            result: 'push',
            message: 'Pareggio (Push)!',
            multiplier: 1
        };
    }
}

/**
 * Verifica se è blackjack (21 con 2 carte)
 * @param {Array} cards - Array di carte
 * @returns {boolean}
 */
function isBlackjack(cards) {
    if (cards.length !== 2) return false;
    const score = calculateScore(cards).score;
    return score === 21;
}

/**
 * Verifica se il giocatore può fare split
 * @param {Array} cards - Array di carte del giocatore
 * @returns {boolean}
 */
function canSplit(cards) {
    if (cards.length !== 2) return false;
    return cards[0].value === cards[1].value;
}

/**
 * Verifica se il giocatore può fare double down
 * @param {Array} cards - Array di carte del giocatore
 * @param {number} playerBalance - Saldo del giocatore
 * @param {number} currentBet - Scommessa attuale
 * @returns {boolean}
 */
function canDouble(cards, playerBalance, currentBet) {
    if (cards.length !== 2) return false;
    return playerBalance >= currentBet;
}

/**
 * Converte una carta al formato Web-friendly
 * @param {Object} card - Carta
 * @returns {Object} Carta in formato Web
 */
function cardToWeb(card) {
    return {
        value: card.value,
        suit: CARD_SYMBOLS[card.suit],
        display: card.value + card.suit
    };
}

/**
 * Crea uno stato iniziale di gioco SINGLE PLAYER (legacy)
 * @returns {Object} Stato del gioco
 */
function createGameState() {
    const deck = createDeck();
    return {
        deck,
        dealerCards: [deck.pop(), deck.pop()],
        playerCards: [deck.pop(), deck.pop()],
        gameOver: false,
        playerBust: false,
        dealerBust: false,
        isBlackjack: false,
        result: null
    };
}

/**
 * Crea uno stato iniziale per una partita MULTIPLAYER di blackjack
 * @param {Array} players - Array di giocatori { id, name }
 * @returns {Object} Stato del gioco multiplayer
 */
function createMultiplayerGameState(players) {
    if (!players || players.length === 0) {
        throw new Error('Must have at least one player');
    }

    const deck = createDeck();
    const gameState = {
        phase: 'dealing', // dealing, playing, dealerTurn, finished
        currentPlayerIndex: 0, // Indice del giocatore di cui è il turno
        deck,
        dealer: {
            cards: [deck.pop(), deck.pop()],
            score: null
        },
        players: players.map(player => ({
            id: player.id,
            name: player.name,
            cards: [deck.pop(), deck.pop()],
            score: null,
            status: 'playing', // playing, stand, bust, finished
            actions: [], // Cronologia delle azioni (hit, stand, double, split)
            bet: 100 // Default bet, modificabile
        })),
        history: [], // Cronologia di tutte le mosse
        startedAt: new Date().toISOString(),
        completedAt: null
    };

    // Calcola i punteggi iniziali
    gameState.players.forEach(p => {
        p.score = calculateScore(p.cards).score;
    });
    gameState.dealer.score = calculateScore(gameState.dealer.cards).score;

    return gameState;
}

/**
 * Esegue una mossa di un giocatore
 * @param {Object} gameState - Stato del gioco
 * @param {string} playerId - ID del giocatore che fa la mossa
 * @param {string} action - Tipo di azione: 'hit', 'stand', 'double', 'split'
 * @returns {Object} { success: boolean, gameState: Object, message: string }
 */
function playerMove(gameState, playerId, action) {
    // Verifica che sia il turno del giocatore corretto
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    
    if (currentPlayer.id !== playerId) {
        return {
            success: false,
            message: `Not your turn. Waiting for ${currentPlayer.name}`,
            move: null
        };
    }

    if (gameState.phase !== 'playing') {
        return {
            success: false,
            message: `Cannot play during ${gameState.phase} phase`,
            move: null
        };
    }

    const playerIndex = gameState.currentPlayerIndex;
    const player = gameState.players[playerIndex];
    const timestamp = new Date().toISOString();
    let moveData = null;

    switch (action) {
        case 'hit': {
            player.cards.push(gameState.deck.pop());
            player.score = calculateScore(player.cards).score;
            player.actions.push({ action: 'hit', cards: player.cards.length, score: player.score, timestamp });
            gameState.history.push({ playerId, playerName: player.name, action: 'hit', newScore: player.score });

            // Crea l'oggetto move per il salvataggio in game.moves
            moveData = {
                playerId,
                playerName: player.name,
                action: 'hit',
                details: {
                    cardCount: player.cards.length,
                    score: player.score
                },
                timestamp
            };

            if (player.score > 21) {
                player.status = 'bust';
                const nextResult = moveToNextPlayer(gameState);
                return { ...nextResult, move: moveData };
            }
            return { success: true, gameState, message: `${player.name} hit. Score: ${player.score}`, move: moveData };
        }

        case 'stand': {
            player.status = 'stand';
            player.actions.push({ action: 'stand', finalScore: player.score, timestamp });
            gameState.history.push({ playerId, playerName: player.name, action: 'stand', finalScore: player.score });

            moveData = {
                playerId,
                playerName: player.name,
                action: 'stand',
                details: {
                    finalScore: player.score
                },
                timestamp
            };

            const nextResult = moveToNextPlayer(gameState);
            return { ...nextResult, move: moveData };
        }

        case 'double': {
            if (player.cards.length !== 2) {
                return { success: false, message: 'Can only double on first 2 cards', move: null };
            }
            player.bet *= 2;
            player.cards.push(gameState.deck.pop());
            player.score = calculateScore(player.cards).score;
            player.actions.push({ action: 'double', cards: player.cards.length, score: player.score, newBet: player.bet, timestamp });
            gameState.history.push({ playerId, playerName: player.name, action: 'double', newScore: player.score });

            moveData = {
                playerId,
                playerName: player.name,
                action: 'double',
                details: {
                    cardCount: player.cards.length,
                    score: player.score,
                    newBet: player.bet
                },
                timestamp
            };

            if (player.score > 21) {
                player.status = 'bust';
            } else {
                player.status = 'stand'; // Dopo double, il giocatore non può più effettuare azioni
            }
            const nextResult = moveToNextPlayer(gameState);
            return { ...nextResult, move: moveData };
        }

        default:
            return { success: false, message: 'Unknown action', move: null };
    }
}

/**
 * Sposta al prossimo giocatore o al turno del dealer
 * @param {Object} gameState - Stato del gioco
 * @returns {Object} { success: boolean, gameState: Object, message: string }
 */
function moveToNextPlayer(gameState) {
    gameState.currentPlayerIndex++;

    // Verifica se ci sono ancora giocatori che devono giocare
    if (gameState.currentPlayerIndex >= gameState.players.length) {
        // Tutti hanno giocato, inizia il turno del dealer
        gameState.phase = 'dealerTurn';
        return {
            success: true,
            gameState,
            message: 'All players have finished. Dealer\'s turn now.'
        };
    }

    const nextPlayer = gameState.players[gameState.currentPlayerIndex];
    if (nextPlayer.status === 'playing') {
        return {
            success: true,
            gameState,
            message: `It's ${nextPlayer.name}'s turn`
        };
    } else {
        // Questo giocatore ha già finito, salta al prossimo
        return moveToNextPlayer(gameState);
    }
}

/**
 * Completa il turno del dealer e determina i vincitori
 * @param {Object} gameState - Stato del gioco
 * @returns {Object} { gameState: Object, results: Array }
 */
function completeDealerTurnMultiplayer(gameState) {
    let dealerScore = gameState.dealer.score;

    // Dealer hits on soft 17 (17 con un asso contato come 11)
    while (dealerScore < 17) {
        gameState.dealer.cards.push(gameState.deck.pop());
        const scoreObj = calculateScore(gameState.dealer.cards);
        dealerScore = scoreObj.score;
        gameState.dealer.score = dealerScore;
    }

    // Determina i risultati per ogni giocatore
    const results = gameState.players.map(player => {
        const result = determineWinner(player.score, dealerScore);
        return {
            playerId: player.id,
            playerName: player.name,
            playerScore: player.score,
            dealerScore: dealerScore,
            ...result
        };
    });

    gameState.phase = 'finished';
    gameState.completedAt = new Date().toISOString();

    return { gameState, results };
}

/**
 * Ottiene lo stato visibile del gioco (cosa vede un giocatore)
 * @param {Object} gameState - Stato completo del gioco
 * @param {string} viewerId - ID del giocatore che vede
 * @returns {Object} Stato visibile
 */
function getGameView(gameState, viewerId) {
    const viewer = gameState.players.find(p => p.id === viewerId);
    
    return {
        phase: gameState.phase,
        currentPlayerIndex: gameState.currentPlayerIndex,
        currentPlayerName: gameState.phase === 'playing' ? gameState.players[gameState.currentPlayerIndex].name : null,
        myCards: viewer ? viewer.cards : [],
        myScore: viewer ? viewer.score : null,
        myStatus: viewer ? viewer.status : null,
        myBet: viewer ? viewer.bet : null,
        dealerCards: gameState.phase === 'finished' ? gameState.dealer.cards : [gameState.dealer.cards[0], '?'], // Hide dealer's second card until end
        dealerScore: gameState.phase === 'finished' ? gameState.dealer.score : null,
        players: gameState.players.map((p, idx) => ({
            id: p.id,
            name: p.name,
            cards: p.cards.length, // Solo il numero di carte (privacy)
            score: p.score,
            status: p.status,
            actions: p.actions,
            isCurrentPlayer: idx === gameState.currentPlayerIndex && gameState.phase === 'playing'
        })),
        history: gameState.history
    };
}

/**
 * Completa il turno del banco (dealer stands on 17 or higher)
 * @param {Array} dealerCards - Carte del banco
 * @param {Array} deck - Mazzo di carte
 * @returns {Object} { dealerCards: Array, dealerScore: number }
 */
function completeDealerTurn(dealerCards, deck) {
    let dealerScore = calculateScore(dealerCards).score;

    while (dealerScore < 17) {
        dealerCards.push(deck.pop());
        dealerScore = calculateScore(dealerCards).score;
    }

    return {
        dealerCards,
        dealerScore
    };
}

export {
    SUITS,
    VALUES,
    CARD_SYMBOLS,
    createDeck,
    shuffleDeck,
    calculateScore,
    determineWinner,
    isBlackjack,
    canSplit,
    canDouble,
    cardToWeb,
    createGameState,
    createMultiplayerGameState,
    completeDealerTurn,
    completeDealerTurnMultiplayer,
    playerMove,
    moveToNextPlayer,
    getGameView
};
