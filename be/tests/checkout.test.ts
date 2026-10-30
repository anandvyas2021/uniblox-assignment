import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";

import { app } from "../src/app";
import { store } from "../src/store/in-memory-store";

describe("Checkout & Idempotency Invariants", () => {
    beforeEach(() => {
        store.reset();
    });

    it("completes checkout, creates order, deducts inventory, and locks cart", async () => {
        // 1. Create cart and add items
        const cartRes = await request(app).post("/api/carts").send();
        const cartId = cartRes.body.data.id;

        await request(app)
            .post(`/api/carts/${cartId}/items`)
            .send({ productId: "prod-headphones", quantity: 2 }); // 2 x 19900 = 39800

        // Initial stock is 35
        expect(store.getProduct("prod-headphones")?.inventory).toBe(35);

        // 2. Checkout
        const checkoutRes = await request(app)
            .post(`/api/carts/${cartId}/checkout`)
            .send();

        expect(checkoutRes.status).toBe(201);
        const order = checkoutRes.body.data;
        expect(order.cartId).toBe(cartId);
        expect(order.orderNumber).toBe(1);
        expect(order.grossTotalInCents).toBe(39800);
        expect(order.discountInCents).toBe(0);
        expect(order.netTotalInCents).toBe(39800);
        expect(order.formattedNetTotal).toBe("$398.00");

        // 3. Verify Inventory deducted atomically
        expect(store.getProduct("prod-headphones")?.inventory).toBe(33);

        // 4. Verify Cart is marked CHECKED_OUT
        const updatedCart = store.getCart(cartId);
        expect(updatedCart?.status).toBe("CHECKED_OUT");
    });

    it("preserves historical snapshot even if product price changes later in catalog", async () => {
        const cartRes = await request(app).post("/api/carts").send();
        const cartId = cartRes.body.data.id;

        await request(app)
            .post(`/api/carts/${cartId}/items`)
            .send({ productId: "prod-cable", quantity: 2 }); // $15.00 each

        const checkoutRes = await request(app)
            .post(`/api/carts/${cartId}/checkout`)
            .send();
        const orderId = checkoutRes.body.data.id;

        // Simulate merchant changing price in catalog
        const cable = store.getProduct("prod-cable")!;
        cable.priceInCents = 99999; // Price raised to $999.99

        // Retrieve order
        const orderRes = await request(app)
            .get(`/api/orders/${orderId}`)
            .send();
        expect(orderRes.status).toBe(200);
        expect(orderRes.body.data.items[0].unitPriceInCents).toBe(1500); // Unaltered historical price
        expect(orderRes.body.data.netTotalInCents).toBe(3000); // Unaltered historical total
    });

    it("rejects checking out an already checked-out cart with 409 Conflict", async () => {
        const cartRes = await request(app).post("/api/carts").send();
        const cartId = cartRes.body.data.id;

        await request(app)
            .post(`/api/carts/${cartId}/items`)
            .send({ productId: "prod-cable", quantity: 1 });

        // First checkout succeeds
        const firstRes = await request(app)
            .post(`/api/carts/${cartId}/checkout`)
            .send();
        expect(firstRes.status).toBe(201);

        // Second checkout attempt on same cart fails
        const secondRes = await request(app)
            .post(`/api/carts/${cartId}/checkout`)
            .send();
        expect(secondRes.status).toBe(409);
        expect(secondRes.body.error.code).toBe("CART_ALREADY_CHECKED_OUT");
    });

    it("rejects checking out an empty cart with 400 Bad Request", async () => {
        const cartRes = await request(app).post("/api/carts").send();
        const cartId = cartRes.body.data.id;

        const res = await request(app)
            .post(`/api/carts/${cartId}/checkout`)
            .send();
        expect(res.status).toBe(400);
    });

    it("guarantees idempotency: retries with same Idempotency-Key return cached order without duplicate inventory charge", async () => {
        const cartRes = await request(app).post("/api/carts").send();
        const cartId = cartRes.body.data.id;

        await request(app)
            .post(`/api/carts/${cartId}/items`)
            .send({ productId: "prod-keyboard", quantity: 1 });

        const initialStock = store.getProduct("prod-keyboard")!.inventory;
        const idempotencyKey = "client-req-uuid-12345";

        // 1. Initial Checkout Request
        const res1 = await request(app)
            .post(`/api/carts/${cartId}/checkout`)
            .set("Idempotency-Key", idempotencyKey)
            .send();

        expect(res1.status).toBe(201);
        const orderId = res1.body.data.id;
        expect(store.getProduct("prod-keyboard")!.inventory).toBe(
            initialStock - 1,
        );
        expect(store.getOrderCount()).toBe(1);

        // 2. Client retry with identical key (simulating network timeout response recovery)
        const res2 = await request(app)
            .post(`/api/carts/${cartId}/checkout`)
            .set("Idempotency-Key", idempotencyKey)
            .send();

        expect(res2.status).toBe(200);
        expect(res2.body.message).toContain("idempotent replay");
        expect(res2.body.data.id).toBe(orderId);

        // INVARIANT: Inventory must NOT be deducted again, and order count remains 1
        expect(store.getProduct("prod-keyboard")!.inventory).toBe(
            initialStock - 1,
        );
        expect(store.getOrderCount()).toBe(1);
    });
});
