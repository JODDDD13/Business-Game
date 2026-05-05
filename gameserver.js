const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); 

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 1. Tell Express to serve everything inside the "public" folder!
app.use(express.static(path.join(__dirname, 'public')));

// 2. When someone visits localhost:3000, send them game.html from the public folder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'game.html'), (err) => {
        if (err) {
            console.error("ERROR: Could not find game.html in the public folder", err);
            res.status(500).send("<h2>Error: game.html not found!</h2>");
        }
    });
});

// --- GLOBAL GAME STATE ---
let gameState = {
    players: [], 
    currentPlayerIndex: 0,
    isAwaitingAction: false,
    maxPlayers: 8,
    gameStarted: false
};

const availableColors = [
    "bg-red-500", "bg-blue-500", "bg-green-500", "bg-yellow-400 text-slate-900",
    "bg-purple-500", "bg-cyan-400 text-slate-900", "bg-pink-500", "bg-orange-500"
];

// --- SOCKET CONNECTION ---
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.emit('gameStateUpdate', gameState);

    socket.on('joinGame', (playerName) => {
        if (gameState.gameStarted) return socket.emit('toastMessage', { msg: "Game already in progress!", type: "error" });
        if (gameState.players.length >= gameState.maxPlayers) return socket.emit('toastMessage', { msg: "Lobby is full!", type: "error" });

        const newPlayer = {
            id: socket.id, 
            name: playerName,
            balance: 15000,
            position: 0,
            skipTurns: 0,
            loan: 0,
            loanTurns: 0,
            colorClass: availableColors[gameState.players.length]
        };

        gameState.players.push(newPlayer);
        io.emit('gameStateUpdate', gameState);
        io.emit('toastMessage', { msg: `${playerName} joined the lobby.`, type: "info" });
    });

    socket.on('startGame', () => {
        if (gameState.players.length < 2) return;
        gameState.gameStarted = true;
        io.emit('gameStarted', gameState);
    });

    socket.on('requestDiceRoll', () => {
        const currentPlayer = gameState.players[gameState.currentPlayerIndex];
        if (!currentPlayer || socket.id !== currentPlayer.id || gameState.isAwaitingAction) return;

        const dice1 = Math.floor(Math.random() * 6) + 1;
        const dice2 = Math.floor(Math.random() * 6) + 1;
        io.emit('playDiceAnimation', { totalRoll: dice1 + dice2, newState: gameState });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Serving files from: ${path.join(__dirname, 'public')}`);
});