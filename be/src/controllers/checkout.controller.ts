import { Request, Response } from "express";

import {
    getParam,
    getHeader,
    asyncHandler,
    formatOrderResponse,
} from "../utils";
import { checkoutCart, getOrderById } from "../services/checkout.service";

/**
 * POST /api/carts/:id/checkout - Checkout cart with optional coupon and idempotency key
 */
export const handleCheckout = asyncHandler(
    async (req: Request, res: Response) => {
        const id = getParam(req.params["id"]);
        const idempotencyKey = getHeader(req.header("Idempotency-Key"));

        const { order, isIdempotentReplay } = checkoutCart(
            id,
            req.body,
            idempotencyKey,
        );

        const statusCode = isIdempotentReplay ? 200 : 201;

        res.status(statusCode).json({
            message: isIdempotentReplay
                ? "Order retrieved (idempotent replay)"
                : "Order placed successfully",
            data: formatOrderResponse(order),
        });
    },
);

/**
 * GET /api/orders/:id - Retrieve order details by ID
 */
export const handleGetOrder = asyncHandler(
    async (req: Request, res: Response) => {
        const id = getParam(req.params["id"]);
        const order = getOrderById(id);

        res.status(200).json({
            data: formatOrderResponse(order),
        });
    },
);
