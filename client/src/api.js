export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
let accessToken = '';
let refreshInFlight = null;

export class ApiClientError extends Error {
  constructor(message, code, status) { super(message); this.name = 'ApiClientError'; this.code = code; this.status = status; }
}

export function setAccessToken(value) { accessToken = value || ''; }

async function request(path, { method = 'GET', body, headers = {}, retry = true, raw = false } = {}) {
  const requestHeaders = { ...headers };
  if (accessToken) requestHeaders.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined && !raw) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${API_BASE}${path}`, {
    method, headers: requestHeaders, credentials: 'include',
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
  });
  if (response.status === 401 && retry && path !== '/api/v1/auth/refresh' && path !== '/api/v1/auth/login') {
    const refreshed = await refreshSession();
    if (refreshed) return request(path, { method, body, headers, retry: false, raw });
  }
  if (!response.ok) {
    let payload = {};
    try { payload = await response.json(); } catch {}
    const error = payload.error || {};
    throw new ApiClientError(error.message || `Request failed (${response.status}).`, error.code || 'request_failed', response.status);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = request('/api/v1/auth/refresh', { method: 'POST', retry: false })
      .then((result) => { setAccessToken(result.data.accessToken); return result.data.user; })
      .catch(() => { setAccessToken(''); return null; })
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

export async function restoreSession() {
  const user = await refreshSession();
  return user ? (await request('/api/v1/auth/me')).data.user : null;
}

export const api = {
  auth: {
    login: async (body) => { const result = await request('/api/v1/auth/login', { method: 'POST', body, retry: false }); setAccessToken(result.data.accessToken); return result.data.user; },
    register: (body) => request('/api/v1/auth/register', { method: 'POST', body, retry: false }),
    logout: async () => { try { await request('/api/v1/auth/logout', { method: 'POST', retry: false }); } finally { setAccessToken(''); } },
    verifyEmail: (token) => request('/api/v1/auth/verify-email', { method: 'POST', body: { token }, retry: false }),
    forgotPassword: (email) => request('/api/v1/auth/forgot-password', { method: 'POST', body: { email }, retry: false }),
    resetPassword: (token, password) => request('/api/v1/auth/reset-password', { method: 'POST', body: { token, password }, retry: false })
  },
  catalog: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== '' && value !== 'Everything'));
    return request(`/api/v1/products${query.size ? `?${query}` : ''}`);
  },
  product: (slug, country = 'US') => request(`/api/v1/products/${encodeURIComponent(slug)}?country=${country}`),
  cart: (country = 'US') => request(`/api/v1/cart?country=${country}`),
  setCartQuantity: (id, quantity) => request(`/api/v1/cart/items/${encodeURIComponent(id)}`, { method: 'PUT', body: { quantity } }),
  quote: (country, couponCode = '') => request('/api/v1/checkout/quote', { method: 'POST', body: { country, couponCode } }),
  checkout: (body, idempotencyKey) => request('/api/v1/checkout', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey } }),
  orders: () => request('/api/v1/orders'),
  vendorOrders: () => request('/api/v1/vendor/orders'),
  adminOrders: () => request('/api/v1/admin/orders'),
  confirmDelivery: (orderNumber, allocationId, body) => request(`/api/v1/admin/orders/${encodeURIComponent(orderNumber)}/allocations/${encodeURIComponent(allocationId)}/delivery`, { method: 'PATCH', body }),
  requestReturn: (orderNumber, allocationId, reason) => request(`/api/v1/orders/${encodeURIComponent(orderNumber)}/allocations/${encodeURIComponent(allocationId)}/returns`, { method: 'POST', body: { reason } }),
  reviewReturn: (orderNumber, allocationId, body) => request(`/api/v1/admin/orders/${encodeURIComponent(orderNumber)}/allocations/${encodeURIComponent(allocationId)}/return`, { method: 'PATCH', body }),
  retryReturnRefund: (orderNumber, allocationId) => request(`/api/v1/admin/orders/${encodeURIComponent(orderNumber)}/allocations/${encodeURIComponent(allocationId)}/return/refund`, { method: 'POST' }),
  saved: (country = 'US') => request(`/api/v1/me/saved-products?country=${country}`),
  saveProduct: (id) => request(`/api/v1/me/saved-products/${id}`, { method: 'PUT' }),
  unsaveProduct: (id) => request(`/api/v1/me/saved-products/${id}`, { method: 'DELETE' }),
  createReview: (productId, body) => request(`/api/v1/products/${productId}/reviews`, { method: 'POST', body }),
  applyVendor: (body) => request('/api/v1/vendor-applications', { method: 'POST', body }),
  vendorProfile: () => request('/api/v1/vendor/profile'),
  vendorProducts: () => request('/api/v1/vendor/products'),
  createProduct: (body) => request('/api/v1/vendor/products', { method: 'POST', body }),
  updateProduct: (id, body) => request(`/api/v1/vendor/products/${id}`, { method: 'PATCH', body }),
  archiveProduct: (id) => request(`/api/v1/vendor/products/${id}`, { method: 'DELETE' }),
  updateFulfillment: (allocationId, body) => request(`/api/v1/vendor/orders/${allocationId}/status`, { method: 'PATCH', body }),
  vendorApplications: () => request('/api/v1/admin/vendor-applications'),
  adminProducts: () => request('/api/v1/admin/products'),
  adminOverview: () => request('/api/v1/admin/overview'),
  adminCoupons: () => request('/api/v1/admin/coupons'),
  createCoupon: (body) => request('/api/v1/admin/coupons', { method: 'POST', body }),
  updateCoupon: (id, body) => request(`/api/v1/admin/coupons/${id}`, { method: 'PATCH', body }),
  moderateVendor: (id, body) => request(`/api/v1/admin/vendors/${id}/status`, { method: 'PATCH', body }),
  moderateProduct: (id, body) => request(`/api/v1/admin/products/${id}/status`, { method: 'PATCH', body }),
  connectOnboarding: () => request('/api/v1/vendor/connect/onboarding', { method: 'POST' }),
  presignUpload: (body) => request('/api/v1/vendor/uploads/presign', { method: 'POST', body }),
  uploadLocal: async (endpoint, key, file) => {
    const url = `${API_BASE}${endpoint}?key=${encodeURIComponent(key)}`;
    const headers = { 'Content-Type': file.type };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(url, { method: 'PUT', headers, credentials: 'include', body: file });
    if (!response.ok) throw new ApiClientError('Image upload failed.', 'upload_failed', response.status);
    return response.json();
  },
  uploadToUrl: async (url, file) => {
    const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
    if (!response.ok) throw new ApiClientError('Image upload failed.', 'upload_failed', response.status);
  },
  confirmUpload: (key) => request('/api/v1/vendor/uploads/confirm', { method: 'POST', body: { key } })
};
