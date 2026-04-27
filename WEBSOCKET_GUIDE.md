# 💬 WebSocket Chat & Game Events Guide

## 🚀 Come Usare la Chat in Tempo Reale

Il progetto ora supporta WebSocket con Socket.IO per comunicazione real-time tra giocatori nella lobby.

---

## 📋 Setup Iniziale

### 1. **Avvia il Server**
```bash
npm start
```

Il server sarà disponibile su `ws://localhost:3000`

### 2. **Client HTML/JavaScript**

```html
<script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>

<script>
  // Connettiti al server WebSocket
  const socket = io('http://localhost:3000', {
    auth: {
      token: localStorage.getItem('apiKey')  // La tua apiKey ottenuta al login
    }
  });

  const gameId = '123abc';  // L'ID della partita

  // ========== EVENTI DEL CLIENT ==========

  // 1. Entra nella lobby
  socket.emit('join-lobby', gameId);

  // 2. Invia un messaggio
  function sendMessage(text) {
    socket.emit('send-message', { gameId, text });
  }

  // 3. Esci dalla lobby
  function leaveLobby() {
    socket.emit('leave-lobby', gameId);
  }

  // 4. Host avvia la partita
  function startGame() {
    socket.emit('game-started', gameId);
  }

  // ========== ASCOLTI GLI EVENTI ==========

  // Quando qualcuno entra in lobby
  socket.on('player-joined', (data) => {
    console.log(`${data.username} è entrato in lobby`);
    console.log('Giocatori attuali:', data.players);
    // Aggiorna l'UI con la lista dei giocatori
  });

  // Ricevi un nuovo messaggio
  socket.on('new-message', (message) => {
    console.log(`${message.username}: ${message.text}`);
    // Aggiungi il messaggio alla chat UI
    const li = document.createElement('li');
    li.textContent = `${message.username}: ${message.text}`;
    document.getElementById('messages').appendChild(li);
  });

  // Quando qualcuno esce
  socket.on('player-left', (data) => {
    console.log(`${data.username} ha abbandonato la lobby`);
    console.log('Giocatori rimasti:', data.players);
  });

  // La partita è iniziata!
  socket.on('start-game', (data) => {
    console.log('🎮 La partita è iniziata!');
    // Nascondi la lobby, mostra il gioco
    document.getElementById('lobby').style.display = 'none';
    document.getElementById('game').style.display = 'block';
  });

  // Errore di connessione
  socket.on('connect_error', (error) => {
    console.error('Errore WebSocket:', error.message);
  });
</script>
```

---

## 🎯 Flusso Completo di una Sessione

### **Timeline**

```
1️⃣  Mario si registra                    POST /register
    ↓
2️⃣  Ottiene apiKey

3️⃣  Mario crea una partita                POST /games
    ✅ Riceve gameId = "abc123"

4️⃣  Mario si connette al WebSocket       socket.io connection
    ✅ Auth con apiKey

5️⃣  Mario entra nella lobby               socket.emit('join-lobby', gameId)
    ✅ Mario: 1/2 giocatori

6️⃣  Luigi si registra                     POST /register
    ✓ Ottiene apiKey

7️⃣  Luigi cerca la partita                GET /games/code/ABC123
    ✅ Trova la partita

8️⃣  Luigi entra nella partita             POST /games/abc123/players
    
9️⃣  Luigi si connette al WebSocket       socket.io connection
    ✅ Luigi: Auth con apiKey

🔟 Luigi entra nella lobby                socket.emit('join-lobby', gameId)
    ✅ Mario riceve: "Luigi è entrato" 🎉
    ✅ Luigi: 2/2 giocatori

1️⃣1️⃣ Luigi invia messaggio               socket.emit('send-message')
    ✅ Mario riceve il messaggio istantaneamente

1️⃣2️⃣ Mario avvia la partita              socket.emit('game-started', gameId)
                                          OPPURE
                                          POST /games/abc123/start
    ✅ Luigi riceve: "Game started" 🎮
    ✅ Partita inizia per entrambi!
```

---

## 📡 API REST per l'Avvio della Partita

Se preferisci usare REST al posto di WebSocket per avviare:

```bash
POST /games/:gameId/start
Headers:
  - x-api-key: mario_api_key

Risposta:
{
  "message": "Game started successfully!",
  "game": {
    "id": "abc123",
    "status": "in-progress",
    "players": [...]
  }
}
```

---

## 🔗 Eventi WebSocket Disponibili

### **Client → Server**

| Evento | Parametri | Descrizione |
|--------|-----------|-------------|
| `join-lobby` | `gameId` | Entra nella lobby |
| `send-message` | `{ gameId, text }` | Invia messaggio |
| `leave-lobby` | `gameId` | Esce dalla lobby |
| `game-started` | `gameId` | Host avvia la partita (solo owner!) |

### **Server → Client**

| Evento | Dati | Descrizione |
|--------|------|-------------|
| `player-joined` | `{ username, players, message }` | Qualcuno è entrato |
| `new-message` | `{ username, text, timestamp, userId }` | Nuovo messaggio chat |
| `player-left` | `{ username, players, message }` | Qualcuno è uscito |
| `start-game` | `{ gameId, message, timestamp }` | Partita avviato |

---

## 🧪 Test Rapido con cURL e Node

```bash
# Terminal 1: Avvia il server
npm start

# Terminal 2: Test con Node.js
node -e "
const io = require('socket.io-client');
const socket = io('http://localhost:3000', {
  auth: { token: 'your-api-key-here' }
});

socket.on('connect', () => {
  console.log('✅ Connesso!');
  socket.emit('join-lobby', 'game-123');
});

socket.on('player-joined', (data) => {
  console.log('👤 Qualcuno è entrato:', data);
});
"
```

---

## 🛡️ Sicurezza

- ✅ Autenticazione obbligatoria con apiKey
- ✅ Solo l'owner può avviare la partita
- ✅ CORS configurato per WebSocket
- ✅ Validazione input sui messaggi

---

## 🐛 Troubleshooting

### **Errore: "Invalid API key"**
```
✗ Non hai passato l'apiKey nel handshake
✓ Usa: { auth: { token: 'your-api-key' } }
```

### **Messaggio non arriva**
```
✗ Il gameId potrebbe essere sbagliato
✗ Potresti non essere nella stanza (join-lobby non chiamato)
✓ Verifica che join-lobby sia stato emesso
```

### **WebSocket non si connette**
```
✗ Server non in ascolto su port 3000
✓ Riavvia: npm start
```

---

Tutto pronto! 🚀 La chat è ora **real-time** e funziona perfettamente! 💬
