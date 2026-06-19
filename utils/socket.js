let io;

const noopEmitter = {
    to: () => noopEmitter,
    emit: () => noopEmitter
};

module.exports = {
    init: (httpServer) => {
        io = require('socket.io')(httpServer, {
            cors: {
                origin: "*", // Allow all origins for flexibility, or you can restrict to specific domains
                methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                credentials: true
            }
        });
        return io;
    },
    getIO: () => {
        if (!io) {
            // Socket.io requires a persistent HTTP server (not available on Vercel serverless).
            return noopEmitter;
        }
        return io;
    }
};
