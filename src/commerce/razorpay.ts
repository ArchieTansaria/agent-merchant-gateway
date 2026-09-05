import { request as httpsRequest } from "node:https";
import { createHmac } from "node:crypto";

export interface CreateOrderParams {
  amount: number; // in smallest currency subunit (e.g. paise for INR)
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}

export interface RazorpayOrderResult {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createRazorpayOrder(params: CreateOrderParams): Promise<RazorpayOrderResult> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error("Razorpay configuration is missing");
  }

  const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const requestBody = JSON.stringify(params);

  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      "https://api.razorpay.com/v1/orders",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(requestBody),
          "Authorization": `Basic ${auth}`
        }
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: any) => body += chunk);
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Razorpay API Error ${res.statusCode}: ${body}`));
            return;
          }
          try {
            const data = JSON.parse(body);
            resolve(data);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(requestBody);
    req.end();
  });
}

export interface VerifyPaymentParams {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

export function verifyPaymentSignature(params: VerifyPaymentParams): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    throw new Error("Razorpay configuration is missing");
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = params;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return false;

  const text = `${razorpay_order_id}|${razorpay_payment_id}`;
  const generatedSignature = createHmac("sha256", keySecret)
    .update(text)
    .digest("hex");

  return generatedSignature === razorpay_signature;
}
