'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// TODO(1.4): replace with shared types from @novame/core/types
type ShippingInfo = {
  fullName?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
};

type BookOrder = {
  id: string;
  user_id?: string;
  user_name?: string;
  user_email?: string;
  order_type: 'ebook' | 'printed';
  status: string;
  amount: number;
  payment_status?: string;
  wisdom_count: number;
  total_minutes: number;
  created_at: string;
  tracking_number?: string;
  shipping_info?: ShippingInfo;
};

type StatusFilter =
  | 'all'
  | 'pending_payment'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'cancelled';

type TypeFilter = 'all' | 'ebook' | 'printed';

export default function BookOrdersAdmin() {
  const router = useRouter();
  const [orders, setOrders] = useState<BookOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selectedOrder, setSelectedOrder] = useState<BookOrder | null>(null);
  const [updating, setUpdating] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');

  const loadOrders = async () => {
    setLoading(true);
    try {
      let url = '/api/book-orders?limit=100';
      if (filter !== 'all') url += `&status=${filter}`;
      if (typeFilter !== 'all') url += `&orderType=${typeFilter}`;

      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
      }
    } catch (e) {
      console.error('Failed to load orders:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, typeFilter]);

  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch('/api/book-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setOrders(orders.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));
        setSelectedOrder((prev) => (prev ? { ...prev, status: newStatus } : null));
      }
    } catch (e) {
      console.error('Failed to update order:', e);
      alert('Failed to update order');
    }
    setUpdating(false);
  };

  const updateOrderTracking = async (orderId: string, tracking: string) => {
    setUpdating(true);
    try {
      const res = await fetch('/api/book-orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, trackingNumber: tracking }),
      });
      const data = await res.json();
      if (data.success) {
        setOrders(
          orders.map((o) =>
            o.id === orderId ? { ...o, tracking_number: tracking } : o
          )
        );
        setSelectedOrder((prev) =>
          prev ? { ...prev, tracking_number: tracking } : null
        );
        alert('Tracking number saved!');
      }
    } catch (e) {
      console.error('Failed to update tracking:', e);
      alert('Failed to save tracking number');
    }
    setUpdating(false);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatTime = (mins: number) => {
    const hours = Math.floor(mins / 60);
    const minutes = Math.round(mins % 60);
    if (hours > 0) {
      return `${hours}h${minutes.toString().padStart(2, '0')}m`;
    }
    return `${minutes}m`;
  };

  const handleDownloadWisdoms = (userId: string | undefined) => {
    if (!userId) {
      alert('User ID not found');
      return;
    }
    const url = `/api/admin/export-wisdoms?userId=${userId}&format=txt`;
    window.open(url, '_blank');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending_payment':
        return 'bg-red-100 text-red-800';
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'processing':
        return 'bg-blue-100 text-blue-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'shipped':
        return 'bg-purple-100 text-purple-800';
      case 'delivered':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeColor = (type: string) => {
    return type === 'ebook'
      ? 'bg-blue-50 text-blue-600 border-blue-200'
      : 'bg-orange-50 text-orange-600 border-orange-200';
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/admin')}
            className="text-gray-500 hover:text-gray-700"
          >
            ← 返回
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">📚 Book Orders</h1>
        </div>
        <button
          onClick={loadOrders}
          className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
        >
          🔄 Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard
          label="Total Orders"
          value={orders.length}
          icon="📦"
          color="bg-gray-50"
        />
        <StatCard
          label="Pending"
          value={orders.filter((o) => o.status === 'pending').length}
          icon="⏳"
          color="bg-yellow-50"
        />
        <StatCard
          label="E-Books"
          value={orders.filter((o) => o.order_type === 'ebook').length}
          icon="📱"
          color="bg-blue-50"
        />
        <StatCard
          label="Printed"
          value={orders.filter((o) => o.order_type === 'printed').length}
          icon="📖"
          color="bg-orange-50"
        />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 mb-6 flex flex-wrap gap-4">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Status</label>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusFilter)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All Status</option>
            <option value="pending_payment">Pending Payment</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All Types</option>
            <option value="ebook">E-Book</option>
            <option value="printed">Printed</option>
          </select>
        </div>
      </div>

      {/* Orders Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-gray-200 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-xl p-12 text-center">
          <span className="text-6xl mb-4 block">📚</span>
          <p className="text-gray-500">No book orders yet</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    Order
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    User
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    Type
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    Content
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    Amount
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {orders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400 font-mono">
                        {order.id.slice(0, 8)}...
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-sm">
                          {order.user_name || 'Unknown'}
                        </p>
                        <p className="text-xs text-gray-500">{order.user_email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium border ${getTypeColor(order.order_type)}`}
                      >
                        {order.order_type === 'ebook' ? '📱 E-Book' : '📖 Printed'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm">
                        <p>{order.wisdom_count} wisdoms</p>
                        <p className="text-xs text-gray-500">
                          {formatTime(order.total_minutes)}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-medium ${
                          order.amount > 0 ? 'text-green-600' : 'text-gray-400'
                        }`}
                      >
                        {order.amount > 0 ? `$${order.amount}` : 'FREE'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}
                      >
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            setSelectedOrder(order);
                            setTrackingNumber(order.tracking_number || '');
                          }}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleDownloadWisdoms(order.user_id)}
                          className="text-green-600 hover:text-green-800 text-sm font-medium"
                          title="Download wisdoms text"
                        >
                          📥
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b flex justify-between items-center">
              <h2 className="text-lg font-bold">Order Details</h2>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Order Info */}
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Order ID</p>
                    <p className="font-mono text-xs">{selectedOrder.id}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Type</p>
                    <p
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(selectedOrder.order_type)}`}
                    >
                      {selectedOrder.order_type}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Amount</p>
                    <p className="font-bold">
                      {selectedOrder.amount > 0 ? `$${selectedOrder.amount}` : 'FREE'}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Payment</p>
                    <p>{selectedOrder.payment_status}</p>
                  </div>
                </div>
              </div>

              {/* User Info */}
              <div className="bg-blue-50 rounded-xl p-4">
                <h4 className="font-bold text-sm mb-2">User Info</h4>
                <p className="text-sm">{selectedOrder.user_name}</p>
                <p className="text-sm text-gray-600">{selectedOrder.user_email}</p>
              </div>

              {/* Content */}
              <div className="bg-orange-50 rounded-xl p-4">
                <h4 className="font-bold text-sm mb-2">Book Content</h4>
                <p className="text-sm">{selectedOrder.wisdom_count} wisdoms</p>
                <p className="text-sm text-gray-600">
                  {formatTime(selectedOrder.total_minutes)} recorded
                </p>
                <button
                  onClick={() => handleDownloadWisdoms(selectedOrder.user_id)}
                  className="mt-3 w-full bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 rounded-lg text-sm flex items-center justify-center gap-2"
                >
                  <span>📥</span>
                  Download Wisdoms Text
                </button>
              </div>

              {/* Shipping Info (for printed) */}
              {selectedOrder.order_type === 'printed' && selectedOrder.shipping_info && (
                <div className="bg-green-50 rounded-xl p-4">
                  <h4 className="font-bold text-sm mb-2">Shipping Address</h4>
                  <div className="text-sm space-y-1">
                    <p>{selectedOrder.shipping_info.fullName}</p>
                    <p>{selectedOrder.shipping_info.phone}</p>
                    <p>{selectedOrder.shipping_info.address}</p>
                    <p>
                      {selectedOrder.shipping_info.city},{' '}
                      {selectedOrder.shipping_info.state}{' '}
                      {selectedOrder.shipping_info.zipCode}
                    </p>
                    <p>{selectedOrder.shipping_info.country}</p>
                  </div>
                </div>
              )}

              {/* Tracking Number (for printed books) */}
              {selectedOrder.order_type === 'printed' && (
                <div className="bg-purple-50 rounded-xl p-4">
                  <h4 className="font-bold text-sm mb-2">Tracking Number</h4>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={trackingNumber}
                      onChange={(e) => setTrackingNumber(e.target.value)}
                      placeholder="Enter tracking number..."
                      className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    />
                    <button
                      onClick={() =>
                        updateOrderTracking(selectedOrder.id, trackingNumber)
                      }
                      disabled={updating || !trackingNumber}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                    >
                      Save
                    </button>
                  </div>
                  {selectedOrder.tracking_number && (
                    <p className="text-sm text-purple-700 mt-2 font-mono">
                      Current: {selectedOrder.tracking_number}
                    </p>
                  )}
                </div>
              )}

              {/* Status Update */}
              <div className="border-t pt-4">
                <h4 className="font-bold text-sm mb-3">Update Status</h4>
                <div className="flex flex-wrap gap-2">
                  {(selectedOrder.order_type === 'ebook'
                    ? ['pending', 'processing', 'completed']
                    : ['pending', 'processing', 'shipped', 'delivered', 'cancelled']
                  ).map((status) => (
                    <button
                      key={status}
                      onClick={() => updateOrderStatus(selectedOrder.id, status)}
                      disabled={updating || selectedOrder.status === status}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                        selectedOrder.status === status
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      } disabled:opacity-50`}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: string;
  color: string;
}) {
  return (
    <div className={`${color} rounded-xl p-4`}>
      <span className="text-2xl">{icon}</span>
      <p className="text-2xl font-bold mt-2">{value}</p>
      <p className="text-sm text-gray-600">{label}</p>
    </div>
  );
}
