export interface CommerceClient {
  searchProducts(query?: string): Promise<any>;
  getProduct(productId: string): Promise<any>;
  checkInventory(variantId: string, quantity: number): Promise<any>;
  createCart(): Promise<any>;
  addToCart(cartId: string, productId: string, variantId: string | null, quantity: number): Promise<any>;
  getCart(cartId: string): Promise<any>;
  checkout(cartId: string): Promise<any>;
}

export interface LlmClient {
  generate(payload: any): Promise<any>;
}

const SYSTEM_INSTRUCTION = `You are an AI Buyer assistant helping a user purchase products from the merchant.
Rules:
1. Use the merchant commerce tools to obtain product information.
2. Never invent products, prices, inventory or policies.
3. Never claim an item is available without checking inventory.
4. Never invent discounts.
5. Never modify prices.
6. Never bypass merchant policies.
7. Treat checkout results from the server as authoritative.
8. If checkout returns DENY, explain the reason and do not retry by attempting to circumvent the policy.
9. If checkout returns REQUIRE_APPROVAL, explain that merchant approval is required.
10. Only report a successful purchase after the server confirms successful payment verification.
11. Never directly call Razorpay.
12. Do not claim payment succeeded merely because a Razorpay order was created.
13. You must not execute checkout without explicitly asking the user to confirm their cart order first.`;

export const BUYER_TOOLS = [
  {
    name: "search_products",
    description: "Search the merchant's catalog for products.",
    parameters: { type: "object", properties: { query: { type: "string" } } }
  },
  {
    name: "get_product",
    description: "Get detailed information about a product, including its variants.",
    parameters: { type: "object", properties: { productId: { type: "string" } }, required: ["productId"] }
  },
  {
    name: "check_inventory",
    description: "Check if a specific variant (or product) has sufficient inventory.",
    parameters: { type: "object", properties: { variantId: { type: "string" }, quantity: { type: "number" } }, required: ["variantId", "quantity"] }
  },
  {
    name: "create_cart",
    description: "Create a new shopping cart. Returns the cart ID.",
    parameters: { type: "object", properties: {} }
  },
  {
    name: "add_to_cart",
    description: "Add an item to the cart.",
    parameters: { type: "object", properties: { cartId: { type: "string" }, productId: { type: "string" }, variantId: { type: "string" }, quantity: { type: "number" } }, required: ["cartId", "productId", "quantity"] }
  },
  {
    name: "get_cart",
    description: "Get the current contents and total of the cart.",
    parameters: { type: "object", properties: { cartId: { type: "string" } }, required: ["cartId"] }
  },
  {
    name: "checkout",
    description: "Attempt to checkout the cart. Returns ALLOW, DENY, or REQUIRE_APPROVAL.",
    parameters: { type: "object", properties: { cartId: { type: "string" } }, required: ["cartId"] }
  }
];

export class AIBuyer {
  public history: any[] = [];
  
  constructor(
    private commerceClient: CommerceClient,
    private llmClient: LlmClient,
    private onToolActivity?: (activity: string) => void
  ) {}

  public async chat(message: string): Promise<string> {
    this.history.push({ role: "user", parts: [{ text: message }] });
    return this.runLoop();
  }

  private async runLoop(): Promise<string> {
    const payload = {
      system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: this.history,
      tools: [{ function_declarations: BUYER_TOOLS }]
    };

    const response = await this.llmClient.generate(payload);
    
    if (!response || !response.candidates || response.candidates.length === 0) {
      throw new Error("Empty LLM response");
    }

    const message = response.candidates[0].content;
    
    // Sometimes the model returns a message without role. Default to "model"
    if (!message.role) message.role = "model";

    this.history.push(message);

    const parts = message.parts || [];
    const textPart = parts.find((p: any) => p.text);
    const functionCallPart = parts.find((p: any) => p.functionCall);

    if (functionCallPart) {
      const call = functionCallPart.functionCall;
      const result = await this.executeTool(call.name, call.args || {});
      
      this.history.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: call.name,
            // Gemini requires functionResponse.response to be a plain object.
            // Tool results may be arrays (e.g. searchProducts) or primitives;
            // wrap them so the proto field is never a list or scalar.
            response: { content: result }
          }
        }]
      });

      return this.runLoop();
    }

    return textPart ? textPart.text : "";
  }

  private async executeTool(name: string, args: any): Promise<any> {
    const allowedTools = ["search_products", "get_product", "check_inventory", "create_cart", "add_to_cart", "get_cart", "checkout"];
    if (!allowedTools.includes(name)) {
      return { error: `Tool ${name} is not allowed.` };
    }

    if (this.onToolActivity) {
      this.onToolActivity(`EXECUTING: ${name.toUpperCase().replace(/_/g, " ")}`);
    }

    try {
      switch (name) {
        case "search_products":
          return await this.commerceClient.searchProducts(args.query);
        case "get_product":
          return await this.commerceClient.getProduct(args.productId);
        case "check_inventory":
          return await this.commerceClient.checkInventory(args.variantId, args.quantity);
        case "create_cart":
          return await this.commerceClient.createCart();
        case "add_to_cart":
          return await this.commerceClient.addToCart(args.cartId, args.productId, args.variantId || null, args.quantity);
        case "get_cart":
          return await this.commerceClient.getCart(args.cartId);
        case "checkout":
          return await this.commerceClient.checkout(args.cartId);
        default:
          return { error: `Tool ${name} is not implemented.` };
      }
    } catch (e: any) {
      return { error: e.message };
    }
  }
}
