import { z } from "zod";

import { Coupon } from "../types";
import { normalizeCouponCode } from "../utils";
import { store } from "../store/in-memory-store";
import {
    NotFoundError,
    ConflictError,
    UnprocessableEntityError,
} from "../middleware/error.middleware";

/**
 * Validation schema for coupon application payload.
 */
export const ApplyCouponSchema = z.object({
    couponCode: z.string().trim().min(1, "Coupon code cannot be empty"),
});

/**
 * Validation schema for configuring milestone intervals.
 */
export const MilestoneConfigSchema = z.object({
    n: z
        .number()
        .int("n must be an integer")
        .positive("n must be greater than 0"),
    x: z
        .number()
        .positive("x must be greater than 0")
        .max(100, "x cannot exceed 100%"),
});

export type ApplyCouponInput = z.infer<typeof ApplyCouponSchema>;
export type MilestoneConfigInput = z.infer<typeof MilestoneConfigSchema>;

function normalizeCode(rawCode: string): string {
    return rawCode.trim().toUpperCase();
}

/**
 * Validates a coupon code for checkout.
 *
 * @param rawCode - Raw coupon code.
 * @returns Validated Coupon entity.
 * @throws {NotFoundError} If coupon does not exist.
 * @throws {ConflictError} If coupon was already redeemed.
 */
export function validateCouponForCheckout(rawCode: string): Coupon {
    const code = rawCode.trim().toUpperCase();
    const coupon = store.getCoupon(code);

    if (!coupon) {
        throw new NotFoundError(`Coupon '${code}' does not exist`);
    }

    if (coupon.status === "REDEEMED") {
        throw new ConflictError(
            `Coupon '${code}' has already been redeemed and cannot be reused`,
            "COUPON_ALREADY_REDEEMED",
            {
                code,
                redeemedAt: coupon.redeemedAt,
                orderId: coupon.redeemedByOrderId,
            },
        );
    }

    return coupon;
}

/**
 * Calculates discount amount in integer cents.
 * Guarantees zero decimal drift and non-negative net totals.
 *
 * @param grossTotalInCents - Order gross total in cents.
 * @param discountPercent - Discount percentage (e.g. 10 for 10%).
 * @returns Object with discount amount and net total in cents.
 */
export function calculateDiscount(
    grossTotalInCents: number,
    discountPercent: number,
): {
    discountInCents: number;
    netTotalInCents: number;
} {
    if (grossTotalInCents <= 0 || discountPercent <= 0) {
        return {
            discountInCents: 0,
            netTotalInCents: Math.max(0, grossTotalInCents),
        };
    }

    const discountInCents = Math.round(
        (grossTotalInCents * discountPercent) / 100,
    );
    const netTotalInCents = Math.max(0, grossTotalInCents - discountInCents);

    return { discountInCents, netTotalInCents };
}

/**
 * Generates a coupon for an eligible unrewarded order milestone.
 *
 * @returns Newly created Coupon.
 * @throws {UnprocessableEntityError} If no milestone is currently eligible.
 */
export function generateAdminMilestoneCoupon(): Coupon {
    const eligibleMilestone = store.getEligibleMilestone();

    if (!eligibleMilestone) {
        const config = store.getMilestoneConfig();
        const currentOrders = store.getOrderCount();
        const nextMilestone =
            (Math.floor(currentOrders / config.n) + 1) * config.n;

        throw new UnprocessableEntityError(
            `No eligible milestone available. Current orders: ${currentOrders}. Next milestone is order #${nextMilestone} (every ${config.n}th order).`,
            "MILESTONE_NOT_REACHED",
            { currentOrders, milestoneN: config.n, nextMilestone },
        );
    }

    const coupon = store.generateMilestoneCoupon();
    if (!coupon) {
        throw new UnprocessableEntityError(
            "Unable to generate milestone coupon",
            "COUPON_GENERATION_FAILED",
        );
    }

    return coupon;
}

/**
 * Retrieves details for a specific coupon code.
 *
 * @param rawCode - Coupon code.
 * @returns Coupon details.
 * @throws {NotFoundError} If coupon does not exist.
 */
export function getCouponDetails(rawCode: string): Coupon {
    const code = normalizeCouponCode(rawCode);
    const coupon = store.getCoupon(code);

    if (!coupon) {
        throw new NotFoundError(`Coupon '${code}' not found`);
    }
    return coupon;
}

/**
 * Updates store milestone configuration parameters (n and x).
 *
 * @param input - Configuration object with n and x.
 * @returns Updated configuration.
 */
export function updateMilestoneConfig(input: MilestoneConfigInput): {
    n: number;
    x: number;
} {
    const { n, x } = MilestoneConfigSchema.parse(input);
    store.setMilestoneConfig(n, x);
    return store.getMilestoneConfig();
}
