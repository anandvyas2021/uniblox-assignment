import { Product, Cart, Order, Coupon, AdminSummaryReport } from "../types";
import { INITIAL_PRODUCTS } from "./seed-data";

export interface IdempotencyRecord {
    statusCode: number;
    body: unknown;
    createdAt: Date;
}

export class InMemoryStore {
    private products: Map<string, Product> = new Map();
    private carts: Map<string, Cart> = new Map();
    private orders: Map<string, Order> = new Map();
    private coupons: Map<string, Coupon> = new Map(); // Keyed by uppercase coupon code
    private idempotencyRecords: Map<string, IdempotencyRecord> = new Map();

    // Milestone Configuration: Every n-th order unlocks x% discount coupon
    private milestoneN: number = 5;
    private discountX: number = 10;
    private generatedMilestones: Set<number> = new Set(); // Tracks awarded milestone order numbers
    private orderCounter: number = 0;

    constructor() {
        this.reset();
    }

    /**
     * Resets the entire store to initial seeded state (vital for isolated unit tests).
     */
    public reset(): void {
        this.products.clear();
        this.carts.clear();
        this.orders.clear();
        this.coupons.clear();
        this.idempotencyRecords.clear();
        this.generatedMilestones.clear();
        this.orderCounter = 0;

        for (const prod of INITIAL_PRODUCTS) {
            this.products.set(prod.id, { ...prod });
        }
    }

    // --- Configuration ---
    public setMilestoneConfig(n: number, x: number): void {
        if (n <= 0 || x <= 0 || x > 100) {
            throw new Error(
                "Invalid milestone config: n must be > 0 and x must be between 1 and 100",
            );
        }
        this.milestoneN = n;
        this.discountX = x;
    }

    public getMilestoneConfig(): { n: number; x: number } {
        return { n: this.milestoneN, x: this.discountX };
    }

    // --- Products ---
    public getProduct(id: string): Product | undefined {
        const prod = this.products.get(id);
        return prod ? { ...prod } : undefined;
    }

    public getAllProducts(): Product[] {
        return Array.from(this.products.values()).map((p) => ({ ...p }));
    }

    // --- Carts ---
    public getCart(id: string): Cart | undefined {
        const cart = this.carts.get(id);
        return cart ? JSON.parse(JSON.stringify(cart)) : undefined;
    }

    public saveCart(cart: Cart): void {
        this.carts.set(cart.id, JSON.parse(JSON.stringify(cart)));
    }

    // --- Orders ---
    public getOrder(id: string): Order | undefined {
        const order = this.orders.get(id);
        return order ? JSON.parse(JSON.stringify(order)) : undefined;
    }

    public getAllOrders(): Order[] {
        return Array.from(this.orders.values()).map((o) =>
            JSON.parse(JSON.stringify(o)),
        );
    }

    public getOrderCount(): number {
        return this.orders.size;
    }

    // --- Coupons ---
    public getCoupon(code: string): Coupon | undefined {
        const coupon = this.coupons.get(code.trim().toUpperCase());
        return coupon ? { ...coupon } : undefined;
    }

    public getAllCoupons(): Coupon[] {
        return Array.from(this.coupons.values()).map((c) => ({ ...c }));
    }

    // --- Idempotency ---
    public getIdempotencyRecord(key: string): IdempotencyRecord | undefined {
        return this.idempotencyRecords.get(key);
    }

    public saveIdempotencyRecord(key: string, record: IdempotencyRecord): void {
        this.idempotencyRecords.set(key, record);
    }

    /**
     * Evaluates if an unrewarded milestone has been reached.
     * Returns the next eligible milestone order number, or null if not eligible.
     */
    public getEligibleMilestone(): number | null {
        const totalOrders = this.orders.size;
        if (totalOrders < this.milestoneN) return null;

        // Highest milestone order reached so far (e.g. 12 orders with n=5 -> milestone 10)
        const latestReachedMilestone =
            Math.floor(totalOrders / this.milestoneN) * this.milestoneN;

        // Find the lowest unrewarded milestone
        for (
            let m = this.milestoneN;
            m <= latestReachedMilestone;
            m += this.milestoneN
        ) {
            if (!this.generatedMilestones.has(m)) {
                return m;
            }
        }
        return null;
    }

    /**
     * Generates a coupon for an eligible milestone.
     * Returns the created Coupon, or null if no milestone is eligible.
     */
    public generateMilestoneCoupon(): Coupon | null {
        const eligibleMilestone = this.getEligibleMilestone();
        if (!eligibleMilestone) return null;

        const code = `REWARD-${eligibleMilestone}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`;
        const coupon: Coupon = {
            code,
            discountPercent: this.discountX,
            milestoneOrderNumber: eligibleMilestone,
            status: "AVAILABLE",
            createdAt: new Date(),
        };

        this.coupons.set(code, coupon);
        this.generatedMilestones.add(eligibleMilestone);
        return { ...coupon };
    }

    /**
     * Executes a state transition atomically with rollback capability.
     * If action throws, any mutation is reverted.
     */
    public runTransaction<T>(
        action: (txState: {
            products: Map<string, Product>;
            carts: Map<string, Cart>;
            orders: Map<string, Order>;
            coupons: Map<string, Coupon>;
            nextOrderNumber: number;
        }) => T,
    ): T {
        // 1. Create a deep clone snapshot of the mutable state
        const productsSnapshot = new Map(
            Array.from(this.products.entries()).map(([k, v]) => [k, { ...v }]),
        );
        const cartsSnapshot = new Map(
            Array.from(this.carts.entries()).map(([k, v]) => [
                k,
                JSON.parse(JSON.stringify(v)),
            ]),
        );
        const ordersSnapshot = new Map(
            Array.from(this.orders.entries()).map(([k, v]) => [
                k,
                JSON.parse(JSON.stringify(v)),
            ]),
        );
        const couponsSnapshot = new Map(
            Array.from(this.coupons.entries()).map(([k, v]) => [k, { ...v }]),
        );

        const txState = {
            products: productsSnapshot,
            carts: cartsSnapshot,
            orders: ordersSnapshot,
            coupons: couponsSnapshot,
            nextOrderNumber: this.orderCounter + 1,
        };

        try {
            // 2. Execute transaction operations
            const result = action(txState);

            // 3. Commit staged changes on success
            this.products = txState.products;
            this.carts = txState.carts;
            this.orders = txState.orders;
            this.coupons = txState.coupons;
            this.orderCounter = txState.orders.size;

            return result;
        } catch (err) {
            // Snapshot is discarded; state remains untouched
            throw err;
        }
    }

    /**
     * Generates the financial and reconciliation report.
     * Guaranteed idempotent (read-only, does not mutate state).
     */
    public getReconciliationReport(): AdminSummaryReport {
        const productSalesMap = new Map<
            string,
            { name: string; quantity: number; grossInCents: number }
        >();

        // Initialize all known products in report with 0
        for (const prod of this.products.values()) {
            productSalesMap.set(prod.id, {
                name: prod.name,
                quantity: 0,
                grossInCents: 0,
            });
        }

        let grossRevenueInCents = 0;
        let totalDiscountsInCents = 0;
        let netRevenueInCents = 0;

        for (const order of this.orders.values()) {
            grossRevenueInCents += order.grossTotalInCents;
            totalDiscountsInCents += order.discountInCents;
            netRevenueInCents += order.netTotalInCents;

            for (const item of order.items) {
                const existing = productSalesMap.get(item.productId) ?? {
                    name: item.productName,
                    quantity: 0,
                    grossInCents: 0,
                };
                existing.quantity += item.quantity;
                existing.grossInCents += item.totalPriceInCents;
                productSalesMap.set(item.productId, existing);
            }
        }

        const productSales = Array.from(productSalesMap.entries()).map(
            ([id, data]) => ({
                productId: id,
                productName: data.name,
                quantitySold: data.quantity,
                totalGrossInCents: data.grossInCents,
            }),
        );

        let availableCoupons = 0;
        let redeemedCoupons = 0;
        for (const coupon of this.coupons.values()) {
            if (coupon.status === "AVAILABLE") availableCoupons++;
            if (coupon.status === "REDEEMED") redeemedCoupons++;
        }

        return {
            productSales,
            grossRevenueInCents,
            totalDiscountsInCents,
            netRevenueInCents,
            coupons: {
                generated: this.coupons.size,
                available: availableCoupons,
                redeemed: redeemedCoupons,
            },
            totalOrdersPlaced: this.orders.size,
        };
    }
}

// Global Singleton Store Instance
export const store = new InMemoryStore();
