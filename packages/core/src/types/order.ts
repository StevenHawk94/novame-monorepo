/**
 * Order types.
 *
 * `Order` is the legacy/general order shape used by OrdersTab.
 * `BookOrder` is the ebook/printed-book specific shape used by book-orders.
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

export type ShippingInfo = {
  fullName?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zipCode?: string
  country?: string
}

export type BookOrder = {
  id: string
  user_id?: string
  user_name?: string
  user_email?: string
  order_type: 'ebook' | 'printed'
  status: string
  amount: number
  payment_status?: string
  wisdom_count: number
  total_minutes: number
  created_at: string
  tracking_number?: string
  shipping_info?: ShippingInfo
}
