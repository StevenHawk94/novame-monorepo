/**
 * Order types.
 *
 * `Order` is the canonical shape for physical book/card orders managed
 * via the admin OrdersTab. The user submits orders from mobile/web,
 * admin processes them (status updates, tracking number, shipping).
 *
 * Legacy types removed in 1.4 round 2: BookOrder + ShippingInfo (the
 * ebook order system was deprecated and the dedicated /admin/book-orders
 * page was superseded by OrdersTab).
 */

export type Order = {
  id: string
  customer_name?: string
  customer_email?: string
  product_type: string
  status: string
  amount: number
  created_at: string
  tracking_number?: string
  notes?: string
  shipping_name?: string
  shipping_address?: string
  shipping_city?: string
  shipping_state?: string
  shipping_zip?: string
}
