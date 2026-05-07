/**
 * Orders API client wrapper — Stage 3.9.B.3
 *
 * Wraps GET /api/orders for the Assets sub-tab and Order History.
 * POST/PATCH endpoints exist server-side but are deferred to stage 5
 * when payment integration lands; for 3.9.B we only read.
 */
import { apiClient } from './api';

export type OrderStatus =
  | 'pending_payment'
  | 'pending_selection'
  | 'paid'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type Order = {
  id: string;
  user_id: string;
  product_type: 'wisdom_book' | 'wisdom_cards';
  status: OrderStatus;
  amount: number;
  currency: string;
  payment_intent_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  shipping_name: string | null;
  shipping_address: string | null;
  shipping_city: string | null;
  shipping_state: string | null;
  shipping_zip: string | null;
  shipping_country: string | null;
  shipping_phone: string | null;
  selected_card_ids: string[] | null;
  tracking_number: string | null;
  notes: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string | null;
};

export type FetchOrdersResponse = {
  success: boolean;
  orders: Order[];
};

export async function fetchOrders(userId: string): Promise<FetchOrdersResponse> {
  const qs = new URLSearchParams({ userId });
  return apiClient.get<FetchOrdersResponse>(`/api/orders?${qs.toString()}`);
}

// ---- Mutations (Stage 5.AIR.1) ----

export type ShippingPayload = {
  name: string;
  address: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
};

export type CreateOrderParams = {
  userId: string;
  productType: 'wisdom_book' | 'wisdom_cards';
  amount: number;
  shipping: ShippingPayload;
  status?: OrderStatus;
};

export type CreateOrderResponse = {
  success: boolean;
  order: Order;
};

/**
 * Create a new order row. Mobile calls this BEFORE creating the
 * Airwallex paymentIntent, with status='pending_payment'. The
 * resulting order.id becomes the originalOrderId embedded in the
 * paymentIntent metadata so the webhook can route the success
 * event back to this row.
 */
export async function createOrder(
  params: CreateOrderParams,
): Promise<CreateOrderResponse> {
  return apiClient.post<CreateOrderResponse>('/api/orders', {
    userId: params.userId,
    productType: params.productType,
    amount: params.amount,
    shipping: params.shipping,
    status: params.status ?? 'pending_payment',
  });
}

export type UpdateOrderParams = {
  orderId: string;
  status: OrderStatus;
  paymentIntentId?: string;
  trackingNumber?: string;
  notes?: string;
  selectedCardIds?: string[];
};

export type UpdateOrderResponse = {
  success: boolean;
  order: Order;
};

/**
 * PATCH an existing order. Used in two places:
 *   1. After paymentIntent creation, to attach the paymentIntentId
 *      to the pending_payment row (insurance in case the webhook
 *      doesn't get there: lets us correlate manually).
 *   2. After cards-select (5.AIR.2), to set
 *      selected_card_ids + status='paid'.
 *
 * NOTE: status updates from pending_payment -> paid for wisdom_book
 * and pending_payment -> pending_selection for wisdom_cards are
 * authoritative-driven by the Airwallex webhook, NOT by this client
 * call. The client should not race the webhook.
 */
export async function updateOrder(
  params: UpdateOrderParams,
): Promise<UpdateOrderResponse> {
  return apiClient.patch<UpdateOrderResponse>('/api/orders', {
    orderId: params.orderId,
    status: params.status,
    paymentIntentId: params.paymentIntentId,
    trackingNumber: params.trackingNumber,
    notes: params.notes,
    selectedCardIds: params.selectedCardIds,
  });
}
