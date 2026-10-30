# Architectural Decisions & Invariant Specifications

This document outlines the core domain invariants, concurrency strategies, and design decisions made for the checkout and rewards service.

---

## 1. System Invariants

1. **Inventory non-negativity:** Available inventory for any product must never drop below zero. Concurrent checkout requests competing for limited stock must fail if demand exceeds stock; stock cannot be oversold.
2. **Checkout finality:** A cart transitions from ACTIVE to CHECKED_OUT at most once. Once checked out, a cart cannot be modified or checked out again.
3. **Idempotency:** A checkout request carrying an Idempotency-Key must return the same order on retries without creating a second order or deducting inventory a second time.
4. **Single-use coupons:** A discount coupon can be redeemed at most once across the entire system. Concurrent requests attempting to use the same coupon code must result in at most one successful redemption.
5. **Coupons preserved on failure:** A coupon is only consumed when the checkout transaction commits successfully. If checkout fails due to stockout or invalid input, the coupon remains available.
6. **Financial conservation:** Order net total is calculated as max(0, grossTotal - discount). An order total can never be negative.
7. **Reporting reconciliation:** Summary reports must reconcile with recorded orders and coupons:
    - Gross Revenue minus Total Discounts equals Net Revenue
    - Generated Coupons equals Available Coupons plus Redeemed Coupons
    - Sum of item quantities in reports equals sum of item quantities across orders
      Repeated report requests are read-only and do not mutate state.

---

## 2. Ambiguities & Selected Semantics

- **Catalog price changes while item is in cart:**
    - _Decision:_ The cart subtotal recalculates against current catalog prices upon retrieval. When checkout occurs, the unit price at that moment is permanently snapshotted into the order item record.
- **Coupon discount application on multi-item carts:**
    - _Decision:_ The discount percentage applies to the entire cart gross subtotal rather than item by item. This avoids fractional rounding discrepancies across multiple line items.
- **Milestone coupon generation:**
    - _Decision:_ Coupons are not auto-created on checkout. Instead, an administrative request checks if an unrewarded milestone (every n-th order) has been reached and generates one coupon per milestone.
- **Coupon code case sensitivity:**
    - _Decision:_ Codes are normalized to uppercase and trimmed before lookup or persistence to avoid accidental duplicates.

---

## 3. Material Design Decisions

### Decision 1: In-Memory Transaction Engine with Rollback Staging

**Context:**
The checkout process involves multiple state updates: verifying stock across multiple cart items, checking coupon validity, decrementing stock, marking the coupon redeemed, closing the cart, and creating an order. If one step fails (e.g. item 2 of 3 is out of stock), no partial updates should persist.

**Options considered:**

1. Direct in-place mutation of in-memory maps with manual compensation logic on failure.
2. Async mutex queue locking around checkout.
3. Synchronous transactional runner (`runTransaction`) with snapshot staging.

**Choice:**
Implemented a synchronous transactional runner where state changes are staged on copies of the maps. If an error is thrown, the staged state is dropped and the store remains untouched. If the block completes, the staged maps become the active state.

**Why:**
In Node.js, synchronous JavaScript execution runs run-to-completion without being interrupted by other event loop turns. By executing the validation and mutation phase synchronously without async pauses, race conditions are prevented in a single process without needing explicit lock queues.

**Consequences:**
Clean rollback and isolation without lock management overhead. In a distributed multi-instance deployment, this would be replaced with database transactions.

---

### Decision 2: Monetary Representation as Integer Cents

**Context:**
Standard JavaScript floating-point math causes rounding inaccuracies (e.g. 0.1 + 0.2 = 0.30000000000000004), which causes financial discrepancy between line items and summary reports.

**Options considered:**

1. Number floats with `.toFixed(2)` parsing.
2. Third-party decimal libraries (e.g. `bignumber.js`).
3. Storing and calculating all money values as integer cents.

**Choice:**
Stored all prices, discounts, and totals as integer cents (e.g. $19.99 is stored as 1999). Formatted currency strings (e.g. "$19.99") are generated only at the API response boundary.

**Why:**
Integer arithmetic avoids precision loss, keeps dependencies minimal, and matches how payment systems like Stripe handle currency.

**Consequences:**
API documentation and schemas must clearly state that amounts in payloads and calculations are in cents.

---

### Decision 3: Request Idempotency via Header Cache

**Context:**
Clients on unstable network connections may retry checkout requests after a timeout, risking double-charging or duplicate order placement.

**Options considered:**

1. Relying solely on `cart.status === 'CHECKED_OUT'` to reject retries.
2. Tracking an optional client-supplied `Idempotency-Key` header with cached response payloads.

**Choice:**
Supported an `Idempotency-Key` header. When present, the store checks if the key was already processed. If so, it returns the cached order response with a 200 status code rather than executing a new checkout.

**Why:**
If we only relied on cart status, the client's retry would receive a 409 Conflict, misleading the client into thinking their order failed. Returning the cached order confirms the transaction succeeded without side effects.

**Consequences:**
The store maintains a map of processed idempotency keys. In production, this would be stored in Redis with a TTL.

---

### Decision 4: Functional Services with Encapsulated Store

**Context:**
Structuring the backend logic between class-based service patterns vs functional modules.

**Options considered:**

1. Class-based services with dependency injection.
2. Functional service modules with an encapsulated singleton store.

**Choice:**
Kept the store as a single class to encapsulate in-memory state mutations, but wrote all domain services (cart, checkout, coupon, admin) as pure exported TypeScript functions.

**Why:**
Avoids `this` context binding issues in Express route handlers, reduces boilerplate, and makes functions simpler to unit test.

**Consequences:**
State lives exclusively in `InMemoryStore`, preventing state leakage across service files.

---

### Decision 5: Parameter Extraction & Error Model

**Context:**
Express 5 types route parameters and headers as `string | string[] | undefined`. Passing these directly into functions expecting strings causes TypeScript errors or potential runtime bugs.

**Options considered:**

1. Type casting (`req.params.id as string`) throughout controllers.
2. Centralized parameter extractor helpers combined with a clean error hierarchy.

**Choice:**
Created helper functions (`getParam`, `getHeader`) in `src/utils` to safely normalize parameters, along with a custom error hierarchy (`NotFoundError`, `ConflictError`, `ValidationError`, `UnprocessableEntityError`) handled by a centralized error middleware.

**Why:**
Prevents runtime bugs from unexpected array parameters and ensures consistent JSON error envelopes `{ error: { code, message, statusCode } }`.

**Consequences:**
Every controller follows the same signature and delegates error handling to middleware via an `asyncHandler` wrapper.

---

## 4. Transaction, Concurrency & Idempotency Strategy

- **Single process execution:** Node.js runs on a single-threaded event loop. By performing validation and state mutation inside a synchronous transaction block (`runTransaction`), concurrent requests queued on the event loop are executed sequentially. The first checkout deducts inventory; the next checkout immediately sees the updated stock and fails if insufficient.
- **Idempotency:** When an `Idempotency-Key` is supplied, the service checks `store.getIdempotencyRecord(key)`. On a match, it returns the cached order payload. On a miss, it runs the transaction and saves the result in the idempotency registry.
- **Coupon locking:** The coupon state is checked and updated inside the same atomic transaction as inventory. If two requests supply the same coupon, the first marks it REDEEMED; the second sees `status !== 'AVAILABLE'` and fails with 409 Conflict.

---

## 5. Scope: Implemented vs. Deferred

### Implemented:

- Cart management (create, view, add, update, remove items) with live catalog price refresh.
- Transactional checkout with stock validation, coupon application, and cart locking.
- Idempotent retries using `Idempotency-Key` header.
- Configurable milestone coupons (every n-th order gets x% off) and single-use enforcement.
- Admin summary report reconciling gross revenue, discounts, net revenue, and sold quantities.
- Automated test suite with 20 tests covering unit logic, validation failures, and concurrent race conditions.

### Intentionally Deferred:

1. **Persistent database:** Kept in-memory to provide zero-friction review (`npm install && npm test`) without external dependencies.
2. **Authentication/Authorization:** The prompt stated auth was not required; admin operations are grouped under `/api/admin/` routes.
3. **Cart inventory holds/TTL:** Carts do not reserve inventory upon adding; stock is validated and deducted at checkout.
4. **Payment integration:** Successful checkout represents payment completion.

---

## 6. Evolution to Distributed Multi-Instance Scale

To scale this service across multiple instances behind a load balancer:

1. **Database:** Replace the in-memory store with PostgreSQL. Use row-level locking during checkout:
    ```sql
    SELECT * FROM products WHERE id IN (...) FOR UPDATE;
    SELECT * FROM coupons WHERE code = ... FOR UPDATE;
    ```
2. **Distributed Idempotency:** Store idempotency keys in Redis with an atomic set:
    ```
    SET idempotency:<key> <order_json> NX EX 86400
    ```
3. **Event Publishing:** Publish `order.placed` events to a message queue (RabbitMQ/Kafka) for asynchronous tasks like receipt emails, analytics, and warehouse fulfillment.

---

## 7. AI Tool Usage Reflection

AI tools were used for scaffolding boilerplate, generating test permutations, and drafting baseline schemas. Human review and engineering judgment were applied to direct the code:

1. **Refactoring away from classes:** Initial AI output scaffolded service layers as classes. This was rejected in favor of functional TypeScript modules to eliminate `this` context binding issues in Express handlers.
2. **Handling Express 5 parameter types:** Addressed type errors where Express 5 types parameters as `string | string[] | undefined` by introducing helper functions rather than using unsafe type casts.
3. **Strict integer pricing:** Ensured all pricing models and calculations strictly used integer cents from the start, avoiding float conversion errors in discounts.

---

## 8. What to Examine Next Given Another 2 Hours

1. **Cart inventory reservation with expiration:** Implement a temporary reservation (e.g. 10 minutes) when entering checkout to prevent items from being bought while filling in details.
2. **OpenAPI / Swagger spec:** Add an interactive Swagger documentation endpoint (`/api-docs`) for manual exploration.
3. **Structured logging:** Integrate a lightweight logger (e.g. Pino) for structured JSON logs in production.
