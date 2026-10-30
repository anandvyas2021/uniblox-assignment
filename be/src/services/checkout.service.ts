import { z } from "zod";
import { randomUUID } from "node:crypto";

import { store } from "../store/in-memory-store";
import { Order, OrderItem } from "../types";
import { normalizeCouponCode } from "../utils";
import { calculateDiscount } from "./coupon.service";
import {
    NotFoundError,
    ConflictError,
    ValidationError,
} from "../middleware/error.middleware";

/**
 * Validation schema for checkout payload.
 */
export const CheckoutSchema = z.object({
    couponCode: z.string().trim().optional(),
});

export type CheckoutInput = z.infer<typeof CheckoutSchema>;

export interface CheckoutResult {
    order: Order;
    isIdempotentReplay: boolean;
}

/**
 * Executes a transactional checkout for a cart.
 *
 * - Verifies cart is active and non-empty.
 * - Validates inventory for all cart items against live catalog stock.
 * - Validates and applies optional discount coupon.
 * - Atomically decrements inventory, marks coupon redeemed, locks cart, and creates order.
 * - Supports idempotent retries via Idempotency-Key header.
 *
 * @param cartId - Unique ID of the cart to checkout.
 * @param input - Optional payload containing a coupon code.
 * @param idempotencyKey - Optional unique client key for safe retry handling.
 * @returns Order entity and a flag indicating if this was an idempotent replay.
 *
 * @throws {NotFoundError} If cart or any product is not found.
 * @throws {ConflictError} If cart is already checked out, stock is insufficient, or coupon is already redeemed.
 * @throws {ValidationError} If cart is empty.
 */
export function checkoutCart(
    cartId: string,
    input: CheckoutInput = {},
    idempotencyKey?: string,
): CheckoutResult {
    const parsed = CheckoutSchema.parse(input);
    // Normalize empty strings to undefined
    const rawCouponCode =
        parsed.couponCode && parsed.couponCode.length > 0
            ? parsed.couponCode
            : undefined;

    // Idempotency Check: Replay cached order on matching key
    if (idempotencyKey) {
        const existingRecord = store.getIdempotencyRecord(idempotencyKey);
        if (existingRecord) {
            return {
                order: existingRecord.body as Order,
                isIdempotentReplay: true,
            };
        }
    }

    // 2. Atomic Transaction Execution
    const order = store.runTransaction((tx) => {
        // Validate Cart State
        const cart = tx.carts.get(cartId);
        if (!cart) {
            throw new NotFoundError(`Cart with ID '${cartId}' not found`);
        }
        if (cart.status === "CHECKED_OUT") {
            throw new ConflictError(
                "This cart has already been checked out and cannot be processed again",
                "CART_ALREADY_CHECKED_OUT",
            );
        }
        if (cart.items.length === 0) {
            throw new ValidationError(
                "Cannot check out an empty cart. Add items first.",
            );
        }

        // Validate Stock & Snapshot Item Pricing
        const orderItems: OrderItem[] = [];
        let grossTotalInCents = 0;

        for (const item of cart.items) {
            const product = tx.products.get(item.productId);
            if (!product) {
                throw new NotFoundError(
                    `Product '${item.productId}' no longer exists in catalog`,
                );
            }
            if (product.inventory < item.quantity) {
                throw new ConflictError(
                    `Insufficient inventory for '${product.name}'. In stock: ${product.inventory}, requested: ${item.quantity}`,
                    "INSUFFICIENT_INVENTORY",
                    {
                        productId: product.id,
                        productName: product.name,
                        availableInventory: product.inventory,
                        requestedQuantity: item.quantity,
                    },
                );
            }

            const itemTotal = item.quantity * product.priceInCents;
            grossTotalInCents += itemTotal;

            orderItems.push({
                productId: product.id,
                productName: product.name,
                unitPriceInCents: product.priceInCents,
                quantity: item.quantity,
                totalPriceInCents: itemTotal,
            });
        }

        // Validate Coupon (if supplied)
        let discountInCents = 0;
        let appliedCouponCode: string | undefined = undefined;

        if (rawCouponCode) {
            const normalizedCode = normalizeCouponCode(rawCouponCode);
            const coupon = tx.coupons.get(normalizedCode);

            if (!coupon) {
                throw new NotFoundError(
                    `Coupon '${normalizedCode}' is invalid or does not exist`,
                );
            }
            if (coupon.status === "REDEEMED") {
                throw new ConflictError(
                    `Coupon '${normalizedCode}' has already been redeemed`,
                    "COUPON_ALREADY_REDEEMED",
                    { code: normalizedCode, redeemedAt: coupon.redeemedAt },
                );
            }

            const discountResult = calculateDiscount(
                grossTotalInCents,
                coupon.discountPercent,
            );
            discountInCents = discountResult.discountInCents;
            appliedCouponCode = coupon.code;
        }

        const netTotalInCents = Math.max(
            0,
            grossTotalInCents - discountInCents,
        );
        const newOrderId = randomUUID();

        // Apply Mutations (All or nothing)
        for (const item of cart.items) {
            const product = tx.products.get(item.productId)!;
            product.inventory -= item.quantity;
        }

        if (appliedCouponCode) {
            const coupon = tx.coupons.get(appliedCouponCode)!;
            coupon.status = "REDEEMED";
            coupon.redeemedByOrderId = newOrderId;
            coupon.redeemedAt = new Date();
        }

        cart.status = "CHECKED_OUT";
        cart.updatedAt = new Date();

        const newOrder: Order = {
            id: newOrderId,
            orderNumber: tx.nextOrderNumber,
            cartId: cart.id,
            items: orderItems,
            grossTotalInCents,
            discountInCents,
            netTotalInCents,
            ...(appliedCouponCode
                ? { couponCodeApplied: appliedCouponCode }
                : {}),
            ...(idempotencyKey ? { idempotencyKey } : {}),
            createdAt: new Date(),
        };

        tx.orders.set(newOrderId, newOrder);
        return newOrder;
    });

    // Cache Result in Idempotency Registry
    if (idempotencyKey) {
        store.saveIdempotencyRecord(idempotencyKey, {
            statusCode: 201,
            body: order,
            createdAt: new Date(),
        });
    }

    return {
        order,
        isIdempotentReplay: false,
    };
}

/**
 * Retrieves a historical order snapshot by its unique ID.
 *
 * @param orderId - Unique order ID.
 * @returns Placed Order snapshot.
 * @throws {NotFoundError} If order does not exist.
 */
export function getOrderById(orderId: string): Order {
    const order = store.getOrder(orderId);
    if (!order) {
        throw new NotFoundError(`Order with ID '${orderId}' not found`);
    }
    return order;
}
