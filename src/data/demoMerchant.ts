import type { MerchantData } from "../readiness/types.js";

/**
 * A realistic catalog with deliberate, bounded data-quality gaps for the
 * first readiness-audit demonstration.
 */
export const demoMerchant: MerchantData = {
  id: "merchant-coastal-store",
  name: "Coastal Store",
  products: [
    {
      id: "prod-linen-shirt",
      name: "Coastal Linen Shirt",
      description:
        "A breathable linen shirt with a relaxed fit, corozo buttons, and a lightweight feel for warm days.",
      category: "apparel ",
      attributes: {
        material: "linen",
        color: "blue",
        size: "S, M",
      },
      price: 2499,
      inventoryItemId: "inv-linen-shirt",
      variants: [
        { sku: "LIN-SHIRT-BLU-S", options: { color: "blue", size: "S" } },
        { sku: "LIN-SHIRT-BLU-M", options: { color: "blue", size: "M" } },
      ],
    },
    {
      id: "prod-travel-mug",
      name: "Travel Mug",
      description: "Steel mug.",
      category: "Home",
      attributes: {
        material: "stainless steel",
      },
      price: 0,
      inventoryItemId: "inv-travel-mug",
      variants: [
        { sku: "MUG-BLACK", options: { color: "black" } },
        { sku: "MUG-WHITE" },
      ],
    },
    {
      id: "prod-pocket-speaker",
      name: "",
      description:
        "A compact Bluetooth speaker with a 10-hour battery, USB-C charging, and a splash-resistant enclosure.",
      category: "Electronics",
      attributes: {
        brand: "Coastal Audio",
        warranty: "1 year",
      },
      price: 4999,
    },
  ],
  inventory: [
    {
      id: "inv-linen-shirt",
      productId: "prod-linen-shirt",
      sku: "LIN-SHIRT",
      quantity: 12,
    },
    {
      id: "inv-travel-mug",
      productId: "prod-travel-mug",
      sku: "MUG",
      quantity: -2,
    },
    {
      id: "inv-pocket-speaker",
      productId: "prod-pocket-speaker",
      sku: "SPKR-POCKET",
      quantity: 6,
    },
  ],
  policies: {
    returnPolicy: {
      windowDays: 30,
      summary: "Unused products can be returned in their original condition.",
    },
    shippingPolicy: {
      regions: ["India"],
      processingDays: 2,
    },
    // Deliberately omitted: the merchant must define this sensitive boundary.
  },
};
