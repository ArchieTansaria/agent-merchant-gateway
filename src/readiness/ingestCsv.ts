import Papa from "papaparse";
import type { MerchantData, Product, VariantInput, InventoryItem } from "./types.js";

export interface IngestionResult {
  merchant: MerchantData;
  imported: number;
  warnings: string[];
  errors: string[];
}

export function ingestCsv(
  csvContent: string,
  merchantId: string,
  merchantName: string,
  policies: MerchantData["policies"]
): IngestionResult {
  const result: IngestionResult = {
    merchant: {
      id: merchantId,
      name: merchantName,
      products: [],
      inventory: [],
      policies,
    },
    imported: 0,
    warnings: [],
    errors: [],
  };

  const parsed = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  if (csvContent.trim().length > 0 && parsed.errors.length > 0) {
    result.errors.push(...parsed.errors.map(e => `Row ${e.row}: ${e.message}`));
  }

  if (csvContent.trim().length === 0) {
    return result; // Empty CSV
  }

  const inventoryMap = new Map<string, InventoryItem>();
  const seenVariantSkus = new Set<string>();

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i] as Record<string, string>;
    const rowNum = i + 1;
    
    // Normalize keys to lowercase and trim for robustness
    const normalizedRow: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      normalizedRow[key.trim().toLowerCase()] = val.trim();
    }

    const sku = normalizedRow.sku;
    const name = normalizedRow.name;
    const category = normalizedRow.category;
    const description = normalizedRow.description;
    let priceStr = normalizedRow.price;
    const stockStr = normalizedRow.stock;
    const size = normalizedRow.size;
    const color = normalizedRow.color;

    if (!sku) {
      result.errors.push(`Row ${rowNum}: Missing required field 'sku'`);
      continue;
    }

    // Attempt to handle currency symbols in price (e.g. $49.99)
    if (priceStr && priceStr.startsWith("$")) {
        priceStr = priceStr.slice(1);
    }
    // Also remove commas from price if any
    if (priceStr) priceStr = priceStr.replace(/,/g, "");

    const price = priceStr ? Number(priceStr) : NaN;
    const stock = stockStr ? Number(stockStr) : NaN;

    // We group by base SKU (first part before dash) or name
    let baseSku = sku.split("-")[0];
    
    let product: Product | undefined;
    if (name) {
      if (!description) result.warnings.push(`Row ${rowNum}: Missing description`);
      if (!category) result.warnings.push(`Row ${rowNum}: Missing category`);
      product = result.merchant.products.find(p => p.name === name);
      if (!product) {
        product = {
          id: `prod-${baseSku.toLowerCase()}`,
          name: name,
          description: description || null,
          category: category || null,
          price: isNaN(price) ? null : price,
          inventoryItemId: `inv-${baseSku.toLowerCase()}`,
          variants: [],
          attributes: {}
        };
        result.merchant.products.push(product);
      }
    } else {
      product = result.merchant.products.find(p => sku.startsWith(p.id.replace("prod-", "").toUpperCase()) || sku.startsWith(p.id.replace("prod-", "")));
      if (!product) {
        result.errors.push(`Row ${rowNum}: Missing product name for new item '${sku}'`);
        continue;
      }
    }

    // Validate duplicates
    if (seenVariantSkus.has(sku)) {
      result.errors.push(`Row ${rowNum}: Duplicate SKU '${sku}'`);
      continue;
    }
    seenVariantSkus.add(sku);

    // Variants
    const options: Record<string, string> = {};
    if (size) options.size = size;
    if (color) options.color = color;
    
    if (Object.keys(options).length > 0 || (product.variants && product.variants.length > 0)) {
      product.variants = product.variants || [];
      product.variants.push({ sku, options: Object.keys(options).length > 0 ? options : null });
    }

    // Inventory
    if (!isNaN(stock)) {
      if (stock < 0 || !Number.isInteger(stock)) {
         result.warnings.push(`Row ${rowNum}: Invalid stock '${stockStr}'. Must be non-negative integer.`);
      }
      
      const invId = product.inventoryItemId!;
      if (!inventoryMap.has(invId)) {
         const invItem: InventoryItem = {
           id: invId,
           productId: product.id,
           sku: sku,
           quantity: stock
         };
         inventoryMap.set(invId, invItem);
         result.merchant.inventory.push(invItem);
      } else if (Object.keys(options).length > 0) {
         const existing = inventoryMap.get(invId)!;
         if (existing.quantity !== null && !isNaN(stock)) {
            existing.quantity += stock;
         }
      }
    } else if (stockStr) {
      result.warnings.push(`Row ${rowNum}: Invalid stock '${stockStr}'`);
    }

    if (isNaN(price) && priceStr) {
       result.warnings.push(`Row ${rowNum}: Invalid price '${priceStr}'`);
    }

    result.imported++;
  }

  return result;
}
