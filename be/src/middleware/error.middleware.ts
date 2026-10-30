import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export class AppError extends Error {
    public readonly statusCode: number;
    public readonly code: string;
    public readonly details?: unknown;

    constructor(
        message: string,
        statusCode: number,
        code: string,
        details?: unknown,
    ) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class NotFoundError extends AppError {
    constructor(message: string, details?: unknown) {
        super(message, 404, "NOT_FOUND", details);
    }
}

export class ConflictError extends AppError {
    constructor(message: string, code: string = "CONFLICT", details?: unknown) {
        super(message, 409, code, details);
    }
}

export class ValidationError extends AppError {
    constructor(message: string, details?: unknown) {
        super(message, 400, "VALIDATION_ERROR", details);
    }
}

export class UnprocessableEntityError extends AppError {
    constructor(
        message: string,
        code: string = "UNPROCESSABLE_ENTITY",
        details?: unknown,
    ) {
        super(message, 422, code, details);
    }
}

export const errorHandler: ErrorRequestHandler = (
    err: Error,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void => {
    // Handle Zod validation errors
    if (err instanceof ZodError) {
        res.status(400).json({
            error: {
                code: "VALIDATION_ERROR",
                message: "Invalid request payload",
                statusCode: 400,
                details: err.issues.map((e) => ({
                    field: e.path.join("."),
                    message: e.message,
                })),
            },
        });
        return;
    }

    // Handle custom AppErrors
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            error: {
                code: err.code,
                message: err.message,
                statusCode: err.statusCode,
                ...(err.details ? { details: err.details } : {}),
            },
        });
        return;
    }

    // Fallback for unhandled internal exceptions
    console.error("Unhandled Server Error:", err);
    res.status(500).json({
        error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "An unexpected internal error occurred",
            statusCode: 500,
        },
    });
};
