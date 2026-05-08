const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'), (err) => {
        if (err) {
            console.error("ERROR: Could not find game.html", err);
            res.status(500).send("<h2>Error: game.html not found!</h2>");
        }
    });
});

// --- ROOM MANAGEMENT ---
const rooms = {}; 

const availableColors = [
    "bg-red-500", "bg-blue-500", "bg-green-500", "bg-yellow-400 text-slate-900",
    "bg-purple-500", "bg-cyan-400 text-slate-900", "bg-pink-500", "bg-orange-500"
];

function generateRoomCode() {
    let code;
    do {
        code = Math.random().toString(36).substring(2, 6).toUpperCase();
    } while (rooms[code]);
    return code;
}

// --- SOCKET CONNECTION ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', (playerName) => {
        const roomCode = generateRoomCode();
        socket.join(roomCode);
        socket.roomCode = roomCode; 

        rooms[roomCode] = {
            hostId: socket.id,
            gameState: {
                players: [{
                    id: socket.id, 
                    name: playerName,
                    balance: 15000,
                    position: 0,
                    skipTurns: 0,
                    loan: 0,
                    loanTurns: 0,
                    colorClass: availableColors[0]
                }], 
                currentPlayerIndex: 0,
                isAwaitingAction: false,
                maxPlayers: 8,
                gameStarted: false,
                roomCode: roomCode,
                boardOwnership: {} // FIX: Ownership is now synced globally!
            }
        };

        socket.emit('roomCreated', roomCode);
        io.to(roomCode).emit('gameStateUpdate', { gameState: rooms[roomCode].gameState, hostId: socket.id });
        io.to(roomCode).emit('toastMessage', { msg: `Room ${roomCode} created by ${playerName}.`, type: "success" });
    });

    socket.on('joinRoom', (data) => {
        const { roomCode, playerName } = data;
        const code = roomCode.toUpperCase();
        const room = rooms[code];

        if (!room) return socket.emit('toastMessage', { msg: "Invalid Room Code!", type: "error" });
        if (room.gameState.gameStarted) return socket.emit('toastMessage', { msg: "Game already in progress!", type: "error" });
        if (room.gameState.players.length >= room.gameState.maxPlayers) return socket.emit('toastMessage', { msg: "Room is full!", type: "error" });

        socket.join(code);
        socket.roomCode = code;

        const newPlayer = {
            id: socket.id, 
            name: playerName,
            balance: 15000,
            position: 0,
            skipTurns: 0,
            loan: 0,
            loanTurns: 0,
            colorClass: availableColors[room.gameState.players.length]
        };

        room.gameState.players.push(newPlayer);
        
        socket.emit('roomJoined', code);
        io.to(code).emit('gameStateUpdate', { gameState: room.gameState, hostId: room.hostId });
        io.to(code).emit('toastMessage', { msg: `${playerName} joined the room.`, type: "info" });
    });

    socket.on('kickPlayer', (targetId) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        
        const room = rooms[code];
        if (socket.id !== room.hostId) return;

        const playerIndex = room.gameState.players.findIndex(p => p.id === targetId);
        if (playerIndex !== -1) {
            const kickedPlayer = room.gameState.players[playerIndex];
            room.gameState.players.splice(playerIndex, 1);
            
            io.to(targetId).emit('kickedOut');
            io.sockets.sockets.get(targetId)?.leave(code);

            io.to(code).emit('gameStateUpdate', { gameState: room.gameState, hostId: room.hostId });
            io.to(code).emit('toastMessage', { msg: `${kickedPlayer.name} was kicked.`, type: "error" });
        }
    });

    socket.on('startGame', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        
        const room = rooms[code];
        if (socket.id !== room.hostId) return;
        if (room.gameState.players.length < 2) return;

        room.gameState.gameStarted = true;
        io.to(code).emit('gameStarted', room.gameState);
    });

    socket.on('requestDiceRoll', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        
        const room = rooms[code];
        const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex];
        
        if (!currentPlayer || socket.id !== currentPlayer.id || room.gameState.isAwaitingAction) return;

        const dice1 = Math.floor(Math.random() * 6) + 1;
        const dice2 = Math.floor(Math.random() * 6) + 1;
        io.to(code).emit('playDiceAnimation', { totalRoll: dice1 + dice2, newState: room.gameState });
    });

    // Forces immediate broadcast so players never desync
    socket.on('syncState', (newState) => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        rooms[code].gameState = newState;
        io.to(code).emit('gameStateUpdate', { gameState: rooms[code].gameState, hostId: rooms[code].hostId });
    });

    socket.on('broadcastToast', (data) => {
        const code = socket.roomCode;
        if (code) io.to(code).emit('toastMessage', data);
    });

    socket.on('endTurn', (newState) => {
         const code = socket.roomCode;
         if(!code || !rooms[code]) return;
         rooms[code].gameState = newState;
         io.to(code).emit('gameStateUpdate', { gameState: rooms[code].gameState, hostId: rooms[code].hostId });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;

        const room = rooms[code];
        
        if (socket.id === room.hostId && !room.gameState.gameStarted) {
            io.to(code).emit('toastMessage', { msg: "Host disconnected. Room closed.", type: "error" });
            io.to(code).emit('kickedOut');
            delete rooms[code];
        } else {
            const playerIndex = room.gameState.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                const name = room.gameState.players[playerIndex].name;
                room.gameState.players.splice(playerIndex, 1);
                io.to(code).emit('gameStateUpdate', { gameState: room.gameState, hostId: room.hostId });
                io.to(code).emit('toastMessage', { msg: `${name} disconnected.`, type: "error" });
                
                if (room.gameState.players.length === 0) {
                    delete rooms[code];
                }
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving files from: ${__dirname}`);
});
