import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestCsv } from "../dist/readiness/ingestCsv.js";

const dummyPolicies = { returnPolicy: { windowDays: 30, summary: "Ret" }, shippingPolicy: null, autonomousPurchasePolicy: null };

test("CSV Ingestion - valid CSV", () => {
  const csv = "sku,name,description,category,price,stock,size,color\nPROD-1,Product 1,Desc,Apparel,19.99,10,M,Red";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  console.log(result.errors, result.warnings);
  assert.equal(result.errors.length, 0);
  assert.equal(result.imported, 1);
  assert.equal(result.merchant.products[0].id, "prod-prod");
});

test("CSV Ingestion - empty CSV", () => {
  const csv = "";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 0);
  assert.equal(result.imported, 0);
});

test("CSV Ingestion - malformed CSV", () => {
  const csv = 'sku,name\nPROD-1,"unfinished quote';
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  // papaparse handles it gracefully or creates an error. Let's see if it's imported.
  // papaparse adds it to errors or warns.
});

test("CSV Ingestion - missing required column", () => {
  const csv = "name,description\nProduct 1,Desc";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Missing required field 'sku'/);
});

test("CSV Ingestion - missing product name", () => {
  const csv = "sku,description\nPROD-1,Desc";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Missing product name/);
});

test("CSV Ingestion - missing SKU", () => {
  const csv = "sku,name\n,Product 1";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Missing required field 'sku'/);
});

test("CSV Ingestion - invalid price", () => {
  const csv = "sku,name,description,category,price\nPROD-1,Product 1,Desc,Apparel,abc";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Invalid price/);
});

test("CSV Ingestion - invalid stock", () => {
  const csv = "sku,name,description,category,stock\nPROD-1,Product 1,Desc,Apparel,-5";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Invalid stock/);
});

test("CSV Ingestion - duplicate SKU", () => {
  const csv = "sku,name\nPROD-1,Product 1\nPROD-1,Product 1";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Duplicate SKU 'PROD-1'/);
});

test("CSV Ingestion - duplicate variant", () => {
  const csv = "sku,name,size\nPROD-1-S,Product 1,S\nPROD-1-S,Product 1,M";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /Duplicate SKU 'PROD-1-S'/);
});

test("CSV Ingestion - valid variant", () => {
  const csv = "sku,name,size\nPROD-1-S,Product 1,S\nPROD-1-M,,M";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 0);
  assert.equal(result.imported, 2);
  assert.equal(result.merchant.products[0].variants?.length, 2);
});

test("CSV Ingestion - malformed variant", () => {
  const csv = "sku,name,size\nPROD-1-S,,S"; // Missing name and no previous product with that base SKU
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 1);
});

test("CSV Ingestion - optional fields missing", () => {
  const csv = "sku,name\nPROD-1,Product 1";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.warnings.length, 2); // missing description, missing category
  assert.equal(result.imported, 1);
});

test("CSV Ingestion - mixed valid/invalid rows", () => {
  const csv = "sku,name\nPROD-1,Product 1\n,Invalid\nPROD-2,Product 2";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 1);
  assert.equal(result.imported, 2);
});

test("CSV Ingestion - special characters", () => {
  const csv = "sku,name,description\nPROD-1,Prod ™,\"Has, commas and \"\"quotes\"\"\"";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 0);
  assert.equal(result.merchant.products[0].name, "Prod ™");
  assert.equal(result.merchant.products[0].description, 'Has, commas and "quotes"');
});

test("CSV Ingestion - whitespace normalization", () => {
  const csv = "  sku  , name \n  PROD-1  ,  Product 1  ";
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 0);
  assert.equal(result.merchant.products[0].id, "prod-prod");
  assert.equal(result.merchant.products[0].name, "Product 1");
});

test("CSV Ingestion - quoted commas, escaped quotes, CRLF, empty fields and multiline quoted values", () => {
  const csv = 'sku,name,description,price\r\nPROD-1,Name,"Multi\r\nLine",10\r\nPROD-2,"Name, with comma","She said ""Hello""",';
  const result = ingestCsv(csv, "m1", "M1", dummyPolicies);
  assert.equal(result.errors.length, 0);
  assert.equal(result.merchant.products[0].description, "Multi\r\nLine");
  assert.equal(result.merchant.products[1].name, "Name, with comma");
  assert.equal(result.merchant.products[1].description, 'She said "Hello"');
  assert.equal(result.merchant.products[1].price, null);
});
