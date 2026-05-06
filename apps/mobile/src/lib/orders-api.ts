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
