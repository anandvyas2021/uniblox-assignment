import { Request, Response } from "express";

import { asyncHandler, formatCentsToCurrency } from "../utils";
import {
    getAdminSummaryReport,
    setAdminMilestoneConfig,
    generateCouponForEligibleMilestone,
} from "../services/admin.service";

/**
 * POST /api/admin/coupons/generate - Generate coupon when milestone reached
 */
export const handleGenerateMilestoneCoupon = asyncHandler(
    async (_req: Request, res: Response) => {
        const coupon = generateCouponForEligibleMilestone();

        res.status(201).json({
            message: "Milestone discount coupon generated successfully",
            data: coupon,
        });
    },
);

/**
 * GET /api/admin/reports/summary - Financial and reconciliation report
 */
export const handleGetSummaryReport = asyncHandler(
    async (_req: Request, res: Response) => {
        const report = getAdminSummaryReport();

        res.status(200).json({
            data: {
                ...report,
                productSales: report.productSales.map((item) => ({
                    ...item,
                    formattedGrossRevenue: formatCentsToCurrency(
                        item.totalGrossInCents,
                    ),
                })),
            },
        });
    },
);

/**
 * POST /api/admin/config - Update milestone settings (n and x)
 */
export const handleUpdateMilestoneConfig = asyncHandler(
    async (req: Request, res: Response) => {
        const config = setAdminMilestoneConfig(req.body);

        res.status(200).json({
            message: "Milestone configuration updated",
            data: config,
        });
    },
);
