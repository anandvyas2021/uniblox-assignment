import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";

import { app } from "../src/app";
import { store } from "../src/store/in-memory-store";

describe("Catalog & Cart Invariants", () => {
    beforeEach(() => {
        store.reset();
    });

    describe("System & Product Catalog", () => {
        it("responds to /health with status ok", async () => {
            const res = await request(app).get("/health").send();

            expect(res.status).toBe(200);
            expect(res.body.status).toBe("ok");
            expect(res.body.timestamp).toBeDefined();
        });

        it("lists all catalog products with formatted currency", async () => {
            const res = await request(app).get("/api/products").send();

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.data)).toBe(true);
            expect(res.body.data.length).toBe(5);

            const laptop = res.body.data.find(
                (p: { id: string }) => p.id === "prod-laptop",
            );
            expect(laptop).toBeDefined();
            expect(laptop.priceInCents).toBe(129900);
            expect(laptop.formattedPrice).toBe("$1,299.00");
        });
    });

    describe("Cart Lifecycle & Validations", () => {
        it("creates an empty active cart with subtotal 0", async () => {
            const res = await request(app).post("/api/carts").send();

            expect(res.status).toBe(201);
            expect(res.body.data.id).toBeDefined();
            expect(res.body.data.status).toBe("ACTIVE");
            expect(res.body.data.items).toEqual([]);
            expect(res.body.data.subtotalInCents).toBe(0);
            expect(res.body.data.formattedSubtotal).toBe("$0.00");
        });

        it("retrieves an existing cart by ID", async () => {
            const createRes = await request(app).post("/api/carts").send();
            const cartId = createRes.body.data.id;

            const res = await request(app).get(`/api/carts/${cartId}`).send();

            expect(res.status).toBe(200);
            expect(res.body.data.id).toBe(cartId);
            expect(res.body.data.status).toBe("ACTIVE");
            expect(res.body.data.subtotalInCents).toBe(0);
        });

        it("adds valid product to cart and accurately calculates integer totals", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            // Add 2 Laptops ($1,299.00 each = 129900 cents)
            const res = await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-laptop", quantity: 2 });

            expect(res.status).toBe(200);
            expect(res.body.data.items).toHaveLength(1);
            expect(res.body.data.items[0].quantity).toBe(2);
            expect(res.body.data.items[0].unitPriceInCents).toBe(129900);
            expect(res.body.data.items[0].totalPriceInCents).toBe(259800);
            expect(res.body.data.subtotalInCents).toBe(259800);
            expect(res.body.data.formattedSubtotal).toBe("$2,598.00");
        });

        it("accumulates quantity when adding an existing item again", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-cable", quantity: 3 });

            const res = await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-cable", quantity: 2 });

            expect(res.status).toBe(200);
            expect(res.body.data.items).toHaveLength(1);
            expect(res.body.data.items[0].quantity).toBe(5);
            expect(res.body.data.subtotalInCents).toBe(5 * 1500); // 7500 cents
        });

        it("updates quantity of an existing item in cart", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-keyboard", quantity: 2 });

            const res = await request(app)
                .patch(`/api/carts/${cartId}/items/prod-keyboard`)
                .send({ quantity: 5 });

            expect(res.status).toBe(200);
            expect(res.body.data.items).toHaveLength(1);
            expect(res.body.data.items[0].quantity).toBe(5);
            expect(res.body.data.subtotalInCents).toBe(5 * 8900);
        });

        it("removes an item completely from cart", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-cable", quantity: 2 });

            const res = await request(app)
                .delete(`/api/carts/${cartId}/items/prod-cable`)
                .send();

            expect(res.status).toBe(200);
            expect(res.body.data.items).toHaveLength(0);
            expect(res.body.data.subtotalInCents).toBe(0);
        });
    });

    describe("Defensive & Edge-Case Rejections", () => {
        it("rejects non-existent cart IDs with 404", async () => {
            const res = await request(app)
                .get("/api/carts/non-existent-cart-id")
                .send();
            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("NOT_FOUND");
        });

        it("rejects non-existent product IDs with 404", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            const res = await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "fake-product-xyz", quantity: 1 });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe("NOT_FOUND");
        });

        it("rejects zero, negative, and decimal quantities via Zod validation (400)", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            // Quantity = 0
            const resZero = await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-laptop", quantity: 0 });
            expect(resZero.status).toBe(400);

            // Quantity = -3
            const resNegative = await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-laptop", quantity: -3 });
            expect(resNegative.status).toBe(400);

            // Quantity = 1.5
            const resDecimal = await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-laptop", quantity: 1.5 });
            expect(resDecimal.status).toBe(400);
        });

        it("rejects adding more items than available stock with 409 Conflict", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            // 'prod-limited-mousepad' has exactly 2 in inventory
            const res = await request(app)
                .post(`/api/carts/${cartId}/items`)
                .send({ productId: "prod-limited-mousepad", quantity: 3 });

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe("INSUFFICIENT_INVENTORY");
            expect(res.body.error.details.availableInventory).toBe(2);
        });

        it("rejects updating an item that is not in the cart with 404", async () => {
            const cartRes = await request(app).post("/api/carts").send();
            const cartId = cartRes.body.data.id;

            const res = await request(app)
                .patch(`/api/carts/${cartId}/items/prod-laptop`)
                .send({ quantity: 1 });

            expect(res.status).toBe(404);
        });
    });
});
