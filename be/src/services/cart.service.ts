import { z } from "zod";
import { randomUUID } from "node:crypto";

import { Cart, Product } from "../types";
import { store } from "../store/in-memory-store";
import { NotFoundError, ConflictError } from "../middleware/error.middleware";

// --- Zod Schemas ---
export const AddToCartSchema = z.object({
    productId: z.string().min(1, "productId is required"),
    quantity: z
        .number()
        .int("Quantity must be an integer")
        .positive("Quantity must be greater than zero"),
});

export const UpdateQuantitySchema = z.object({
    quantity: z
        .number()
        .int("Quantity must be an integer")
        .positive("Quantity must be greater than zero"),
});

export type AddToCartInput = z.infer<typeof AddToCartSchema>;
export type UpdateQuantityInput = z.infer<typeof UpdateQuantitySchema>;

/**
 * Retrieves a cart and verifies it is not checked out.
 */
function getActiveCartOrThrow(cartId: string): Cart {
    const cart = store.getCart(cartId);
    if (!cart) {
        throw new NotFoundError(`Cart with ID '${cartId}' not found`);
    }
    if (cart.status === "CHECKED_OUT") {
        throw new ConflictError(
            "Cannot modify a cart that has already been checked out",
            "CART_ALREADY_CHECKED_OUT",
        );
    }
    return cart;
}

/**
 * Validates product existence and stock availability.
 */
function getProductWithStockOrThrow(
    productId: string,
    requestedQuantity: number,
): Product {
    const product = store.getProduct(productId);
    if (!product) {
        throw new NotFoundError(`Product with ID '${productId}' not found`);
    }
    if (requestedQuantity > product.inventory) {
        throw new ConflictError(
            `Insufficient inventory for '${product.name}'. Available: ${product.inventory}, requested: ${requestedQuantity}`,
            "INSUFFICIENT_INVENTORY",
            { availableInventory: product.inventory, requestedQuantity },
        );
    }
    return product;
}

/**
 * Recalculates item totals and cart subtotal against current catalog prices.
 */
function refreshCartPricesAndTotals(cart: Cart): void {
    let subtotal = 0;
    for (const item of cart.items) {
        const product = store.getProduct(item.productId);
        if (product) {
            item.unitPriceInCents = product.priceInCents;
            item.totalPriceInCents = item.quantity * product.priceInCents;
        }
        subtotal += item.totalPriceInCents;
    }
    cart.subtotalInCents = subtotal;
}

export function createCart(): Cart {
    const cart: Cart = {
        id: randomUUID(),
        status: "ACTIVE",
        items: [],
        subtotalInCents: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    store.saveCart(cart);
    return cart;
}

export function getCart(cartId: string): Cart {
    const cart = store.getCart(cartId);
    if (!cart) {
        throw new NotFoundError(`Cart with ID '${cartId}' not found`);
    }
    refreshCartPricesAndTotals(cart);
    return cart;
}

export function addItemToCart(cartId: string, input: AddToCartInput): Cart {
    const { productId, quantity } = AddToCartSchema.parse(input);
    const cart = getActiveCartOrThrow(cartId);

    const existingItemIndex = cart.items.findIndex(
        (item) => item.productId === productId,
    );
    const existingQuantity =
        existingItemIndex >= 0 ? cart.items[existingItemIndex]!.quantity : 0;
    const targetQuantity = existingQuantity + quantity;

    const product = getProductWithStockOrThrow(productId, targetQuantity);

    if (existingItemIndex >= 0) {
        cart.items[existingItemIndex]!.quantity = targetQuantity;
        cart.items[existingItemIndex]!.unitPriceInCents = product.priceInCents;
        cart.items[existingItemIndex]!.totalPriceInCents =
            targetQuantity * product.priceInCents;
    } else {
        cart.items.push({
            productId: product.id,
            name: product.name,
            quantity: targetQuantity,
            unitPriceInCents: product.priceInCents,
            totalPriceInCents: targetQuantity * product.priceInCents,
        });
    }

    cart.updatedAt = new Date();
    refreshCartPricesAndTotals(cart);
    store.saveCart(cart);
    return cart;
}

export function updateCartItemQuantity(
    cartId: string,
    productId: string,
    input: UpdateQuantityInput,
): Cart {
    const { quantity } = UpdateQuantitySchema.parse(input);
    const cart = getActiveCartOrThrow(cartId);

    const existingItemIndex = cart.items.findIndex(
        (item) => item.productId === productId,
    );
    if (existingItemIndex < 0) {
        throw new NotFoundError(`Product '${productId}' is not in this cart`);
    }

    const product = getProductWithStockOrThrow(productId, quantity);

    cart.items[existingItemIndex]!.quantity = quantity;
    cart.items[existingItemIndex]!.unitPriceInCents = product.priceInCents;
    cart.items[existingItemIndex]!.totalPriceInCents =
        quantity * product.priceInCents;

    cart.updatedAt = new Date();
    refreshCartPricesAndTotals(cart);
    store.saveCart(cart);
    return cart;
}

export function removeCartItem(cartId: string, productId: string): Cart {
    const cart = getActiveCartOrThrow(cartId);

    const itemExists = cart.items.some((item) => item.productId === productId);
    if (!itemExists) {
        throw new NotFoundError(`Product '${productId}' is not in this cart`);
    }

    cart.items = cart.items.filter((item) => item.productId !== productId);
    cart.updatedAt = new Date();
    refreshCartPricesAndTotals(cart);
    store.saveCart(cart);
    return cart;
}
