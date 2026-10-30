import { Request, Response, NextFunction, RequestHandler } from "express";

import { Cart, Order } from "../types";

/**
 * Wraps async route handlers to forward unhandled errors to the centralized error middleware.
 *
 * @param fn - Express request handler function returning a Promise.
 * @returns Standard Express RequestHandler.
 */
export function asyncHandler(
    fn: (
        req: Request,
        res: Response,
        next: NextFunction,
    ) => Promise<unknown> | unknown,
): RequestHandler {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Formats integer cents into standard USD string (e.g. 129900 -> "$1,299.00").
 *
 * @param cents - Integer monetary amount in cents.
 * @returns Formatted currency string.
 */
export function formatCentsToCurrency(cents: number): string {
    const dollars = (cents / 100).toFixed(2);
    return `$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/**
 * Safely extracts a single string parameter from Express 5 req.params.
 *
 * @param param - Route param string or string array.
 * @returns Single string value.
 */
export function getParam(param: string | string[] | undefined): string {
    if (Array.isArray(param)) {
        return param[0] ?? "";
    }
    return param ?? "";
}

/**
 * Safely extracts a single header string from Express 5 req.headers.
 *
 * @param header - Header string or string array.
 * @returns Single header string or undefined.
 */
export function getHeader(
    header: string | string[] | undefined,
): string | undefined {
    if (Array.isArray(header)) {
        return header[0];
    }
    return header;
}

/**
 * Normalizes a coupon code by trimming whitespace and converting to uppercase.
 * Ensures consistent coupon lookups across all services.
 *
 * @param rawCode - Raw coupon code string.
 * @returns Normalized uppercase coupon code.
 */
export function normalizeCouponCode(rawCode: string): string {
    return rawCode.trim().toUpperCase();
}

/**
 * Standardizes Cart response with human-readable currency strings alongside integer cents.
 *
 * @param cart - Domain Cart entity.
 * @returns Formatted Cart payload for API clients.
 */
export function formatCartResponse(cart: Cart) {
    return {
        ...cart,
        formattedSubtotal: formatCentsToCurrency(cart.subtotalInCents),
        items: cart.items.map((item) => ({
            ...item,
            formattedUnitPrice: formatCentsToCurrency(item.unitPriceInCents),
            formattedTotalPrice: formatCentsToCurrency(item.totalPriceInCents),
        })),
    };
}

/**
 * Standardizes Order response with human-readable currency strings alongside integer cents.
 *
 * @param order - Domain Order entity.
 * @returns Formatted Order payload for API clients.
 */
export function formatOrderResponse(order: Order) {
    return {
        ...order,
        formattedGrossTotal: formatCentsToCurrency(order.grossTotalInCents),
        formattedDiscount: formatCentsToCurrency(order.discountInCents),
        formattedNetTotal: formatCentsToCurrency(order.netTotalInCents),
        items: order.items.map((item) => ({
            ...item,
            formattedUnitPrice: formatCentsToCurrency(item.unitPriceInCents),
            formattedTotalPrice: formatCentsToCurrency(item.totalPriceInCents),
        })),
    };
}
