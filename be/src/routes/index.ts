import { Router, Request, Response } from "express";

import { store } from "../store/in-memory-store";
import { formatCentsToCurrency, asyncHandler } from "../utils";
import {
    handleGetCart,
    handleCreateCart,
    handleAddItemToCart,
    handleRemoveCartItem,
    handleUpdateCartItemQuantity,
} from "../controllers/cart.controller";
import {
    handleCheckout,
    handleGetOrder,
} from "../controllers/checkout.controller";
import {
    handleGetSummaryReport,
    handleGenerateMilestoneCoupon,
    handleUpdateMilestoneConfig,
} from "../controllers/admin.controller";

const router = Router();

// --- Product Catalog (Helper for API clients/evaluators) ---
router.get(
    "/products",
    asyncHandler(async (_req: Request, res: Response) => {
        const products = store.getAllProducts();
        res.status(200).json({
            data: products.map((prod) => ({
                ...prod,
                formattedPrice: formatCentsToCurrency(prod.priceInCents),
            })),
        });
    }),
);

// --- Cart Operations ---
router.post("/carts", handleCreateCart);
router.get("/carts/:id", handleGetCart);
router.post("/carts/:id/items", handleAddItemToCart);
router.patch("/carts/:id/items/:productId", handleUpdateCartItemQuantity);
router.delete("/carts/:id/items/:productId", handleRemoveCartItem);

// --- Checkout & Orders ---
router.post("/carts/:id/checkout", handleCheckout);
router.get("/orders/:id", handleGetOrder);

// --- Administrative Endpoints ---
router.post("/admin/coupons/generate", handleGenerateMilestoneCoupon);
router.get("/admin/reports/summary", handleGetSummaryReport);
router.post("/admin/config", handleUpdateMilestoneConfig);

export default router;
