import { Product } from "../types";

export const INITIAL_PRODUCTS: Product[] = [
    {
        id: "prod-laptop",
        name: 'Pro Laptop 15"',
        priceInCents: 129900, // $1,299.00
        inventory: 20,
    },
    {
        id: "prod-headphones",
        name: "Wireless Noise-Canceling Headphones",
        priceInCents: 19900, // $199.00
        inventory: 35,
    },
    {
        id: "prod-keyboard",
        name: "Mechanical Gaming Keyboard",
        priceInCents: 8900, // $89.00
        inventory: 15,
    },
    {
        id: "prod-cable",
        name: "Braided USB-C Cable (2m)",
        priceInCents: 1500, // $15.00
        inventory: 100,
    },
    {
        id: "prod-limited-mousepad",
        name: "Limited Edition Desk Mat (Collector Item)",
        priceInCents: 4500, // $45.00
        inventory: 2, // Limited inventory: strictly 2 in stock for testing race conditions
    },
];
