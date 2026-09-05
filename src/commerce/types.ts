export interface CartItem {
  productId: string;
  variantId: string | null;
  quantity: number;
}

export interface Cart {
  id: string;
  merchantId: string;
  items: CartItem[];
}
