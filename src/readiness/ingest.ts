import type { MerchantData } from "./types.js";

/**
 * Establishes a non-mutating boundary between merchant-provided data and the
 * readiness engine. Semantic corrections deliberately do not happen here.
 */
export function ingestMerchant(data: MerchantData): MerchantData {
  return structuredClone(data);
}
