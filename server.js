const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

app.use(express.static(path.join(__dirname, 'public')));

// Key-value store tracking users in rooms: { roomId: { socketId: nickname } }
const rooms = {};

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('join-room', ({ roomId, nickname }) => {
        socket.join(roomId);
        
        if (!rooms[roomId]) {
            rooms[roomId] = {};
        }
        rooms[roomId][socket.id] = nickname;

        // Inform existing users in the room to connect with this new peer
        const otherUsers = Object.keys(rooms[roomId]).filter(id => id !== socket.id);
        socket.emit('all-users', otherUsers.map(id => ({ id, nickname: rooms[roomId][id] })));

        // Broadcast to the room that a new user has arrived
        socket.to(roomId).emit('user-joined', {
            id: socket.id,
            nickname: nickname
        });
    });

    // WebRTC Signaling relays (SDP Offers, Answers, and Ice Candidates)
    socket.on('sending-signal', payload => {
        io.to(payload.userToSignal).emit('user-joined-signal', {
            signal: payload.signal,
            callerId: socket.id,
            nickname: payload.nickname
        });
    });

    socket.on('returning-signal', payload => {
        io.to(payload.callerId).emit('receiving-returned-signal', {
            signal: payload.signal,
            id: socket.id
        });
    });

    // Manage user departures and clean up the list
    socket.on('disconnect', () => {
        for (const roomId in rooms) {
            if (rooms[roomId][socket.id]) {
                const nickname = rooms[roomId][socket.id];
                delete rooms[roomId][socket.id];
                
                // If room is empty, erase room data
                if (Object.keys(rooms[roomId]).length === 0) {
                    delete rooms[roomId];
                } else {
                    io.to(roomId).emit('user-left', { id: socket.id, nickname });
                }
                break;
            }
        }
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));
