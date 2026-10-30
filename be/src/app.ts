import express, { Application, Request, Response } from "express";

import apiRoutes from "./routes";
import { errorHandler, NotFoundError } from "./middleware/error.middleware";

export function createApp(): Application {
    const app = express();

    // Middleware
    app.use(express.json());

    // Health check endpoint
    app.get("/health", (_req: Request, res: Response) => {
        res.status(200).json({
            status: "ok",
            timestamp: new Date().toISOString(),
        });
    });

    // Mount API Routes
    app.use("/api", apiRoutes);

    // Catch-all 404 for undefined routes
    app.use((req: Request, _res: Response, next) => {
        next(
            new NotFoundError(
                `Route '${req.method} ${req.originalUrl}' not found`,
            ),
        );
    });

    // Centralized Error Handling Middleware (must be registered last)
    app.use(errorHandler);

    return app;
}

export const app = createApp();
