// Administrator operations

import { store } from "../store/in-memory-store";
import { AdminSummaryReport, Coupon } from "../types";
import { formatCentsToCurrency } from "../utils";
import {
    MilestoneConfigInput,
    updateMilestoneConfig,
    generateAdminMilestoneCoupon,
} from "./coupon.service";

export interface FormattedAdminSummaryReport extends AdminSummaryReport {
    formattedGrossRevenue: string;
    formattedTotalDiscounts: string;
    formattedNetRevenue: string;
    productSales: (AdminSummaryReport["productSales"][number] & {
        formattedGrossRevenue: string;
    })[];
}

/**
 * Generates the non-mutating full store summary and financial reconciliation report.
 */
export function getAdminSummaryReport(): FormattedAdminSummaryReport {
    const rawReport = store.getReconciliationReport();

    return {
        ...rawReport,
        formattedGrossRevenue: formatCentsToCurrency(
            rawReport.grossRevenueInCents,
        ),
        formattedTotalDiscounts: formatCentsToCurrency(
            rawReport.totalDiscountsInCents,
        ),
        formattedNetRevenue: formatCentsToCurrency(rawReport.netRevenueInCents),
        productSales: rawReport.productSales.map((item) => ({
            ...item,
            formattedGrossRevenue: formatCentsToCurrency(
                item.totalGrossInCents,
            ),
        })),
    };
}

/**
 * Manually requests generation of an eligible milestone discount coupon.
 */
export function generateCouponForEligibleMilestone(): Coupon {
    return generateAdminMilestoneCoupon();
}

/**
 * Updates milestone configuration (e.g. n=5, x=10).
 */
export function setAdminMilestoneConfig(input: MilestoneConfigInput): {
    n: number;
    x: number;
} {
    return updateMilestoneConfig(input);
}
