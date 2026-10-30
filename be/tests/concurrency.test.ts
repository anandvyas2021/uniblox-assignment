import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";

import { app } from "../src/app";
import { store } from "../src/store/in-memory-store";

describe("High-Concurrency Invariants & Race Conditions", () => {
    beforeEach(() => {
        store.reset();
    });

    it("INVARIANT 1: Competing concurrent checkouts NEVER oversell inventory", async () => {
        // 'prod-limited-mousepad' has STRICTLY 2 items in stock
        const limitedProduct = store.getProduct("prod-limited-mousepad")!;
        expect(limitedProduct.inventory).toBe(2);

        // Create 10 independent carts, each wanting 1 mousepad
        const cartIds: string[] = [];
        for (let i = 0; i < 10; i++) {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;
            await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-limited-mousepad", quantity: 1 });
            cartIds.push(cartId);
        }

        // Fire 10 concurrent checkout requests simultaneously via Promise.all
        const checkoutPromises = cartIds.map((cartId) =>
            request(app).post(`/api/carts/${cartId}/checkout`).send(),
        );

        const results = await Promise.all(checkoutPromises);

        const successResponses = results.filter((r) => r.status === 201);
        const conflictResponses = results.filter((r) => r.status === 409);

        // Strict Invariant Assertions:
        expect(successResponses).toHaveLength(2); // Exactly 2 succeed
        expect(conflictResponses).toHaveLength(8); // Exactly 8 fail with Conflict
        for (const conflict of conflictResponses) {
            expect(conflict.body.error.code).toBe("INSUFFICIENT_INVENTORY");
        }

        // Final stock must be strictly 0, NEVER negative
        const finalProduct = store.getProduct("prod-limited-mousepad")!;
        expect(finalProduct.inventory).toBe(0);
    });

    it("INVARIANT 2: A single-use coupon cannot be redeemed by two concurrent checkouts", async () => {
        // 1. Configure milestone n=1, x=20% and trigger 1 order to unlock a real coupon
        store.setMilestoneConfig(1, 20);

        const prepCart = await request(app).post("/api/carts").send();
        await request(app)
            .post(`/api/carts/${prepCart.body.data.id}/items`)
            .send({ productId: "prod-cable", quantity: 1 });
        await request(app)
            .post(`/api/carts/${prepCart.body.data.id}/checkout`)
            .send();

        // Generate the coupon
        const couponRes = await request(app)
            .post("/api/admin/coupons/generate")
            .send();
        expect(couponRes.status).toBe(201);
        const couponCode = couponRes.body.data.code;

        // 2. Prepare 5 different carts with enough inventory
        const cartIds: string[] = [];
        for (let i = 0; i < 5; i++) {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;
            await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-cable", quantity: 1 });
            cartIds.push(cartId);
        }

        // 3. All 5 carts attempt to redeem the exact same coupon at the exact same instant
        const concurrentCheckouts = cartIds.map((cartId) =>
            request(app)
                .post(`/api/carts/${cartId}/checkout`)
                .send({ couponCode }),
        );

        const results = await Promise.all(concurrentCheckouts);

        const successfulDiscounts = results.filter(
            (r) => r.status === 201 && r.body.data.discountInCents > 0,
        );
        const rejectedDueToRedeemed = results.filter(
            (r) =>
                r.status === 409 &&
                r.body.error.code === "COUPON_ALREADY_REDEEMED",
        );

        // Invariant: EXACTLY 1 cart gets the coupon discount; all other 4 are rejected
        expect(successfulDiscounts).toHaveLength(1);
        expect(rejectedDueToRedeemed).toHaveLength(4);

        // Verify coupon is redeemed strictly once
        const couponInStore = store.getCoupon(couponCode)!;
        expect(couponInStore.status).toBe("REDEEMED");
    });

    it("INVARIANT 3: Failed checkout does NOT consume or burn a valid coupon", async () => {
        // Create coupon
        store.setMilestoneConfig(1, 10);
        const prepCart = await request(app).post("/api/carts").send();
        await request(app)
            .post(`/api/carts/${prepCart.body.data.id}/items`)
            .send({ productId: "prod-cable", quantity: 1 });
        await request(app)
            .post(`/api/carts/${prepCart.body.data.id}/checkout`)
            .send();
        const couponRes = await request(app)
            .post("/api/admin/coupons/generate")
            .send();
        const couponCode = couponRes.body.data.code;

        // Create cart with 2 limited mousepads (stock is 2)
        const cart1 = await request(app).post("/api/carts").send();
        await request(app)
            .post(`/api/carts/${cart1.body.data.id}/items`)
            .send({ productId: "prod-limited-mousepad", quantity: 2 });

        // In the meantime, another customer buys 1 mousepad, reducing stock to 1
        const sneakCart = await request(app).post("/api/carts").send();
        await request(app)
            .post(`/api/carts/${sneakCart.body.data.id}/items`)
            .send({ productId: "prod-limited-mousepad", quantity: 1 });
        await request(app)
            .post(`/api/carts/${sneakCart.body.data.id}/checkout`)
            .send();

        // Now cart1 attempts to checkout with the coupon, but will fail due to out-of-stock (requested 2, available 1)
        const failedCheckout = await request(app)
            .post(`/api/carts/${cart1.body.data.id}/checkout`)
            .send({ couponCode });

        expect(failedCheckout.status).toBe(409);
        expect(failedCheckout.body.error.code).toBe("INSUFFICIENT_INVENTORY");

        // INVARIANT: Coupon must NOT be consumed or marked REDEEMED
        const couponAfterFailure = store.getCoupon(couponCode)!;
        expect(couponAfterFailure.status).toBe("AVAILABLE");
        expect(couponAfterFailure.redeemedByOrderId).toBeUndefined();

        // It can now be used on another valid cart
        const validCart = await request(app).post("/api/carts").send();
        await request(app)
            .post(`/api/carts/${validCart.body.data.id}/items`)
            .send({ productId: "prod-cable", quantity: 1 });

        const retryCheckout = await request(app)
            .post(`/api/carts/${validCart.body.data.id}/checkout`)
            .send({ couponCode });

        expect(retryCheckout.status).toBe(201);
        expect(retryCheckout.body.data.discountInCents).toBeGreaterThan(0);
    });
});
