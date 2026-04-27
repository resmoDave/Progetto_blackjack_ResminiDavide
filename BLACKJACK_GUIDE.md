# Guida al Blackjack Multiplayer

## Architettura del Sistema

Il blackjack multiplayer utilizza:
- **`gameData`**: Memorizza lo stato completo della partita nel database
- **`moves`**: Registra le azioni di ogni giocatore (cronologia)
- **Turni sequenziali**: Ogni giocatore gioca uno per volta in ordine

---

## Fasi della Partita

1. **Dealing** - Le carte iniziali vengono distribuite
2. **Playing** - I giocatori giocano uno per volta (nel loro turno)
3. **DealerTurn** - Tutti i giocatori hanno finito, il dealer gioca
4. **Finished** - I risultati sono stati calcolati

---

## Distribuzione delle Carte

### Come Funziona

```
FASE 1: Creazione del Mazzo
├─ Generiamo un mazzo standard (52 carte)
├─ Le carte: A (11/1), 2-10, J (10), Q (10), K (10)
└─ Shuffliamo il mazzo randomicamente (Fisher-Yates)

FASE 2: Distribuzione Iniziale
├─ Ogni giocatore riceve 2 carte (pop dal deck)
├─ Il dealer riceve 2 carte (pop dal deck)
└─ Le carte vengono distribuite una per volta ai giocatori

FASE 3: Durante il Gioco
├─ Quando un giocatore fa "hit"
│  └─ Pop una carta dal mazzo e aggiungila al player
├─ Quando il dealer gioca
│  └─ Pop carte dal mazzo fino a 17+ punti
└─ Il mazzo rimane lo stesso per la partita intera
```

### Struttura dati il Mazzo

```javascript
const deck = [
  { value: 'A', suit: '♠' },
  { value: 'K', suit: '♥' },
  { value: '7', suit: '♣' },
  // ... altre 49 carte
]
```

### Algoritmo di Shuffle (Fisher-Yates)

```javascript
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        // Scambia deck[i] con deck[j]
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}
```

Questo garantisce che il mazzo sia veramente randomico (ogni permutazione ha uguale probabilità).

---

## Stato del Gioco (gameData)

```javascript
{
  phase: 'playing',           // dealing | playing | dealerTurn | finished
  currentPlayerIndex: 1,      // Quale giocatore sta giocando
  deck: [ ... ],              // Mazzo rimanente
  
  dealer: {
    cards: [
      { value: 'K', suit: '♠' },
      { value: '5', suit: '♥' }
    ],
    score: 15
  },
  
  players: [
    {
      id: 'user-1',
      name: 'Marco',
      cards: [ ... ],
      score: 18,
      status: 'playing',      // playing | stand | bust | finished
      actions: [
        { action: 'hit', cards: 3, score: 18, timestamp: '...' }
      ],
      bet: 100
    },
    {
      id: 'user-2',
      name: 'Giovanni',
      cards: [ ... ],
      score: 22,
      status: 'bust',
      actions: [ ... ],
      bet: 100
    }
  ],
  
  history: [
    { playerId: 'user-1', playerName: 'Marco', action: 'hit', newScore: 18 },
    { playerId: 'user-1', playerName: 'Marco', action: 'stand', finalScore: 18 }
  ]
}
```

---

## Sequenza di Gioco

### All'inizio della partita:

```
POST /games/:gameId/blackjack/start
Body: {}
Response: {
  gameData: { phase: 'playing', currentPlayerIndex: 0, ... }
}
```

**Lo stato gameData viene:**
1. Creato con `createMultiplayerGameState(players)`
2. Salvato nel database con `updateGameData(gameId, gameData)`
3. Visibile a tutti i giocatori con `getGameView(gameData, playerId)`

### Durante il turno di un giocatore:

```
POST /games/:gameId/blackjack/play/:playerId
Body: { action: 'hit' }  // hit | stand | double

Validazioni:
├─ È il turno di questo giocatore?
├─ Sono nella fase 'playing'?
└─ L'azione è valida per questo stato?

Risposta:
├─ Nuovo stato gameData (aggiornato nel DB)
├─ Passa il turno al prossimo giocatore
└─ Se è l'ultimo giocatore → passa a dealerTurn
```

### Turno del Dealer:

```
Il dealer NON fa scelte: segue sempre le stesse regole
├─ Se score < 17 → deve prendere una carta (HIT)
├─ Se score ≥ 17 → si ferma (STAND)
└─ Soft 17 (17 con un asso come 11) → HIT
```

### Fine della partita:

```
Calcolo risultati per ogni giocatore:
├─ Giocatore Bust (>21) → PERDI
├─ Dealer Bust e Giocatore ≤21 → VINCI
├─ Giocatore > Dealer → VINCI
├─ Giocatore = Dealer → PAREGGIO (PUSH)
└─ Giocatore < Dealer → PERDI
```

---

## Visibilità dei Dati

### Cosa vede ogni giocatore:

```javascript
getGameView(gameData, playerId) restituisce:
{
  myCards: [tutte le mie carte],
  myScore: 18,
  myStatus: 'playing',
  
  dealerCards: [carta1, '?'],  // ?? nascosta fino alla fine
  dealerScore: null,            // null fino alla fine
  
  players: [
    {
      id: 'user-2',
      name: 'Giovanni',
      cards: 3,                 // Solo il NUMERO di carte, non quali
      score: 22,
      status: 'bust',
      actions: [                // Tutte le azioni visibili
        { action: 'hit', cards: 3, score: 22 }
      ],
      isCurrentPlayer: false
    }
  ],
  
  history: [...]  // Cronologia pubblica
}
```

**Privacy:**
- Vedi tutte le carte dei tuoi perché è il tuo gioco
- Vedi quante carte hanno gli altri, ma non quali (solo il numero)
- Vedi tutte le azioni degli altri (trasparenza)
- La seconda carta del dealer rimane nascosta finché la partita non finisce

---

## Flusso dei Turni

```
INIZIO PARTITA
    ↓
currentPlayerIndex = 0 (primo giocatore)
    ↓
TURNO GIOCATORE 0
  - Vede: è suo turno, le sue carte, gli altri giocatori
  - Sceglie: hit/stand/double
  - Risultato: mano aggiornata, if bust/stand → prossimo
    ↓
TURNO GIOCATORE 1
  - Stessi step
    ↓
TURNO GIOCATORE 2
  - Stessi step
    ↓
TUTTI HANNO FINITO
    ↓
TURNO DEALER
  - Il backend esegue: completeDealerTurnMultiplayer()
  - Dealer prende carte finché < 17
  - Calcola i risultati per ogni giocatore
  - gameData.phase = 'finished'
    ↓
FINE PARTITA
  - Tutti vedono i risultati
  - Sanno chi ha vinto/perso/pareggiato
```

---

## Implementazione negli Endpoints

Avremo bisogno di:

```javascript
// Inizia una partita di blackjack
POST /games/:gameId/blackjack/start

// Esegui un'azione durante il tuo turno
POST /games/:gameId/blackjack/play/:playerId
Body: { action: 'hit' | 'stand' | 'double' }

// Ottieni lo stato del gioco (current player vede solo i dati a lui visibili)
GET /games/:gameId/blackjack/view

// Finalisza la partita (il dealer gioca, calcolo risultati)
POST /games/:gameId/blackjack/finish-dealer-turn
```

---

## Tipi di Carte

Attualmente usiamo carte standard:

```javascript
SUITS = ['♠', '♥', '♣', '♦']  // Spade, Hearts, Clubs, Diamonds
VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

// Web-friendly conversion:
CARD_SYMBOLS = {
    '♠': 'S',
    '♥': 'H',
    '♣': 'C',
    '♦': 'D'
}

// Esempio: Asso di Spade = { value: 'A', suit: '♠' }
```

Quando volrai rimpiazzarle, dovrai solo modificare `SUITS` e `VALUES` nel file `blackjack.js`.

---

## Calcolo dei Punteggi

```javascript
calculateScore(cards) {
  1. Contiamo i numeri normalmente (2-10)
  2. J, Q, K = 10
  3. A = 11
  
  4. Se il totale > 21 e abbiamo assi = 11:
     Convertiamo gli assi da 11 a 1 uno per uno
     Finché il totale è ≤ 21 o finiti gli assi
  
  Esempi:
  - [A, 9] → 20 (11 + 9)
  - [A, A, 9] → 21 (11 + 1 + 9)
  - [K, Q, 3] → BUST (10 + 10 + 3 = 23)
  - [A, K, 5] → 16 (1 + 10 + 5)
}
```

