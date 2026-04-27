# 🛑 Game Leave System - Documentazione

## 📋 Comportamento

Quando un giocatore lascia una partita:

### **Se è l'HOST (Owner):**
- ❌ La partita viene **eliminata immediatamente**
- 🔔 **Tutti gli altri giocatori ricevono una notifica** in tempo reale
- 👋 Gli altri giocatori vengono **buttati fuori** dalla partita
- 📊 La partita scompare dalle partite disponibili

### **Se è un giocatore normale:**
- ✅ Il giocatore viene rimosso dalla lista
- 🔔 Gli altri giocatori ricevono una notifica
- ⏳ La partita continua a esistere (l'host rimane)

---

## 🎯 Casi d'Uso

### **Caso 1: Host Esce (Partita Eliminata)**

```
Timeline:
Mario (Host)    Luigi (Giocatore)
─────────────   ────────────────
In partita
                In partita
Mario esce
│
├─> Chiama: POST /games/:gameId/leave
│
├─> Database: Partita eliminata
│
└─> WebSocket: 'game-deleted' 
    inviato a Luigi
    
Luigi riceve:
{
  "message": "Mario (Host) ha abbandonato la partita. Partita eliminata! ❌",
  "gameId": "abc123",
  "kickedBy": "Mario",
  "deletedAt": "2026-04-13T10:00:00.000Z"
}

Luigi viene automaticamente buttato fuori ✈️
```

---

### **Caso 2: Giocatore Esce (Partita Continua)**

```
Timeline:
Mario (Host)    Luigi (Giocatore)
─────────────   ────────────────
In partita
                In partita
                Luigi esce
                │
                ├─> Chiama: POST /games/:gameId/leave
                │
                ├─> Database: Luigi rimosso dai players
                │
                └─> WebSocket: 'player-left' 
                    inviato a Mario
                    
Mario riceve:
{
  "username": "Luigi",
  "message": "Luigi ha abbandonato la partita",
  "players": [{"id": "mario-id", "name": "Mario"}],
  "playerCount": 1
}

La partita continua a esistere ✅
```

---

## 🌐 API REST

### **Lasciare una partita**

```bash
POST /games/:gameId/leave
Headers: x-api-key: <apiKey>

Risposta se è HOST:
{
  "message": "Game deleted and all players kicked out",
  "gameId": "abc123",
  "gameDeleted": true,
  "wasOwner": true
}

Risposta se è GIOCATORE:
{
  "message": "Successfully left the game",
  "gameDeleted": false,
  "game": { ... game data ... }
}
```

---

## 🔌 WebSocket Events

### **Server → Client**

#### `game-deleted` (quando l'host esce)
```javascript
socket.on('game-deleted', (data) => {
  console.log(data.message);  // "Mario (Host) ha abbandonato la partita..."
  console.log(data.kickedBy); // "Mario"
  // Azione: Redirect a home, mostra messaggio di errore
});
```

#### `player-left` (quando un giocatore normale esce)
```javascript
socket.on('player-left', (data) => {
  console.log(data.message);           // "Luigi ha abbandonato la partita"
  console.log(data.players);           // Lista giocatori rimasti
  console.log(data.playerCount);       // 1
  // Azione: Aggiorna lista giocatori, mostra notifica
});
```

---

## 💬 Client Implementation

```html
<script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>

<script>
  const socket = io('http://localhost:3000', {
    auth: { token: localStorage.getItem('apiKey') }
  });

  const gameId = '123abc';

  // ========== LASCIARE LA PARTITA ==========
  
  // Opzione 1: Via REST API
  async function leaveGame() {
    const response = await fetch(`/games/${gameId}/leave`, {
      method: 'POST',
      headers: {
        'x-api-key': localStorage.getItem('apiKey')
      }
    });
    const data = await response.json();
    if (data.gameDeleted) {
      // Partita eliminata, torna alla home
      window.location.href = '/';
    }
  }

  // Opzione 2: Via WebSocket (notifica gli altri in tempo reale)
  function leaveGameViaWebSocket() {
    socket.emit('leave-lobby', gameId);
    // Aspetta di ricevere game-deleted o player-left
  }

  // ========== ASCOLTA GLI EVENTI ==========

  // Quando l'host esce (sei buttato fuori!)
  socket.on('game-deleted', (data) => {
    console.error('🛑 La partita è stata eliminata!');
    console.log(data.message);
    
    // Mostra un alert all'utente
    alert(data.message);
    
    // Reindirizza alla home page
    window.location.href = '/';
  });

  // Quando un giocatore esce (partita continua)
  socket.on('player-left', (data) => {
    console.log(`👋 ${data.username} ha lasciato`);
    console.log(`Giocatori rimasti: ${data.playerCount}`);
    
    // Aggiorna l'UI con la nuova lista di giocatori
    updatePlayersList(data.players);
    
    // Mostra una notifica
    showNotification(data.message);
  });
</script>
```

---

## 🔒 Sicurezza

- ✅ Solo i giocatori nella partita possono lasciare
- ✅ Verifica autenticazione con apiKey
- ✅ Eliminazione cascata: se host esce, tutti gli altri vengono espulsi
- ✅ Messaggi sincronizzati in tempo reale via WebSocket

---

## 📊 Flusso Completo

```
                    Mario (Host)              Luigi (Player)
                    ────────────              ──────────────
1. Crea partita     POST /games  ✅
   status: active

2. Luigi entra      POST /games/:id/players                 
                                              Vede la partita ✅
                                              
3. Entrano lobby    socket.emit('join-lobby')
                    TUTTI ricevono: player-joined ✅        TUTTI ricevono: player-joined ✅

4. Chat...  
   
5. Mario esce       socket.emit('leave-lobby')
   │
   ├─> Sistema: removePlayerFromGame(gameId, marioId)
   ├─> Mario è owner → Elimina partita
   ├─> WebSocket: 'game-deleted' a Luigi
   │
   
6. Luigi riceve                                              Riceve: game-deleted 🛑
   notifica                                                  Alert: "Partita eliminata"
                                                             Redirect: / (home)

✅ PARTITA ELIMINATA
✅ LUIGI BUTTATO FUORI
✅ NOTIFICA ISTANTANEA
```

---

## 🧪 Test Rapido

```bash
# Terminal 1: Avvia server
npm start

# Terminal 2: Test
# 1. Crea account Mario
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"username":"mario","password":"pass123"}'
# Copia l'apiKey: mario_key_123

# 2. Crea account Luigi
curl -X POST http://localhost:3000/register \
  -H "Content-Type: application/json" \
  -d '{"username":"luigi","password":"pass123"}'
# Copia l'apiKey: luigi_key_123

# 3. Mario crea partita
curl -X POST http://localhost:3000/games \
  -H "x-api-key: mario_key_123" \
  -H "Content-Type: application/json" \
  -d '{"name":"Chess","playerName":"Mario","code":"ABC123"}'
# Copia gameId: abc123

# 4. Luigi entra
curl -X POST http://localhost:3000/games/abc123/players \
  -H "x-api-key: luigi_key_123" \
  -H "Content-Type: application/json" \
  -d '{"name":"Luigi"}'

# 5. Mario esce (partita eliminata!)
curl -X POST http://localhost:3000/games/abc123/leave \
  -H "x-api-key: mario_key_123"

Risposta:
{
  "message": "Game deleted and all players kicked out",
  "gameId": "abc123",
  "gameDeleted": true,
  "wasOwner": true
}

# 6. Verifica: Partita non esiste più
curl -X GET http://localhost:3000/games/available \
  -H "x-api-key: mario_key_123"
# La partita NON è più nella lista! ✅
```

---

Tutto pronto! 🎉
