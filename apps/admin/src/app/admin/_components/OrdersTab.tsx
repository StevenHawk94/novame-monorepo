'use client';

import { useEffect, useState } from 'react';

// TODO(1.4): replace with shared type from @novame/core/types
type Order = {
  id: string;
  customer_name?: string;
  customer_email?: string;
  product_type: string;
  status: string;
  amount: number;
  created_at: string;
  tracking_number?: string;
  notes?: string;
  shipping_name?: string;
  shipping_address?: string;
  shipping_city?: string;
  shipping_state?: string;
  shipping_zip?: string;
};

type WisdomCardData = {
  quote_short?: string;
  insight_full?: string;
  card_b?: string;
  card_c?: string;
};

type WisdomEntry = {
  text?: string;
  created_at: string;
  card?: WisdomCardData;
};

type CardEntry = {
  keyword_id?: string;
  quote_short?: string;
  insight_full?: string;
};

type DownloadResponse = {
  success: boolean;
  customerName?: string;
  wisdoms?: WisdomEntry[];
  cards?: CardEntry[];
};

const STATUS_COLORS: Record<string, string> = {
  pending_payment: 'bg-blue-100 text-blue-700',
  paid: 'bg-blue-100 text-blue-700',
  processing: 'bg-yellow-100 text-yellow-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  refunded: 'bg-gray-100 text-black',
};

export default function OrdersTab() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editTracking, setEditTracking] = useState('');
  const [editNotes, setEditNotes] = useState('');

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const loadOrders = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/orders?status=${filter}`);
      const d = await r.json();
      setOrders(d.orders || []);
    } catch {}
    setLoading(false);
  };

  const updateStatus = async () => {
    if (!editOrder) return;
    await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: editOrder.id,
        status: editStatus,
        trackingNumber: editTracking,
        notes: editNotes,
      }),
    });
    setEditOrder(null);
    loadOrders();
  };

  const downloadContent = async (order: Order, type: 'book' | 'cards') => {
    const r = await fetch(`/api/orders?orderId=${order.id}&download=${type}`);
    const d: DownloadResponse = await r.json();
    if (!d.success) return alert('Download failed');

    if (type === 'book') {
      let content = `WISDOM BOOK - ${d.customerName}\n${'='.repeat(40)}\n\n`;
      (d.wisdoms || []).forEach((w, i) => {
        content += `--- Wisdom #${i + 1} (${new Date(
          w.created_at
        ).toLocaleDateString()}) ---\n\n`;
        content += `${w.text}\n\n`;
        if (w.card) {
          content += `Quote: ${w.card.quote_short}\n\n`;
          content += `Insight: ${w.card.insight_full}\n\n`;
          content += `Underlying Worry: ${w.card.card_b}\n\n`;
          content += `Lesson: ${w.card.card_c}\n\n`;
        }
        content += '\n';
      });
      const blob = new Blob([content], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wisdom-book-${d.customerName}.txt`;
      a.click();
    }

    if (type === 'cards') {
      let csv = 'keyword,quote_short,insight_full\n';
      (d.cards || []).forEach((c) => {
        csv += `"${c.keyword_id}","${(c.quote_short || '').replace(
          /"/g,
          '""'
        )}","${(c.insight_full || '').replace(/"/g, '""')}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wisdom-cards-${d.customerName}.csv`;
      a.click();
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-black">Orders</h2>
        <div className="flex gap-1">
          {[
            'all',
            'pending_payment',
            'paid',
            'processing',
            'shipped',
            'delivered',
            'cancelled',
          ].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${
                filter === f ? 'bg-blue-100 text-blue-700' : 'text-black'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Edit Modal */}
      {editOrder && (
        <div className="bg-white rounded-xl p-5 mb-4 border-2 border-blue-300">
          <h3 className="font-bold text-black mb-3">
            Update Order: {editOrder.id.substring(0, 8)}
          </h3>
          <div className="grid grid-cols-2 gap-3 mb-3 text-sm text-black">
            <div>
              <strong>Customer:</strong> {editOrder.customer_name}
            </div>
            <div>
              <strong>Product:</strong> {editOrder.product_type}
            </div>
            <div>
              <strong>Amount:</strong> ${editOrder.amount}
            </div>
            <div>
              <strong>Email:</strong> {editOrder.customer_email}
            </div>
            <div className="col-span-2">
              <strong>Shipping:</strong> {editOrder.shipping_name},{' '}
              {editOrder.shipping_address}, {editOrder.shipping_city},{' '}
              {editOrder.shipping_state} {editOrder.shipping_zip}
            </div>
          </div>
          <div className="flex gap-3 mb-3">
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value)}
              className="border rounded-lg px-3 py-2 text-sm text-black flex-1"
            >
              {[
                'paid',
                'processing',
                'shipped',
                'delivered',
                'cancelled',
                'refunded',
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              value={editTracking}
              onChange={(e) => setEditTracking(e.target.value)}
              placeholder="Tracking number"
              className="border rounded-lg px-3 py-2 text-sm text-black flex-1"
            />
          </div>
          <input
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Notes"
            className="w-full border rounded-lg px-3 py-2 text-sm text-black mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={updateStatus}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
            >
              Save
            </button>
            <button
              onClick={() =>
                downloadContent(
                  editOrder,
                  editOrder.product_type === 'wisdom_book' ? 'book' : 'cards'
                )
              }
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm"
            >
              📥 Download Content
            </button>
            <button
              onClick={() => setEditOrder(null)}
              className="px-4 py-2 bg-gray-200 text-black rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-black text-center py-8">Loading...</p>
      ) : !orders.length ? (
        <p className="text-black text-center py-8">No orders yet</p>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-black">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2">Product</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-t hover:bg-gray-50">
                  <td className="px-3 py-2 text-black">
                    <span className="font-medium">
                      {o.customer_name || 'N/A'}
                    </span>
                    <br />
                    <span className="text-xs">{o.customer_email}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        o.product_type === 'wisdom_cards'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}
                    >
                      {o.product_type === 'wisdom_book' ? 'Book' : 'Cards'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        STATUS_COLORS[o.status] || 'bg-gray-100 text-black'
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-black">
                    ${o.amount}
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-black">
                    {new Date(o.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => {
                        setEditOrder(o);
                        setEditStatus(o.status);
                        setEditTracking(o.tracking_number || '');
                        setEditNotes(o.notes || '');
                      }}
                      className="text-blue-600 text-xs font-medium hover:underline"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
