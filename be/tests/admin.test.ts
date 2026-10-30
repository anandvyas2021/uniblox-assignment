import request from "supertest";
import { describe, it, expect, beforeEach } from "vitest";

import { app } from "../src/app";
import { store } from "../src/store/in-memory-store";

describe("Admin Milestone Coupons & Financial Reconciliation", () => {
    beforeEach(() => {
        store.reset();
    });

    describe("Milestone Coupon Generation", () => {
        it("generates a coupon only when the configured milestone is reached", async () => {
            // Configure milestone n=3, x=15%
            await request(app).post("/api/admin/config").send({ n: 3, x: 15 });

            // 0 orders placed -> Attempt to generate coupon -> 422
            const res0 = await request(app)
                .post("/api/admin/coupons/generate")
                .send();
            expect(res0.status).toBe(422);
            expect(res0.body.error.code).toBe("MILESTONE_NOT_REACHED");

            // Place 2 orders
            for (let i = 0; i < 2; i++) {
                const cart = await request(app).post("/api/carts").send();
                await request(app)
                    .post(`/api/carts/${cart.body.data.id}/items`)
                    .send({ productId: "prod-cable", quantity: 1 });
                await request(app)
                    .post(`/api/carts/${cart.body.data.id}/checkout`)
                    .send();
            }

            // 2 orders placed -> Still 422
            const res2 = await request(app)
                .post("/api/admin/coupons/generate")
                .send();
            expect(res2.status).toBe(422);

            // Place 3rd order (milestone reached!)
            const cart3 = await request(app).post("/api/carts").send();
            await request(app)
                .post(`/api/carts/${cart3.body.data.id}/items`)
                .send({ productId: "prod-cable", quantity: 1 });
            await request(app)
                .post(`/api/carts/${cart3.body.data.id}/checkout`)
                .send();

            // Now generation succeeds (201)
            const res3 = await request(app)
                .post("/api/admin/coupons/generate")
                .send();
            expect(res3.status).toBe(201);
            expect(res3.body.data.discountPercent).toBe(15);
            expect(res3.body.data.milestoneOrderNumber).toBe(3);
            expect(res3.body.data.status).toBe("AVAILABLE");

            // Immediate second generation attempt for milestone 3 is rejected
            const resDuplicate = await request(app)
                .post("/api/admin/coupons/generate")
                .send();
            expect(resDuplicate.status).toBe(422);
            expect(resDuplicate.body.error.code).toBe("MILESTONE_NOT_REACHED");
        });
    });

    describe("Financial & Inventory Reconciliation Audit", () => {
        it("accurately reconciles gross revenue, discounts, net revenue, and quantities without state mutation", async () => {
            // 1. Place order 1: 1 Laptop ($1,299.00 = 129900 cents)
            const cart1 = await request(app).post("/api/carts").send();
            await request(app)
                .post(`/api/carts/${cart1.body.data.id}/items`)
                .send({ productId: "prod-laptop", quantity: 1 });
            await request(app)
                .post(`/api/carts/${cart1.body.data.id}/checkout`)
                .send();

            // 2. Unlock a 10% coupon with milestone n=1
            store.setMilestoneConfig(1, 10);
            const couponRes = await request(app)
                .post("/api/admin/coupons/generate")
                .send();
            const couponCode = couponRes.body.data.code;

            // 3. Place order 2 with coupon: 2 Headphones (2 x 19900 = 39800 cents)
            // 10% discount on 39800 = 3980 cents. Net = 35820 cents.
            const cart2 = await request(app).post("/api/carts").send();
            await request(app)
                .post(`/api/carts/${cart2.body.data.id}/items`)
                .send({ productId: "prod-headphones", quantity: 2 });
            await request(app)
                .post(`/api/carts/${cart2.body.data.id}/checkout`)
                .send({ couponCode });

            // 4. Request Admin Summary Report
            const reportRes = await request(app)
                .get("/api/admin/reports/summary")
                .send();
            expect(reportRes.status).toBe(200);
            const report = reportRes.body.data;

            // Mathematical Reconciliation:
            const expectedGross = 129900 + 39800; // 169700 cents ($1,697.00)
            const expectedDiscount = 3980; // $39.80
            const expectedNet = expectedGross - expectedDiscount; // 165720 cents ($1,657.20)

            expect(report.grossRevenueInCents).toBe(expectedGross);
            expect(report.totalDiscountsInCents).toBe(expectedDiscount);
            expect(report.netRevenueInCents).toBe(expectedNet);
            expect(report.formattedNetRevenue).toBe("$1,657.20");

            // Strict Equation: Net = Gross - Discount
            expect(
                report.grossRevenueInCents - report.totalDiscountsInCents,
            ).toBe(report.netRevenueInCents);

            // Quantities sold
            const laptopSale = report.productSales.find(
                (p: any) => p.productId === "prod-laptop",
            );
            expect(laptopSale.quantitySold).toBe(1);

            const headphonesSale = report.productSales.find(
                (p: any) => p.productId === "prod-headphones",
            );
            expect(headphonesSale.quantitySold).toBe(2);

            // Coupons reconciliation
            expect(report.coupons.generated).toBe(1);
            expect(report.coupons.available).toBe(0);
            expect(report.coupons.redeemed).toBe(1);
            expect(report.coupons.generated).toBe(
                report.coupons.available + report.coupons.redeemed,
            );
            expect(report.totalOrdersPlaced).toBe(2);

            // Invariant: Multiple report requests do NOT mutate state
            const reportRes2 = await request(app)
                .get("/api/admin/reports/summary")
                .send();
            expect(reportRes2.body.data).toEqual(report);
        });
    });
});
