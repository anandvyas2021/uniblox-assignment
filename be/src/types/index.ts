export interface Product {
    id: string;
    name: string;
    priceInCents: number; // Stored as integer cents (e.g. $19.99 = 1999)
    inventory: number;
}

export interface CartItem {
    productId: string;
    name: string;
    quantity: number;
    unitPriceInCents: number;
    totalPriceInCents: number;
}

export type CartStatus = "ACTIVE" | "CHECKED_OUT";

export interface Cart {
    id: string;
    status: CartStatus;
    items: CartItem[];
    subtotalInCents: number;
    createdAt: Date;
    updatedAt: Date;
}

export type CouponStatus = "AVAILABLE" | "REDEEMED";

export interface Coupon {
    code: string;
    discountPercent: number; // e.g. 10 for 10%
    milestoneOrderNumber: number; // The n-th order milestone that unlocked this coupon
    status: CouponStatus;
    redeemedByOrderId?: string;
    createdAt: Date;
    redeemedAt?: Date;
}

export interface OrderItem {
    productId: string;
    productName: string;
    unitPriceInCents: number;
    quantity: number;
    totalPriceInCents: number;
}

export interface Order {
    id: string;
    orderNumber: number; // 1, 2, 3... used for tracking milestones
    cartId: string;
    items: OrderItem[];
    grossTotalInCents: number;
    discountInCents: number;
    netTotalInCents: number;
    couponCodeApplied?: string;
    idempotencyKey?: string;
    createdAt: Date;
}

export interface ProductSalesReport {
    productId: string;
    productName: string;
    quantitySold: number;
    totalGrossInCents: number;
}

export interface AdminSummaryReport {
    productSales: ProductSalesReport[];
    grossRevenueInCents: number;
    totalDiscountsInCents: number;
    netRevenueInCents: number;
    coupons: {
        generated: number;
        available: number;
        redeemed: number;
    };
    totalOrdersPlaced: number;
}
