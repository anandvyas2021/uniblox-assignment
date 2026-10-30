import { Request, Response } from "express";

import { asyncHandler, getParam, formatCartResponse } from "../utils";
import {
    getCart,
    createCart,
    addItemToCart,
    removeCartItem,
    updateCartItemQuantity,
} from "../services/cart.service";

/**
 * POST /api/carts - Create a new empty cart
 */
export const handleCreateCart = asyncHandler(
    async (_req: Request, res: Response) => {
        const cart = createCart();

        res.status(201).json({
            message: "Cart created successfully",
            data: formatCartResponse(cart),
        });
    },
);

/**
 * GET /api/carts/:id - Retrieve cart with itemized pricing and totals
 */
export const handleGetCart = asyncHandler(
    async (req: Request, res: Response) => {
        const id = getParam(req.params["id"]);
        const cart = getCart(id);

        res.status(200).json({
            data: formatCartResponse(cart),
        });
    },
);

/**
 * POST /api/carts/:id/items - Add an item to the cart
 */
export const handleAddItemToCart = asyncHandler(
    async (req: Request, res: Response) => {
        const id = getParam(req.params["id"]);
        const cart = addItemToCart(id, req.body);

        res.status(200).json({
            message: "Item added to cart",
            data: formatCartResponse(cart),
        });
    },
);

/**
 * PATCH /api/carts/:id/items/:productId - Update item quantity in cart
 */
export const handleUpdateCartItemQuantity = asyncHandler(
    async (req: Request, res: Response) => {
        const id = getParam(req.params["id"]);
        const productId = getParam(req.params["productId"]);
        const cart = updateCartItemQuantity(id, productId, req.body);

        res.status(200).json({
            message: "Cart item updated",
            data: formatCartResponse(cart),
        });
    },
);

/**
 * DELETE /api/carts/:id/items/:productId - Remove item from cart
 */
export const handleRemoveCartItem = asyncHandler(
    async (req: Request, res: Response) => {
        const id = getParam(req.params["id"]);
        const productId = getParam(req.params["productId"]);
        const cart = removeCartItem(id, productId);

        res.status(200).json({
            message: "Cart item removed",
            data: formatCartResponse(cart),
        });
    },
);
