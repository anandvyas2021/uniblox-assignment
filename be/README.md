# Solution & Implementation Guide

This document contains setup instructions, test execution details, and API documentation for the backend checkout and rewards service.

---

## Setup & Running

### Prerequisites

- Node.js v18 or higher
- npm v9 or higher

### Install Dependencies

```bash
npm install
```

### Start Development Server

```bash
npm run dev
```

The server listens on `http://localhost:3000`.  
Health check endpoint: `GET http://localhost:3000/health`

### Run Automated Tests

```bash
# Run the complete test suite (23 tests covering catalog, unit logic, failure modes, and race conditions)
npm test

# Run specifically the concurrency test suite
npm run test:concurrency
```

### Postman Collection

A ready-to-import Postman Collection v2.1.0 file is included in this repository:

- File: `postman_collection.json`
- Pre-configured with automatic variable chaining (`cartId`, `orderId`, `couponCode`), sample bodies, query/path parameters, and idempotency headers for all endpoints.
- Import into Postman App via `File` -> `Import` -> select `postman_collection.json`.

---

## Architecture & Concurrency Strategy

The service is written in TypeScript and Node.js using an in-memory data store with atomic state staging:

1. **Non-preemptive transaction execution:** Checkouts execute inside `store.runTransaction`. In Node.js, synchronous JavaScript execution is non-preemptive. By running stock checks, validations, stock deductions, coupon redemptions, and order snapshots within a single synchronous transaction block, race conditions are avoided within a single process. If any item is out of stock, the transaction throws and all staged mutations are discarded.
2. **Oversell protection:** Competing checkouts for limited inventory never result in negative stock. Requests exceeding stock fail with `409 Conflict (INSUFFICIENT_INVENTORY)`.
3. **Idempotency:** The checkout endpoint accepts an `Idempotency-Key` header. If a client retries a request with the same key (e.g. after a network timeout), the service replays the original order response without double-charging inventory or creating duplicate orders.
4. **Single-use coupons:** Coupons are redeemed once. If a checkout fails due to inventory or validation errors, the coupon remains available.
5. **Integer money calculations:** All monetary amounts are handled as integer cents to eliminate floating-point precision issues.

For a detailed breakdown of invariants, edge cases, and multi-instance evolution, refer to `DECISIONS.md`.

---

## API Reference

### 1. Products

#### `GET /api/products`

Lists all seeded products with current available inventory.

- **Status:** `200 OK`
- **Response:**

```json
{
    "data": [
        {
            "id": "prod-laptop",
            "name": "Pro Laptop 15\"",
            "priceInCents": 129900,
            "inventory": 20,
            "formattedPrice": "$1,299.00"
        },
        {
            "id": "prod-limited-mousepad",
            "name": "Limited Edition Desk Mat (Collector Item)",
            "priceInCents": 4500,
            "inventory": 2,
            "formattedPrice": "$45.00"
        }
    ]
}
```

---

### 2. Carts

#### `POST /api/carts`

Creates a new active cart.

- **Status:** `201 Created`
- **Response:**

```json
{
    "message": "Cart created successfully",
    "data": {
        "id": "c1f7b789-98bf-4c7b-b384-cb91e49f82d1",
        "status": "ACTIVE",
        "items": [],
        "subtotalInCents": 0,
        "formattedSubtotal": "$0.00"
    }
}
```

#### `GET /api/carts/:id`

Retrieves cart items with subtotals recalculated against current catalog prices.

- **Status:** `200 OK`

#### `POST /api/carts/:id/items`

Adds an item or increments its quantity in the cart.

- **Request Body:**

```json
{
    "productId": "prod-laptop",
    "quantity": 1
}
```

- **Status:** `200 OK`
- **Error:** `409 Conflict` if requested quantity exceeds available stock.

#### `PATCH /api/carts/:id/items/:productId`

Updates the quantity of an item in the cart.

- **Request Body:**

```json
{
    "quantity": 2
}
```

- **Status:** `200 OK`

#### `DELETE /api/carts/:id/items/:productId`

Removes an item from the cart.

- **Status:** `200 OK`

---

### 3. Checkout & Orders

#### `POST /api/carts/:id/checkout`

Validates stock, applies optional coupon, deducts inventory, locks the cart, and creates an order record.

- **Headers:** `Idempotency-Key: <string>` (optional, recommended for retry safety)
- **Request Body:**

```json
{
    "couponCode": "REWARD-5-ABCDE"
}
```

- **Status:** `201 Created` (or `200 OK` on idempotent replay)
- **Response:**

```json
{
    "message": "Order placed successfully",
    "data": {
        "id": "ord-883a-4efb-...",
        "orderNumber": 5,
        "cartId": "c1f7b789-...",
        "grossTotalInCents": 129900,
        "discountInCents": 12990,
        "netTotalInCents": 116910,
        "formattedGrossTotal": "$1,299.00",
        "formattedDiscount": "$129.90",
        "formattedNetTotal": "$1,169.10",
        "couponCodeApplied": "REWARD-5-ABCDE",
        "items": [
            {
                "productId": "prod-laptop",
                "productName": "Pro Laptop 15\"",
                "unitPriceInCents": 129900,
                "quantity": 1,
                "totalPriceInCents": 129900,
                "formattedUnitPrice": "$1,299.00",
                "formattedTotalPrice": "$1,299.00"
            }
        ]
    }
}
```

#### `GET /api/orders/:id`

Retrieves an order snapshot by ID.

- **Status:** `200 OK`

---

### 4. Admin Operations

#### `POST /api/admin/coupons/generate`

Generates a discount coupon if an unrewarded milestone (every n-th order) has been reached.

- **Status:** `201 Created`
- **Response:**

```json
{
    "message": "Milestone discount coupon generated successfully",
    "data": {
        "code": "REWARD-5-X9Y2A",
        "discountPercent": 10,
        "milestoneOrderNumber": 5,
        "status": "AVAILABLE"
    }
}
```

- **Error:** `422 Unprocessable Entity` if no unrewarded milestone has been achieved.

#### `GET /api/admin/reports/summary`

Returns financial and inventory reconciliation data. Read-only and does not mutate state.

- **Status:** `200 OK`
- **Response:**

```json
{
    "data": {
        "productSales": [
            {
                "productId": "prod-laptop",
                "productName": "Pro Laptop 15\"",
                "quantitySold": 5,
                "totalGrossInCents": 649500,
                "formattedGrossRevenue": "$6,495.00"
            }
        ],
        "grossRevenueInCents": 649500,
        "totalDiscountsInCents": 12990,
        "netRevenueInCents": 636510,
        "formattedGrossRevenue": "$6,495.00",
        "formattedTotalDiscounts": "$129.90",
        "formattedNetRevenue": "$6,365.10",
        "coupons": {
            "generated": 1,
            "available": 0,
            "redeemed": 1
        },
        "totalOrdersPlaced": 5
    }
}
```

#### `POST /api/admin/config`

Updates milestone parameters (n and x).

- **Request Body:**

```json
{
    "n": 5,
    "x": 10
}
```

- **Status:** `200 OK`

---

## Verification via cURL

To test the basic flow manually:

```bash
# 1. Create a cart
curl -s -X POST http://localhost:3000/api/carts

# 2. Add item to cart
curl -s -X POST http://localhost:3000/api/carts/<CART_ID>/items \
  -H "Content-Type: application/json" \
  -d '{"productId": "prod-laptop", "quantity": 1}'

# 3. Checkout with idempotency key
curl -s -X POST http://localhost:3000/api/carts/<CART_ID>/checkout \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-req-001" \
  -d '{}'

# 4. View admin summary report
curl -s http://localhost:3000/api/admin/reports/summary
```
