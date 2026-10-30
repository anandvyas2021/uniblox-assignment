import { app } from "./app";

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
    console.log(
        `Checkout & Rewards Service running on http://localhost:${PORT}`,
    );
    console.log(`Health check available at: http://localhost:${PORT}/health`);
    console.log(`Catalog available at: http://localhost:${PORT}/api/products`);
});

// Graceful shutdown handling
process.on("SIGTERM", () => {
    console.log("SIGTERM signal received: closing HTTP server");
    server.close(() => {
        console.log("HTTP server closed");
    });
});

process.on("SIGINT", () => {
    console.log("SIGINT signal received: closing HTTP server");
    server.close(() => {
        console.log("HTTP server closed");
    });
});

export { server };
