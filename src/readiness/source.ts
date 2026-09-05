import { IngestionResult, ingestCsv } from "./ingestCsv.js";

export interface CatalogSourceConfig {
  merchantId: string;
  merchantName: string;
}

export interface CatalogSource {
  name: string;
  type: "CSV" | "SHOPIFY" | "API";
  import(config: CatalogSourceConfig): Promise<IngestionResult>;
}

export class CsvCatalogSource implements CatalogSource {
  name = "CSV Catalog Source";
  type = "CSV" as const;

  constructor(private csvContent: string) {}

  async import(config: CatalogSourceConfig): Promise<IngestionResult> {
    // Policies are kept separate from the source adapter.
    // The source adapter is purely for extracting catalog data.
    return ingestCsv(this.csvContent, config.merchantId, config.merchantName, {});
  }
}
