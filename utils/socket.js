let io;

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
            throw new Error("Socket.io not initialized!");
        }
        return io;
    }
};
