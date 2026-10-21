import React, { useEffect, useMemo, useState } from 'react';
import { API_BASE, api, restoreSession } from './api';

const web3FormsAccessKey = import.meta.env.VITE_WEB3FORMS_ACCESS_KEY?.trim() || '';
const supportEmail = import.meta.env.VITE_SUPPORT_EMAIL?.trim() || 'support.marketlane@gmail.com';

const stockPhotos = {
  mug: 'https://images.unsplash.com/photo-1611502692278-8790788af174?auto=format&fit=crop&w=900&q=82',
  tote: 'https://images.unsplash.com/photo-1555980861-0388cf24420a?auto=format&fit=crop&w=900&q=82',
  notes: 'https://images.unsplash.com/photo-1761322572550-967ea8c0bfd9?auto=format&fit=crop&w=900&q=82',
  candle: 'https://images.unsplash.com/photo-1574266742257-41460b7992ee?auto=format&fit=crop&w=900&q=82',
  cap: 'https://images.unsplash.com/photo-1536785696345-3ed1adce6bb6?auto=format&fit=crop&w=900&q=82',
  sketchbook: 'https://images.unsplash.com/photo-1598620617137-2ab990aadd37?auto=format&fit=crop&w=900&q=82',
  bowl: 'https://images.unsplash.com/photo-1523367438061-01c055ce790c?auto=format&fit=crop&w=900&q=82',
  pouch: 'https://images.unsplash.com/photo-1620093349352-3d6c6eec7fc4?auto=format&fit=crop&w=900&q=82',
};
const categoryStockPhoto = { Home: stockPhotos.mug, Accessories: stockPhotos.tote, Stationery: stockPhotos.notes };

const navByRole = {
  customer: [{ id: 'shop', label: 'Shop' }, { id: 'orders', label: 'My orders' }, { id: 'saved', label: 'Saved finds' }],
  vendor: [{ id: 'vendor', label: 'Overview' }, { id: 'products', label: 'My products' }, { id: 'vendor-orders', label: 'Orders' }],
  admin: [{ id: 'admin', label: 'Overview' }, { id: 'admin-orders', label: 'Orders' }, { id: 'admin-products', label: 'Catalog' }, { id: 'admin-vendors', label: 'Vendors' }, { id: 'admin-coupons', label: 'Coupons' }],
};
const categories = ['Everything', 'Home', 'Accessories', 'Stationery'];
const orderSteps = ['Placed', 'Packed', 'Shipped', 'Delivered'];
const productTypeSynonyms = {
  cup: ['cup', 'cups', 'mug', 'mugs', 'drinkware'], cups: ['cup', 'cups', 'mug', 'mugs', 'drinkware'],
  mug: ['cup', 'cups', 'mug', 'mugs', 'drinkware'], mugs: ['cup', 'cups', 'mug', 'mugs', 'drinkware'],
  tote: ['tote', 'totes', 'bag', 'bags'], totes: ['tote', 'totes', 'bag', 'bags'],
  bag: ['tote', 'totes', 'bag', 'bags', 'pouch', 'pouches'], bags: ['tote', 'totes', 'bag', 'bags', 'pouch', 'pouches'],
  notebook: ['notebook', 'notebooks', 'sketchbook', 'sketchbooks', 'stationery'], notebooks: ['notebook', 'notebooks', 'sketchbook', 'sketchbooks', 'stationery'],
  candle: ['candle', 'candles'], candles: ['candle', 'candles'], bowl: ['bowl', 'bowls'], bowls: ['bowl', 'bowls'],
};

function normalizeProduct(product) {
  const category = product.category || 'Home';
  return {
    ...product, id: String(product.id || product._id), vendor: product.vendor || 'Independent shop',
    price: Number(product.price ?? ((product.priceMinor || 0) / 100)), priceMinor: product.priceMinor,
    currency: product.currency || product.baseCurrency || 'USD', stock: Number(product.stock || 0),
    rating: Number(product.rating || 0), ratingCount: Number(product.ratingCount || 0),
    color: category === 'Home' ? 'clay' : category === 'Accessories' ? 'sage' : 'paper',
    tag: product.status === 'draft' ? 'Needs review' : product.status === 'published' ? 'Available now' : 'New in the shop',
    imageKeys: product.imageKeys || [], imageUrl: product.imageUrl?.startsWith('/') ? `${API_BASE}${product.imageUrl}` : (product.imageUrl || ''), archived: product.status === 'archived' || Boolean(product.archived)
  };
}

function normalizeOrder(order, vendor = false) {
  const allocation = order.allocations?.[0];
  const rawStatus = vendor ? allocation?.status : order.status;
  const status = ({ pending_payment: 'Pending payment', partially_shipped: 'Shipped', placed: 'Placed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' })[rawStatus] || 'Placed';
  return {
    ...order, id: vendor ? order.orderNumber : order.orderNumber || order.id,
    allocationId: vendor ? allocation?.id : undefined,
    payoutAmountMinor: vendor ? allocation?.payoutAmountMinor || 0 : 0,
    payoutCurrency: vendor ? allocation?.payoutCurrency || order.currency : order.currency,
    status, payment: order.payment || `Stripe test · ${order.paymentStatus || 'pending'}`,
    total: vendor && allocation ? allocation.grossMinor / 100 : Number(order.total ?? ((order.totalMinor || 0) / 100)),
    commission: Number(order.commission ?? ((order.commissionMinor || 0) / 100)),
    items: (order.items || []).map((item) => ({ ...item, price: Number(item.price ?? ((item.priceMinor || 0) / 100)), currency: item.currency || order.currency || 'USD' }))
  };
}

function normalizeCoupon(coupon) {
  return { ...coupon, status: coupon.status === 'active' ? 'Active' : 'Paused', percent: coupon.percentOff, uses: coupon.usedCount || 0 };
}

function formatMoney(value, currency = 'USD') {
  const locale = ({ USD: 'en-US', CAD: 'en-CA', GBP: 'en-GB' })[currency] || 'en-US';
  try { return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(value || 0)); }
  catch { return `${currency} ${Number(value || 0).toFixed(2)}`; }
}

function matchesProductSearch(product, query) {
  const text = `${product.name} ${product.vendor} ${product.category} ${product.type || ''} ${product.productType || ''} ${product.description || ''}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every((term) =>
    (productTypeSynonyms[term] || [term]).some((candidate) => text.includes(candidate))
  );
}

function App() {
  const [products, setProducts] = useState([]);
  const [vendorProducts, setVendorProducts] = useState([]);
  const [adminProducts, setAdminProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [cart, setCart] = useState([]);
  const [saved, setSaved] = useState([]);
  const [savedProducts, setSavedProducts] = useState([]);
  const [role, setRole] = useState('customer');
  const [userRole, setUserRole] = useState(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [apiError, setApiError] = useState('');
  const [view, setView] = useState('shop');
  const [vendorProfile, setVendorProfile] = useState(null);
  const [vendorApplications, setVendorApplications] = useState([]);
  const [adminOverview, setAdminOverview] = useState(null);
  const [shippingCountry, setShippingCountry] = useState('US');
  const [quote, setQuote] = useState(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Everything');
  const [sort, setSort] = useState('featured');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [modal, setModal] = useState('');
  const [passwordResetToken, setPasswordResetToken] = useState(() => window.location.pathname === '/reset-password' ? new URLSearchParams(window.location.search).get('token') || '' : '');
  const [editingProduct, setEditingProduct] = useState(null);
  const [notice, setNotice] = useState('');
  const [newsletterSubmitting, setNewsletterSubmitting] = useState(false);
  const [newsletterStatus, setNewsletterStatus] = useState('');
  const [couponText, setCouponText] = useState('');
  const [coupon, setCoupon] = useState('');
  const [login, setLogin] = useState({ name: '', email: '', id: '' });
  const [reviewTarget, setReviewTarget] = useState(null);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [reviews, setReviews] = useState([]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    const verificationToken = params.get('token');
    if ((window.location.pathname === '/verify-email' || params.get('verify') === 'email') && verificationToken) {
      api.auth.verifyEmail(verificationToken).then((result) => { if (active) setNotice(result.data.message); }).catch((error) => { if (active) setApiError(error.message); });
      window.history.replaceState({}, '', '/');
    }
    if (window.location.pathname === '/reset-password' && verificationToken) {
      setPasswordResetToken(verificationToken); setModal('account'); window.history.replaceState({}, '', '/');
    }
    if (params.get('checkout')) {
      setNotice(params.get('checkout') === 'success' ? 'Payment confirmation is processing. Your order will appear here shortly.' : 'Checkout was cancelled. Your bag is ready.');
      window.history.replaceState({}, '', '/');
    }
    if (params.get('connect')) {
      setNotice(params.get('connect') === 'complete' ? 'Stripe Connect returned. The API is waiting for Stripe to confirm test-account capabilities.' : 'Restart Stripe test onboarding to continue.');
      window.history.replaceState({}, '', '/');
    }
    restoreSession().then((user) => {
      if (!active) return;
      setAuthenticated(Boolean(user));
      setUserRole(user?.role || null);
      setRole(user?.role || 'customer');
      setView(user?.role === 'vendor' ? 'vendor' : user?.role === 'admin' ? 'admin' : 'shop');
      if (user) setLogin({ name: user.name, email: user.email, id: user.id });
      setAuthLoading(false);
    }).catch((error) => {
      if (active) { setApiError(error.message); setAuthLoading(false); }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api.catalog({ q: query, category, sort, limit: 50, country: shippingCountry }).then((result) => {
      if (!active) return;
      setProducts(result.data.map(normalizeProduct));
      setApiError('');
    }).catch((error) => { if (active) setApiError(error.message); });
    return () => { active = false; };
  }, [query, category, sort, shippingCountry]);

  useEffect(() => {
    let active = true;
    if (!authenticated) { setCart([]); setSaved([]); setSavedProducts([]); setOrders([]); setQuote(null); return () => { active = false; }; }
    Promise.all([api.cart(shippingCountry), api.saved(shippingCountry)]).then(([cartResult, savedResult]) => {
      if (!active) return;
      setCart(cartResult.data.items.map(normalizeProduct));
      setSaved(savedResult.data.map((product) => product.id));
      setSavedProducts(savedResult.data.map(normalizeProduct));
    }).catch((error) => { if (active) setApiError(error.message); });
    if (role === 'vendor' && userRole === 'vendor') {
      api.vendorProfile().then((result) => { if (active) setVendorProfile(result.data); }).catch((error) => { if (active) setApiError(error.message); });
      if (vendorProfile?.status === 'active') {
        Promise.all([api.vendorProducts(), api.vendorOrders()]).then(([productResult, orderResult]) => {
          if (!active) return;
          setVendorProducts(productResult.data.map(normalizeProduct));
          setOrders(orderResult.data.map((order) => normalizeOrder(order, true)));
        }).catch((error) => { if (active) setApiError(error.message); });
      }
    }
    if (role === 'admin' && userRole === 'admin') {
      Promise.all([api.adminOrders(), api.adminProducts(), api.vendorApplications(), api.adminCoupons(), api.adminOverview()]).then(([orderResult, productResult, vendorResult, couponResult, overviewResult]) => {
        if (!active) return;
        setOrders(orderResult.data.map((order) => normalizeOrder(order)));
        setAdminProducts(productResult.data.map(normalizeProduct));
        setVendorApplications(vendorResult.data);
        setCoupons(couponResult.data.map(normalizeCoupon));
        setAdminOverview(overviewResult.data);
      }).catch((error) => { if (active) setApiError(error.message); });
    }
    if (role === 'customer') api.orders().then((result) => { if (active) setOrders(result.data.map((order) => normalizeOrder(order))); }).catch((error) => { if (active) setApiError(error.message); });
    return () => { active = false; };
  }, [authenticated, role, userRole, vendorProfile?.status, shippingCountry]);

  useEffect(() => {
    let active = true;
    if (!authenticated || cart.length === 0) { setQuote(null); return () => { active = false; }; }
    api.quote(shippingCountry, coupon).then((result) => { if (active) setQuote(result.data); }).catch(() => { if (active) setQuote(null); });
    return () => { active = false; };
  }, [authenticated, cart, shippingCountry, coupon]);
  useEffect(() => {
    const navigate = (event) => setView(event.detail);
    window.addEventListener('ml-navigate', navigate);
    return () => window.removeEventListener('ml-navigate', navigate);
  }, []);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = quote?.subtotal.amount ?? cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discount = quote?.discount.amount ?? 0;
  const shipping = quote?.shipping.amount ?? 0;
  const total = quote?.total.amount ?? subtotal;
  const visibleProducts = useMemo(() => products.filter((product) => !product.archived), [products]);

  function toast(message) {
    setNotice(message);
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => setNotice(''), 2600);
  }

  async function subscribeNewsletter(event) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!web3FormsAccessKey) {
      setNewsletterStatus('Newsletter signup is not configured yet. Add the Web3Forms access key to client/.env.local.');
      return;
    }

    setNewsletterSubmitting(true);
    setNewsletterStatus('Submitting your email…');
    const payload = Object.fromEntries(new FormData(form));
    payload.access_key = web3FormsAccessKey;
    payload.subject = 'New Market Lane newsletter signup';
    payload.from_name = 'Market Lane newsletter';

    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || 'We could not submit your email. Please try again.');
      form.reset();
      setNewsletterStatus('Thanks for joining the list.');
    } catch (error) {
      setNewsletterStatus(error.message || 'Something went wrong. Please try again.');
    } finally {
      setNewsletterSubmitting(false);
    }
  }

  function scrollToSection(id) {
    if (role !== 'customer') changeRole('customer');
    if (id === 'catalog' || id === 'makers') setView('shop');
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  }

  function openInfoPage(page) {
    setRole('customer');
    setView(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function changeRole(nextRole) {
    if (nextRole === 'vendor' && userRole !== 'vendor') { toast('Submit a seller application to access the vendor workspace.'); setModal('seller'); return; }
    if (nextRole === 'admin' && userRole !== 'admin') { toast('Administrator access is required.'); return; }
    setRole(nextRole);
    setView(nextRole === 'customer' ? 'shop' : nextRole === 'vendor' ? 'vendor' : 'admin');
  }

  async function refreshCart() {
    if (!authenticated) return;
    const result = await api.cart(shippingCountry);
    setCart(result.data.items.map(normalizeProduct));
  }

  async function addToCart(product) {
    try {
      if (!authenticated) {
        setCart((current) => {
          const existing = current.find((item) => item.id === product.id);
          return existing ? current.map((item) => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item) : [...current, { ...product, quantity: 1 }];
        });
      } else {
        const quantity = (cart.find((item) => item.id === product.id)?.quantity || 0) + 1;
        await api.setCartQuantity(product.id, quantity);
        await refreshCart();
      }
      toast(`${product.name} added to your bag`);
    } catch (error) { toast(error.message); }
  }

  async function changeQuantity(id, amount) {
    const quantity = (cart.find((item) => item.id === id)?.quantity || 0) + amount;
    try {
      if (!authenticated) setCart((current) => current.map((item) => item.id === id ? { ...item, quantity } : item).filter((item) => item.quantity > 0));
      else { await api.setCartQuantity(id, Math.max(0, quantity)); await refreshCart(); }
      if (quantity <= 0) setCoupon('');
    } catch (error) { toast(error.message); }
  }

  async function toggleSaved(product) {
    if (!authenticated) { toast('Sign in to save products.'); setModal('account'); return; }
    try {
      if (saved.includes(product.id)) { await api.unsaveProduct(product.id); setSaved((current) => current.filter((id) => id !== product.id)); setSavedProducts((current) => current.filter((item) => item.id !== product.id)); }
      else { await api.saveProduct(product.id); setSaved((current) => [...current, product.id]); setSavedProducts((current) => current.some((item) => item.id === product.id) ? current : [...current, product]); }
      toast(saved.includes(product.id) ? 'Removed from saved finds' : 'Saved for later');
    } catch (error) { toast(error.message); }
  }

  async function applyCoupon(event) {
    event.preventDefault();
    const code = couponText.trim().toUpperCase();
    if (!authenticated) { toast('Sign in to apply a promotion.'); setModal('account'); return; }
    try {
      const result = await api.quote(shippingCountry, code);
      setQuote(result.data); setCoupon(code); toast(`${code} applied to this server quote`);
    } catch (error) { toast(error.message); }
  }

  async function placeOrder(event) {
    event.preventDefault();
    if (!authenticated) { setModal('account'); toast('Sign in before checkout.'); return; }
    const form = new FormData(event.currentTarget);
    const country = form.get('country');
    setShippingCountry(country);
    const address = {
      firstName: String(form.get('firstName') || ''), lastName: String(form.get('lastName') || ''),
      line1: String(form.get('address') || ''), line2: String(form.get('address2') || ''),
      city: String(form.get('city') || ''), region: String(form.get('region') || ''),
      postalCode: String(form.get('zip') || ''), country
    };
    try {
      const result = await api.checkout({ address, couponCode: coupon || '' }, crypto.randomUUID());
      window.location.assign(result.data.checkoutUrl);
    } catch (error) { toast(error.message); }
  }

  async function saveProduct(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const photo = form.get('photo');
    const imageKeys = [...(editingProduct?.imageKeys || [])];
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > 5 * 1024 * 1024) { toast('Choose an image smaller than 5 MB.'); return; }
      try {
        const presign = await api.presignUpload({ contentType: photo.type, size: photo.size });
        const upload = presign.data;
        if (upload.uploadUrl) await api.uploadToUrl(upload.uploadUrl, photo);
        else await api.uploadLocal(upload.uploadEndpoint, upload.key, photo);
        await api.confirmUpload(upload.key);
        imageKeys.splice(0, imageKeys.length, upload.key);
      } catch (error) { toast(error.message); return; }
    }
    const body = { name: form.get('name').trim(), category: form.get('category'), productType: form.get('productType').trim(), price: Number(form.get('price')), stock: Number(form.get('stock')), description: form.get('description').trim(), imageKeys };
    try {
      if (editingProduct) await api.updateProduct(editingProduct.id, body);
      else await api.createProduct(body);
      const result = await api.vendorProducts();
      setVendorProducts(result.data.map(normalizeProduct));
      setModal(''); setEditingProduct(null); toast(editingProduct ? 'Product saved as a draft for moderation' : 'Product submitted as a draft for moderation');
    } catch (error) { toast(error.message); }
  }

  async function advanceOrder(orderId) {
    if (role !== 'vendor' || userRole !== 'vendor') return;
    const order = orders.find((item) => item.id === orderId || item.orderNumber === orderId);
    if (!order?.allocationId) return;
    const index = orderSteps.indexOf(order.status);
    const next = orderSteps[index + 1];
    if (!next) return;
    const payload = { status: next.toLowerCase() };
    if (next === 'Shipped') {
      payload.carrier = window.prompt('Shipping carrier name');
      payload.trackingNumber = window.prompt('Tracking number');
      if (!payload.carrier || !payload.trackingNumber) return;
    }
    try {
      await api.updateFulfillment(order.allocationId, payload);
      const result = await api.vendorOrders();
      setOrders(result.data.map((item) => normalizeOrder(item, true)));
      toast(`Order ${order.orderNumber} marked ${next.toLowerCase()}`);
    } catch (error) { toast(error.message); }
  }

  function openReview(order) {
    setReviewTarget(order.items[0]);
    setModal('review');
  }

  async function saveReview(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api.createReview(reviewTarget.productId, { rating: Number(form.get('rating')), body: form.get('review').trim() });
      setReviews((current) => [{ productId: reviewTarget.productId, product: reviewTarget.name, author: login.name, rating: result.data.rating, text: result.data.body, date: 'Just now' }, ...current]);
      setModal(''); setReviewTarget(null); toast('Thanks for sharing your review');
    } catch (error) { toast(error.message); }
  }

  async function submitSellerApplication(event) {
    event.preventDefault();
    if (!authenticated) { setModal('account'); toast('Sign in before applying to sell.'); return; }
    const form = new FormData(event.currentTarget);
    try {
      const result = await api.applyVendor({ shopName: form.get('shopName').trim(), contactEmail: form.get('email').trim(), description: form.get('description').trim(), country: form.get('country') });
      setVendorProfile(result.data); setUserRole('vendor'); setRole('vendor'); setView('vendor'); setModal('');
      toast('Seller application submitted for admin review');
    } catch (error) { toast(error.message); }
  }

  async function signIn(email, password) {
    const guestItems = authenticated ? [] : cart;
    const user = await api.auth.login({ email, password });
    try {
      if (guestItems.length) {
        const existing = await api.cart(shippingCountry);
        const quantities = new Map(existing.data.items.map((item) => [item.id, item.quantity]));
        for (const item of guestItems) quantities.set(item.id, Math.min(99, (quantities.get(item.id) || 0) + item.quantity));
        for (const [productId, quantity] of quantities) await api.setCartQuantity(productId, quantity);
        const merged = await api.cart(shippingCountry);
        setCart(merged.data.items.map(normalizeProduct));
      }
    } catch (error) {
      await api.auth.logout().catch(() => {});
      throw new Error(`Could not restore your bag after sign-in. Please try again. (${error.message})`);
    }
    setAuthenticated(true); setUserRole(user.role); setRole(user.role); setView(user.role === 'admin' ? 'admin' : user.role === 'vendor' ? 'vendor' : 'shop');
    setLogin({ name: user.name, email: user.email, id: user.id }); setModal('');
    toast(`Welcome back, ${user.name.split(' ')[0]}`);
  }

  async function signUp(name, email, password) {
    const result = await api.auth.register({ name, email, password });
    setModal(''); toast(result.data.message);
  }

  async function resetPassword(token, password) {
    const result = await api.auth.resetPassword(token, password);
    setPasswordResetToken(''); toast(result.data.message);
  }

  async function startConnectOnboarding() {
    try { const result = await api.connectOnboarding(); window.location.assign(result.data.onboardingUrl); }
    catch (error) { toast(error.message); }
  }

  async function signOut() {
    try { await api.auth.logout(); } finally {
      setAuthenticated(false); setUserRole(null); setRole('customer'); setView('shop'); setLogin({ name: '', email: '', id: '' });
      setVendorProfile(null); setVendorProducts([]); setOrders([]); setCoupons([]); setCart([]); setSaved([]); setSavedProducts([]); setModal(''); toast('You have signed out.');
    }
  }

  async function createCoupon(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api.createCoupon({ code: form.get('code'), percentOff: Number(form.get('percent')), description: form.get('description') });
      const result = await api.adminCoupons(); setCoupons(result.data.map(normalizeCoupon)); event.currentTarget.reset(); toast('Coupon created');
    } catch (error) { toast(error.message); }
  }

  async function toggleCoupon(coupon) {
    try { await api.updateCoupon(coupon.id, { status: coupon.status === 'Active' ? 'paused' : 'active' }); const result = await api.adminCoupons(); setCoupons(result.data.map(normalizeCoupon)); }
    catch (error) { toast(error.message); }
  }

  async function moderateVendor(vendor, status) {
    const reason = status === 'active' ? '' : window.prompt(`Reason to ${status} this shop`);
    if (status !== 'active' && !reason) return;
    try { await api.moderateVendor(vendor.id, { status, reason }); const result = await api.vendorApplications(); setVendorApplications(result.data); toast(`Shop ${status}`); }
    catch (error) { toast(error.message); }
  }

  async function moderateProduct(product, status) {
    const reason = status === 'published' ? '' : window.prompt(`Reason to ${status} this listing`);
    if (status !== 'published' && !reason) return;
    try { await api.moderateProduct(product.id, { status, reason }); const result = await api.adminProducts(); setAdminProducts(result.data.map(normalizeProduct)); toast(`Listing ${status}`); }
    catch (error) { toast(error.message); }
  }

  async function confirmDelivery(orderNumber, allocation) {
    try {
      await api.confirmDelivery(orderNumber, allocation.id, { decision: 'confirmed' });
      const result = await api.adminOrders();
      setOrders(result.data.map((order) => normalizeOrder(order)));
      toast('Delivery confirmed · payout scheduled for 30 days later');
    } catch (error) { toast(error.message); }
  }

  async function requestReturn(order, allocation) {
    const reason = window.prompt(`Why are you returning items from ${allocation.vendor}?`);
    if (!reason) return;
    try {
      await api.requestReturn(order.orderNumber || order.id, allocation.id, reason);
      const result = await api.orders();
      setOrders(result.data.map((item) => normalizeOrder(item)));
      toast('Return request sent · payout is on hold while the team reviews it');
    } catch (error) { toast(error.message); }
  }

  async function reviewReturn(orderNumber, allocation, decision) {
    const reason = window.prompt(`${decision === 'approved' ? 'Approval' : 'Rejection'} note for ${orderNumber}`);
    if (!reason || reason.trim().length < 4) return;
    try {
      await api.reviewReturn(orderNumber, allocation.id, { decision, reason });
      const result = await api.adminOrders();
      setOrders(result.data.map((item) => normalizeOrder(item)));
      toast(`Return ${decision}`);
    } catch (error) {
      try { const result = await api.adminOrders(); setOrders(result.data.map((item) => normalizeOrder(item))); } catch {}
      toast(error.message);
    }
  }

  async function retryReturnRefund(orderNumber, allocationId) {
    try {
      const result = await api.retryReturnRefund(orderNumber, allocationId);
      const ordersResult = await api.adminOrders();
      setOrders(ordersResult.data.map((item) => normalizeOrder(item)));
      toast(`Stripe refund ${result.data.refundStatus}`);
    } catch (error) {
      try { const result = await api.adminOrders(); setOrders(result.data.map((item) => normalizeOrder(item))); } catch {}
      toast(error.message);
    }
  }

  async function openProduct(product) {
    try {
      const result = await api.product(product.slug || product.id, shippingCountry);
      const detailed = normalizeProduct(result.data);
      setReviews((result.data.reviews || []).map((review) => ({ productId: detailed.id, text: review.text, author: review.author, rating: review.rating })));
      setSelectedProduct(detailed);
    } catch { setSelectedProduct(product); }
  }

  const activeNav = navByRole[role];

  return (
    <div className="app-frame">
      <div className="topline"><span>Good finds from independent sellers</span><span className="topline-perks"><span>Shipping shown at checkout</span><span>Pilot return requests within 30 days of delivery</span></span><button onClick={() => openInfoPage('contact')}>Need help?</button></div>
      <header className="store-header">
        <button className="brand" onClick={() => changeRole('customer')} aria-label="Market Lane home"><span className="brand-mark">ML</span><span>market<span>lane</span></span></button>
        <div className="search-wrap"><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => { setQuery(event.target.value); if (role !== 'customer') changeRole('customer'); setView('shop'); }} placeholder="Search products, shops, and more" aria-label="Search marketplace" /><kbd>⌘ K</kbd></div>
        <div className="header-actions"><button className="text-action account-action" onClick={() => setModal('account')}><span>{authenticated ? login.name.split(' ')[0] : 'Sign in'}<small>{authenticated ? 'My account' : 'Customer account'}</small></span></button><button className="cart-trigger" onClick={() => setCartOpen(true)}><span>Bag</span><b>{cartCount}</b></button></div>
      </header>
      <nav className="primary-nav" aria-label="Marketplace navigation"><div className="nav-categories"><button className={view === 'shop' ? 'nav-link selected' : 'nav-link'} onClick={() => { changeRole('customer'); scrollToSection('catalog'); }}>Shop all</button><button className="nav-link" onClick={() => { changeRole('customer'); setCategory('Home'); scrollToSection('catalog'); }}>Home & living</button><button className="nav-link" onClick={() => { changeRole('customer'); setCategory('Accessories'); scrollToSection('catalog'); }}>Accessories</button><button className="nav-link" onClick={() => { changeRole('customer'); setCategory('Stationery'); scrollToSection('catalog'); }}>Stationery</button><button className="nav-link" onClick={() => { changeRole('customer'); scrollToSection('makers'); }}>Meet the makers</button>{role === 'customer' && <><button className={view === 'orders' ? 'nav-link selected' : 'nav-link'} onClick={() => { setView('orders'); scrollToSection('main-content'); }}>My orders</button><button className={view === 'saved' ? 'nav-link selected' : 'nav-link'} onClick={() => { setView('saved'); scrollToSection('main-content'); }}>Saved finds</button><button className="nav-link sell-link" onClick={() => setModal('seller')}>Sell with us ↗</button></>}</div>{authenticated && userRole !== 'customer' && <div className="portal-actions"><button className="outline-button" onClick={() => changeRole('customer')}>Shop</button><button className="outline-button" onClick={() => changeRole(userRole)}>{userRole === 'admin' ? 'Admin workspace' : 'Seller workspace'}</button></div>}</nav>
      <div className="demo-notice"><span className="demo-dot" /> PILOT PREVIEW <span>Stripe test mode only. No live payments or vendor transfers are enabled.</span></div>
      {apiError && <div className="api-status-error" role="alert">Marketplace service: {apiError}</div>}
      {authLoading && <div className="api-status-error" role="status">Connecting your account…</div>}

      {role !== 'customer' && <div className="workspace-nav"><div className="workspace-title"><span className={role === 'admin' ? 'workspace-mark admin-mark' : 'workspace-mark'}>{role === 'admin' ? 'A' : 'V'}</span><span>{role === 'admin' ? 'Marketplace admin' : `${vendorProfile?.shopName || 'Seller'} shop`}<small>{role === 'admin' ? 'Platform workspace' : `${vendorProfile?.status || 'pending'} seller workspace`}</small></span></div><div className="workspace-links">{(activeNav || []).map((item) => <button key={item.id} className={view === item.id ? 'workspace-link current' : 'workspace-link'} onClick={() => setView(item.id)}>{item.label}</button>)}</div><button className="workspace-exit" onClick={() => changeRole('customer')}>← Back to storefront</button></div>}

      <main className="main-content" id="main-content">
        {role === 'customer' && view === 'shop' && <Storefront products={visibleProducts} category={category} setCategory={setCategory} sort={sort} setSort={setSort} openProduct={openProduct} addToCart={addToCart} saved={saved} toggleSaved={toggleSaved} query={query} setQuery={setQuery} toast={toast} />}
        {role === 'customer' && view === 'orders' && (authenticated ? <OrdersPage orders={orders} openReview={openReview} showInvoice={setInvoiceOrder} requestReturn={requestReturn} /> : <SignInPrompt openAccount={() => setModal('account')} />)}
        {role === 'customer' && view === 'saved' && (authenticated ? <SavedPage products={savedProducts} openProduct={openProduct} addToCart={addToCart} toggleSaved={toggleSaved} /> : <SignInPrompt openAccount={() => setModal('account')} />)}
        {role === 'customer' && view === 'terms' && <TermsPage supportEmail={supportEmail} openContact={() => openInfoPage('contact')} onBack={() => openInfoPage('shop')} />}
        {role === 'customer' && view === 'privacy' && <PrivacyPage supportEmail={supportEmail} openContact={() => openInfoPage('contact')} onBack={() => openInfoPage('shop')} />}
        {role === 'customer' && view === 'contact' && <ContactPage supportEmail={supportEmail} onBack={() => openInfoPage('shop')} />}
        {view === 'checkout' && <CheckoutPage cart={cart} subtotal={subtotal} discount={discount} shipping={shipping} total={total} currency={quote?.currency || cart[0]?.currency || 'USD'} hasQuote={Boolean(quote)} coupon={coupon} couponText={couponText} setCouponText={setCouponText} applyCoupon={applyCoupon} placeOrder={placeOrder} login={login} authenticated={authenticated} shippingCountry={shippingCountry} setShippingCountry={setShippingCountry} openAccount={() => setModal('account')} goBack={() => setView('shop')} />}
        {role === 'vendor' && vendorProfile?.status !== 'active' && <VendorPendingPage profile={vendorProfile} />}
        {role === 'vendor' && vendorProfile?.status === 'active' && ['vendor', 'products', 'vendor-orders'].includes(view) && <BackendVendorPage view={view} seller={vendorProfile} products={vendorProducts} orders={orders} addProduct={() => { setEditingProduct(null); setModal('product'); }} editProduct={(product) => { setEditingProduct(product); setModal('product'); }} advanceOrder={advanceOrder} connect={startConnectOnboarding} archiveProduct={async (id) => { try { await api.archiveProduct(id); setVendorProducts((current) => current.filter((product) => product.id !== id)); toast('Listing archived'); } catch (error) { toast(error.message); } }} />}
        {role === 'admin' && ['admin', 'admin-orders', 'admin-products', 'admin-vendors'].includes(view) && <BackendAdminPage view={view} products={adminProducts} orders={orders} overview={adminOverview} vendors={vendorApplications} moderateVendor={moderateVendor} moderateProduct={moderateProduct} confirmDelivery={confirmDelivery} reviewReturn={reviewReturn} retryReturnRefund={retryReturnRefund} />}
        {role === 'admin' && view === 'admin-coupons' && <BackendCouponsPage coupons={coupons} createCoupon={createCoupon} toggleCoupon={toggleCoupon} />}
      </main>

      <footer className="store-footer"><div className="footer-main"><div className="footer-brand"><button className="brand" onClick={() => changeRole('customer')}><span className="brand-mark">ML</span><span>market<span>lane</span></span></button><p>A marketplace for good things<br />made by independent sellers.</p></div><div><b>Discover</b><button onClick={() => { changeRole('customer'); setView('shop'); setCategory('Everything'); }}>Shop all</button><button onClick={() => { changeRole('customer'); document.getElementById('makers')?.scrollIntoView({ behavior: 'smooth' }); }}>Our makers</button><button onClick={() => toast('Our story is coming soon')}>Our story</button></div><div><b>Help & info</b><button onClick={() => openInfoPage('contact')}>Contact us</button><button onClick={() => toast('Pilot preview: return requests can be submitted within 30 days of delivery. The live returns policy is pending legal review.')}>Shipping & returns</button><button onClick={() => openInfoPage('privacy')}>Privacy</button><button onClick={() => openInfoPage('terms')}>Terms & conditions</button></div><div className="newsletter-mini"><b>Notes from the marketplace</b><p>New makers and thoughtful finds, once in a while.</p><form onSubmit={subscribeNewsletter}><input type="email" name="email" placeholder="Email address" aria-label="Email address" autoComplete="email" required /><input type="checkbox" name="botcheck" tabIndex="-1" aria-hidden="true" style={{ display: 'none' }} /><button aria-label="Subscribe" disabled={newsletterSubmitting}>{newsletterSubmitting ? 'Sending…' : 'Subscribe'}</button></form><p className="newsletter-status" role="status" aria-live="polite">{newsletterStatus}</p></div></div><div className="footer-bottom"><span>© 2026 Market Lane · Sandbox pilot</span><span>Independent finds, thoughtfully gathered</span></div></footer>

      {selectedProduct && <ProductModal product={selectedProduct} reviews={reviews.filter((review) => review.productId === selectedProduct.id)} close={() => setSelectedProduct(null)} addToCart={addToCart} saved={saved.includes(selectedProduct.id)} toggleSaved={toggleSaved} />}
      {cartOpen && <CartDrawer cart={cart} subtotal={subtotal} discount={discount} shipping={shipping} total={total} currency={quote?.currency || cart[0]?.currency || 'USD'} hasQuote={Boolean(quote)} changeQuantity={changeQuantity} close={() => setCartOpen(false)} checkout={() => { setCartOpen(false); setView('checkout'); }} clearCoupon={() => setCoupon('')} coupon={coupon} couponText={couponText} setCouponText={setCouponText} applyCoupon={applyCoupon} />}
      {modal === 'product' && <ProductForm product={editingProduct} currency={vendorProfile?.currency || 'USD'} close={() => { setModal(''); setEditingProduct(null); }} saveProduct={saveProduct} />}
      {modal === 'review' && <ReviewForm product={reviewTarget} close={() => setModal('')} saveReview={saveReview} />}
      {modal === 'account' && <BackendAccountModal login={login} authenticated={authenticated} userRole={userRole} resetToken={passwordResetToken} close={() => setModal('')} signIn={signIn} signUp={signUp} signOut={signOut} forgotPassword={api.auth.forgotPassword} resetPassword={resetPassword} />}
      {modal === 'seller' && <BackendSellerApplicationForm profile={vendorProfile} login={login} close={() => setModal('')} submit={submitSellerApplication} />}
      {invoiceOrder && <InvoiceModal order={invoiceOrder} close={() => setInvoiceOrder(null)} />}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

function InfoPageFrame({ eyebrow, title, intro, children, onBack }) {
  return <section className="info-page"><button className="back-link" onClick={onBack}>← Back to marketplace</button><header className="info-page-heading"><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{intro}</p><small>Last updated October 21, 2026 · Market Lane pilot preview</small></header><div className="info-page-content">{children}</div></section>;
}

function PolicySection({ title, children }) {
  return <section className="policy-section"><h2>{title}</h2>{children}</section>;
}

function TermsPage({ supportEmail, openContact, onBack }) {
  return <InfoPageFrame eyebrow="MARKET LANE POLICIES" title="Terms & conditions" intro="These terms explain how the Market Lane marketplace preview is intended to work for shoppers and independent sellers." onBack={onBack}>
    <div className="policy-draft-note">Pilot preview: checkout and payment are test-mode demonstrations. No live customer charge or seller payout is made through this preview. These draft terms need the marketplace operator’s details and legal review before a public launch.</div>
    <PolicySection title="1. About this preview"><p>Market Lane is a marketplace prototype that lets shoppers browse independent seller listings and lets approved sellers manage products. Some listings, shops, prices, reviews, shipping messages, and order history may be sample or demonstration data. Features and availability can change while the project is being developed.</p></PolicySection>
    <PolicySection title="2. Accounts and access"><p>Provide accurate information when creating an account and keep your sign-in details private. You are responsible for activity performed through your account. Seller and administrator workspaces require the corresponding access granted by Market Lane; choosing a portal in the interface does not grant permission.</p><p>Contact us if you believe someone has accessed your account without permission.</p></PolicySection>
    <PolicySection title="3. Seller listings"><p>Sellers are responsible for the accuracy of their product descriptions, images, prices, inventory, and fulfillment information. Market Lane may review, hide, or remove listings that are incomplete, misleading, unavailable, or unsuitable for the marketplace. A seller application must be approved before the shop can publish products.</p></PolicySection>
    <PolicySection title="4. Orders, prices, and payment"><p>Product availability and totals are checked again during checkout. The current preview uses Stripe test mode and is for demonstration only. Do not enter real payment information unless Stripe Checkout explicitly indicates a secure test environment; no live charge or live transfer should be expected. The preview’s shipping, return, promotion, and delivery messages are illustrative and do not establish a final live marketplace policy.</p></PolicySection>
    <PolicySection title="5. Reviews and marketplace conduct"><p>Use the marketplace lawfully and do not submit harmful, deceptive, infringing, or abusive content. Reviews should describe a genuine product experience and must not include another person’s private information. Market Lane may moderate or remove content and restrict access where necessary to protect the marketplace.</p></PolicySection>
    <PolicySection title="6. Content and availability"><p>Product names, shop names, and listing content belong to their respective owners. Market Lane’s original interface and brand materials may not be reused as if they belong to another business. The preview is provided as-is for evaluation and may be unavailable or changed without notice.</p></PolicySection>
    <PolicySection title="7. Contact"><p>Questions about these draft terms? Email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> or use the <button className="inline-link" onClick={openContact}>contact page</button>.</p></PolicySection>
  </InfoPageFrame>;
}

function PrivacyPage({ supportEmail, openContact, onBack }) {
  return <InfoPageFrame eyebrow="MARKET LANE POLICIES" title="Privacy notice" intro="This notice summarizes the information the current Market Lane preview handles and why it is used." onBack={onBack}>
    <div className="policy-draft-note">Pilot preview: the final marketplace operator, hosting locations, retention periods, and jurisdiction-specific privacy terms have not been finalized. This page is a project notice, not a substitute for a reviewed production privacy policy.</div>
    <PolicySection title="1. Information used"><p>Depending on the features you use, the preview may process your name and email address, account credentials, seller application and shop details, saved products, reviews, delivery address, cart contents, and order records. Passwords are stored as hashes by the API. Product photos and seller-uploaded listing images may also be processed.</p></PolicySection>
    <PolicySection title="2. How information is used"><p>Information is used to operate accounts and seller shops, display listings, maintain carts and orders, support checkout and fulfillment, prevent misuse, respond to support requests, and improve the project. We aim to collect only the information needed for these functions.</p></PolicySection>
    <PolicySection title="3. Who receives information"><p>When you place an order, the seller needs the order and delivery details required to fulfill that purchase. The preview also uses service providers for payment processing, hosting and database operations, image delivery, and newsletter contact forms. Stripe Checkout handles payment entry in test mode; Market Lane stores order and payment status and provider references, not your full card number or security code. Newsletter form submissions are sent to Web3Forms for email delivery to the configured inbox; the form alone does not create a separate marketing subscriber database.</p></PolicySection>
    <PolicySection title="4. Cookies and local storage"><p>Authentication uses an essential, HTTP-only refresh cookie. The application also uses browser memory and necessary browser storage to maintain the active session and marketplace interactions. This preview does not currently advertise analytics or targeted-ad tracking features.</p></PolicySection>
    <PolicySection title="5. Retention and security"><p>Account, order, and seller records are kept in the project database while needed to operate and demonstrate the marketplace. A final retention schedule and self-service account deletion/export flow are not yet configured. Access is limited by account roles in the application, but this pilot should not be used for sensitive personal or payment information.</p></PolicySection>
    <PolicySection title="6. Your choices and questions"><p>You can choose not to submit optional newsletter or seller application details. For questions, corrections, or a request concerning your account information, contact <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. Any privacy rights available to you depend on the laws that apply to the marketplace and your location.</p><p>Privacy guidance commonly calls for clear information about who operates a service, what data is used, why it is used, who receives it, how long it is kept, and how people can exercise applicable rights. Market Lane must finalize those details before public launch.</p></PolicySection>
    <PolicySection title="7. Contact"><p>For privacy questions, email <a href={`mailto:${supportEmail}`}>{supportEmail}</a> or visit the <button className="inline-link" onClick={openContact}>contact page</button>.</p></PolicySection>
  </InfoPageFrame>;
}

function ContactPage({ supportEmail, onBack }) {
  const placeholder = supportEmail.endsWith('.example');
  return <InfoPageFrame eyebrow="HELP & INFORMATION" title="Contact us" intro="Need help with an order, a shop, or your Market Lane account? Get in touch using the details below." onBack={onBack}>
    {placeholder && <div className="policy-draft-note">The email below is a demo placeholder. Replace it with your real support address in <code>client/.env.local</code> before sharing the site publicly.</div>}
    <div className="contact-grid"><article className="contact-card"><span className="section-kicker">EMAIL SUPPORT</span><h2>Send us a note</h2><p>For account, order, payment-test, or privacy questions, email our support address. Include an order number if your question concerns a purchase.</p><a className="button button-primary" href={`mailto:${supportEmail}`}>Email {supportEmail}</a></article><article className="contact-card"><span className="section-kicker">INDEPENDENT SELLERS</span><h2>Questions about a product?</h2><p>Product availability and fulfillment are managed by each shop. Include the product name and order number so support can direct your question to the right seller.</p></article><article className="contact-card"><span className="section-kicker">PILOT PREVIEW</span><h2>Test-mode marketplace</h2><p>Market Lane is still a pilot. Checkout uses Stripe test mode; do not expect a live charge, shipment, or seller payout from a demo order.</p></article></div>
  </InfoPageFrame>;
}

function Storefront({ products, category, setCategory, sort, setSort, openProduct, addToCart, saved, toggleSaved, query, setQuery, toast }) {
  const makers = [...new Map(products.map((product) => [product.vendorId || product.vendor, product])).values()].slice(0, 3);
  return <>
    <section className="market-hero"><div className="hero-copy"><div className="hero-kicker"><span /> GOOD THINGS, FROM SMALL SHOPS</div><h1>Find your next<br /><em>everyday favorite.</em></h1><p>Shop thoughtfully made pieces from independent makers and neighborhood brands, all in one easy place.</p><button className="button button-primary" onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>Explore the collection</button></div><div className="hero-collage" aria-label="Product photographs from independent shops"><div className="collage-tile tile-one"><img src={stockPhotos.bowl} alt="Handmade ceramic bowl" /></div><div className="collage-tile tile-two"><img src={stockPhotos.notes} alt="Stationery on a desk" /></div><div className="collage-tile tile-three"><img src={stockPhotos.tote} alt="Canvas market tote" /></div></div></section>
    <section className="maker-spotlight" id="makers"><div className="spotlight-heading"><span className="section-kicker">A FEW SHOPS TO KNOW</span><h2>Featured <em>shops.</em></h2><p>Browse the independent sellers with available listings.</p></div><div className="maker-filter-pills">{categories.map((item) => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item === 'Everything' ? 'All shops' : item}</button>)}</div>{makers.length ? <div className="maker-cards">{makers.map((maker) => <button className="maker-card" key={maker.vendorId || maker.vendor} onClick={() => { setQuery(maker.vendor); setCategory('Everything'); document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }); }}><span className="maker-art"><img src={stockPhotoFor(maker)} alt="" loading="lazy" /></span><span className="maker-meta"><b>{maker.vendor}</b><small>{maker.category}</small><em>{maker.productType || 'Independent shop'}</em></span></button>)}</div> : <div className="empty-state"><h3>No active shops yet</h3><p>Seller listings will appear here after approval and publication.</p></div>}</section>
    <section className="benefit-row"><div><span><b>Thoughtful quality</b><small>Made to last, made with care</small></span></div><div><span><b>Direct from makers</b><small>Your order supports small shops</small></span></div><div><span><b>Pilot return requests</b><small>Within 30 days of delivery</small></span></div><div><span><b>Secure checkout</b><small>Test mode for this demo</small></span></div></section>
    <section className="trend-strip"><div className="trend-title"><span className="section-kicker">START WITH A LITTLE INSPIRATION</span><b>What are you looking for?</b></div><div className="trend-links">{['Handmade ceramics', 'Market totes', 'Thoughtful gifts', 'Desk refresh'].map((term) => <button key={term} onClick={() => { setQuery(term.split(' ')[term.split(' ').length - 1]); document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }); }}>{term}<span>↗</span></button>)}</div><button className="trend-all" onClick={() => { setQuery(''); setCategory('Everything'); document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' }); }}>Browse all finds →</button></section>
    <section className="catalog-section" id="catalog"><div className="catalog-head"><div><div className="section-kicker">THE MARKET LANE EDIT</div><h2>Best finds, <em>right now.</em></h2><p>Discover listings from approved sellers.</p></div><button className="outline-button" onClick={() => toast('Browse all categories from the filters below')}>Shop all <span>→</span></button></div>
      <div className="category-cards">{categories.slice(1).map((item, index) => <button key={item} className={`category-card category-card-${index}`} onClick={() => { setCategory(item); document.getElementById('product-grid')?.scrollIntoView({ behavior: 'smooth' }); }}><img src={categoryStockPhoto[item]} alt="" loading="lazy" /><span><b>{item}</b><small>{['Objects for home', 'Made for going out', 'Paper and good ideas'][index]}</small></span></button>)}</div>
      <div className="listing-heading"><div><span className="section-kicker">SHOP THE COLLECTION</span><h2>Find your next <em>favorite.</em></h2></div><div className="listing-tools"><label className="inline-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the collection" aria-label="Search the collection" /></label><select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort products"><option value="featured">Sort: Featured</option><option value="price-low">Price: low to high</option><option value="price-high">Price: high to low</option><option value="rating">Top rated</option></select></div></div>
      <div className="filter-row"><div className="filter-pills">{categories.map((item) => <button key={item} onClick={() => setCategory(item)} className={category === item ? 'filter-pill active' : 'filter-pill'}>{item}</button>)}</div><span className="product-count">{products.length} finds</span></div>
      {products.length ? <div className="product-grid" id="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} saved={saved.includes(product.id)} toggleSaved={toggleSaved} />)}</div> : <div className="no-results"><span>⌕</span><h3>No matching finds</h3><p>Try a different search or clear the category filter.</p><button className="outline-button" onClick={() => { setQuery(''); setCategory('Everything'); }}>Clear filters</button></div>}
    </section>
    <section className="seller-cta"><div className="seller-cta-art"><img src={stockPhotos.bowl} alt="Handmade ceramic pieces at an independent studio" loading="lazy" /></div><div><span className="section-kicker">A MARKETPLACE WITH PEOPLE IN IT</span><h2>Small shops.<br /><em>Big heart.</em></h2><p>Every product has a person behind it. Meet the makers, see their process, and find something that feels like you.</p><button className="button button-light" onClick={() => document.getElementById('makers')?.scrollIntoView({ behavior: 'smooth' })}>Meet our sellers</button></div></section>
  </>;
}

function stockPhotoFor(product) {
  if (product.imageData) return product.imageData;
  if (product.imageUrl) return product.imageUrl;
  return categoryStockPhoto[product.category] || stockPhotos.mug;
}

function ProductVisual({ product, className = '' }) {
  return <img className={`product-upload ${className}`} src={stockPhotoFor(product)} alt={product.name} loading="lazy" decoding="async" />;
}

function ProductCard({ product, openProduct, addToCart, saved, toggleSaved }) {
  return <article className="product-card"><button className={`product-image image-${product.color}`} onClick={() => openProduct(product)} aria-label={`View ${product.name}`}><span className="product-badge">{product.tag}</span><ProductVisual product={product} /><span className="image-caption">{product.vendor}</span></button><button className={saved ? 'save-product saved' : 'save-product'} onClick={() => toggleSaved(product)} aria-label={saved ? 'Remove saved product' : 'Save product'}>{saved ? 'Saved' : 'Save'}</button><div className="product-card-info"><button className="seller-link" onClick={() => openProduct(product)}>{product.vendor}</button>{product.rating > 0 && <span className="card-rating">{Number(product.rating).toFixed(1)} / 5</span>}<button className="product-name" onClick={() => openProduct(product)}>{product.name}</button><div className="card-bottom"><strong>{formatMoney(product.price, product.currency)}</strong><button onClick={() => addToCart(product)} aria-label={`Add ${product.name} to bag`} disabled={!product.stock}>Add to bag</button></div></div></article>;
}

function ProductModal({ product, reviews, close, addToCart, saved, toggleSaved }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="product-modal" role="dialog" aria-modal="true" aria-label={product.name}><button className="modal-close" onClick={close} aria-label="Close">×</button><div className={`product-modal-art image-${product.color}`}><ProductVisual product={product} /><span className="image-caption">MADE BY {product.vendor.toUpperCase()}</span></div><div className="product-modal-copy"><span className="section-kicker">{product.vendor} · {product.category}</span><h2>{product.name}</h2>{product.rating > 0 && <span className="modal-rating">{Number(product.rating).toFixed(1)} / 5 <small>({product.ratingCount || reviews.length} reviews)</small></span>}<strong className="modal-price">{formatMoney(product.price, product.currency)}</strong><p>{product.description}</p><div className="stock-note"><i /> {product.stock > 0 ? `${product.stock} in stock` : 'Currently unavailable'}</div><button className="button button-primary modal-add" onClick={() => { addToCart(product); close(); }} disabled={!product.stock}>Add to bag <span>＋</span></button><button className="save-line" onClick={() => toggleSaved(product)}>{saved ? '♥ Saved to your list' : '♡ Save for later'}</button><div className="modal-details"><span>✓ Secure checkout</span><span>↺ Pilot return requests within 30 days of delivery</span></div>{reviews.length > 0 && <div className="recent-review"><b>Recent review</b><p>“{reviews[0].text}”</p><small>{reviews[0].author} · {reviews[0].rating}/5</small></div>}</div></section></div>;
}

function CartDrawer({ cart, subtotal, discount, shipping, total, currency, hasQuote, changeQuantity, close, checkout, clearCoupon, coupon, couponText, setCouponText, applyCoupon }) {
  return <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><aside className="cart-drawer" aria-label="Shopping bag">
    <div className="drawer-head"><div><span className="section-kicker">YOUR MARKET LANE BAG</span><h2>Your finds <em>({cart.reduce((sum, item) => sum + item.quantity, 0)})</em></h2></div><button className="modal-close" onClick={close} aria-label="Close bag">×</button></div>
    {cart.length ? <><div className="drawer-items">{cart.map((item) => <div className="drawer-item" key={item.id}><div className={`drawer-thumb image-${item.color}`}><ProductVisual product={item} /></div><div className="drawer-item-main"><b>{item.name}</b><small>{item.vendor}</small><div className="quantity"><button onClick={() => changeQuantity(item.id, -1)} aria-label="Decrease quantity">−</button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.id, 1)} aria-label="Increase quantity">＋</button></div></div><strong>{formatMoney(item.price * item.quantity, item.currency || currency)}</strong></div>)}</div>
      <form className="coupon-form" onSubmit={applyCoupon}><input value={couponText} onChange={(event) => setCouponText(event.target.value)} placeholder="Gift card or promo code" aria-label="Promo code" /><button>Apply</button></form>
      {coupon && <div className="coupon-applied">✓ {coupon} applied <button onClick={() => { clearCoupon(); setCouponText(''); }}>Remove</button></div>}
      <div className="cart-totals"><p><span>Subtotal</span><b>{formatMoney(subtotal, currency)}</b></p>{discount > 0 && <p className="discount-row"><span>Marketplace promotion</span><b>−{formatMoney(discount, currency)}</b></p>}<p><span>Shipping</span><b>{!hasQuote ? 'Calculated at checkout' : shipping ? formatMoney(shipping, currency) : 'On us'}</b></p><p className="grand-total"><span>Total</span><b>{formatMoney(total, currency)}</b></p><small>Final taxes and total are confirmed by the test checkout provider.</small><button type="button" className="button button-primary checkout-button" onClick={checkout}>Go to checkout <span>→</span></button><button type="button" className="continue-shopping" onClick={close}>Continue shopping</button></div>
    </> : <div className="empty-bag"><span>▱</span><h3>Your bag is waiting.</h3><p>Add a few thoughtful finds and they’ll be here.</p><button className="button button-primary" onClick={close}>Keep exploring <span>→</span></button></div>}
  </aside></div>;
}

function CheckoutPage({ cart, subtotal, discount, shipping, total, currency, hasQuote, coupon, couponText, setCouponText, applyCoupon, placeOrder, login, authenticated, shippingCountry, setShippingCountry, openAccount, goBack }) {
  if (!cart.length) return <div className="empty-state page-empty"><span>▱</span><h2>Your bag is empty</h2><p>Add products from the marketplace before checking out.</p></div>;
  if (!authenticated) return <section className="checkout-page"><button className="back-link" type="button" onClick={goBack}>← Back to marketplace</button><SignInPrompt openAccount={openAccount} /></section>;
  return <section className="checkout-page"><button className="back-link" type="button" onClick={goBack}>← Back to marketplace</button><div className="page-heading"><span className="section-kicker">A SIMPLE, SECURE CHECKOUT</span><h1>Almost <em>yours.</em></h1><p>Confirm your delivery details, then complete payment in Stripe test checkout.</p></div>
    <form className="checkout-layout" onSubmit={placeOrder}><div className="checkout-fields"><section className="checkout-card"><div className="checkout-section-title"><span>01</span><div><h2>Contact details</h2><p>Order updates go to this verified account.</p></div></div><label>Email address<input type="email" value={login.email} readOnly /></label></section>
      <section className="checkout-card"><div className="checkout-section-title"><span>02</span><div><h2>Delivery address</h2><p>Available pilot markets: United States, Canada, and United Kingdom.</p></div></div><div className="form-grid"><label>First name<input name="firstName" defaultValue={login.name.split(' ')[0]} required maxLength="100" /></label><label>Last name<input name="lastName" defaultValue={login.name.split(' ').slice(1).join(' ')} required maxLength="100" /></label><label className="form-span">Street address<input name="address" placeholder="123 Market Street" required maxLength="120" /></label><label>City<input name="city" placeholder="San Francisco" required maxLength="100" /></label><label>Region<input name="region" placeholder="State / province" maxLength="100" /></label><label>Postal code<input name="zip" placeholder="94103" required maxLength="30" /></label><label>Country<select name="country" value={shippingCountry} onChange={(event) => setShippingCountry(event.target.value)}><option value="US">United States · USD</option><option value="CA">Canada · CAD</option><option value="GB">United Kingdom · GBP</option></select></label></div></section>
      <section className="checkout-card payment-card"><div className="checkout-section-title"><span>03</span><div><h2>Payment</h2><p>Stripe-hosted test checkout · no real charges.</p></div></div><div className="sandbox-choice"><span className="radio-dot"/><span><b>Secure test payment</b><small>Card details are entered on Stripe’s hosted page.</small></span><i>TEST</i></div><div className="safe-note">Only Stripe test-mode credentials are accepted by this pilot.</div></section></div>
      <aside className="checkout-summary"><h2>Your order</h2>{cart.map((item) => <div className="summary-item" key={item.id}><span className={`summary-thumb image-${item.color}`}><ProductVisual product={item} /></span><span><b>{item.name}</b><small>{item.vendor} · Qty {item.quantity}</small></span><strong>{formatMoney(item.price * item.quantity, item.currency || currency)}</strong></div>)}
        <div className="coupon-form checkout-coupon"><input value={couponText} onChange={(event) => setCouponText(event.target.value)} placeholder="Promo code" aria-label="Promo code" /><button type="button" onClick={applyCoupon}>Apply</button></div>{coupon && <small className="coupon-applied">✓ {coupon} applied</small>}
        <div className="cart-totals"><p><span>Subtotal</span><b>{formatMoney(subtotal, currency)}</b></p>{discount > 0 && <p className="discount-row"><span>Discount</span><b>−{formatMoney(discount, currency)}</b></p>}<p><span>Shipping</span><b>{!hasQuote ? 'Calculated at checkout' : shipping ? formatMoney(shipping, currency) : 'On us'}</b></p><p className="grand-total"><span>Total</span><b>{formatMoney(total, currency)}</b></p></div>
        <button className="button button-primary checkout-button">Continue to Stripe test checkout <span>→</span></button><small className="order-terms">The order is created using server prices and confirmed by a signed payment event.</small>
      </aside></form></section>;
}

function OrdersPage({ orders, openReview, showInvoice, requestReturn }) {
  return <section className="dashboard-page customer-orders"><PageHeading eyebrow="YOUR ACCOUNT" title="Orders & returns" description="Keep track of your marketplace orders and deliveries." /><div className="order-list">{orders.map((order) => <OrderCard key={order.id} order={order} customer openReview={openReview} showInvoice={showInvoice} requestReturn={requestReturn} />)}</div>{orders.length === 0 && <EmptyState title="No orders yet" description="Your purchases will appear here." />}</section>;
}

function SavedPage({ products, openProduct, addToCart, toggleSaved }) {
  return <section className="dashboard-page"><PageHeading eyebrow="YOUR ACCOUNT" title="Saved finds" description="A little list of things you’d like to come back to." /><div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} openProduct={openProduct} addToCart={addToCart} saved toggleSaved={toggleSaved} />)}</div>{products.length === 0 && <EmptyState title="Nothing saved just yet" description="Use Save on a product to keep it here for later." />}</section>;
}

function OrdersTable({ orders, advanceOrder, admin }) {
  return <div className="order-table"><div className="table-head order-table-grid"><span>Order</span><span>{admin ? 'Customer' : 'Buyer'}</span><span>Date</span><span>Total</span><span>Status</span><span>Payment</span>{!admin && <span />}</div>{orders.map((order) => <div className="table-row order-table-grid" key={order.id}><b>{order.id}</b><span>{order.customer}</span><span>{order.date}</span><b>{formatMoney(order.total, order.currency)}</b><StatusBadge status={order.status} /><span className="payment-label">{order.payment}</span>{!admin && <button className="row-action" onClick={() => advanceOrder?.(order.id)} disabled={order.status === 'Delivered'}>{order.status === 'Delivered' ? 'Complete' : 'Advance →'}</button>}</div>)}</div>;
}

function OrderCard({ order, customer, vendor, openReview, advanceOrder, showInvoice, requestReturn }) {
  const next = orderSteps[orderSteps.indexOf(order.status) + 1];
  const deliveredAllocations = customer ? (order.allocations || []).filter((allocation) => allocation.status === 'delivered') : [];
  return <article className="order-card"><div className="order-card-head"><div><span className="section-kicker">ORDER {order.id}</span><small>Placed {order.date}</small></div><StatusBadge status={order.status} /></div><div className="order-card-items">{order.items.map((item, index) => <div className="order-line-item" key={`${order.id}-${index}`}><span className="order-thumb"><ProductVisual product={item} /></span><span><b>{item.name}</b><small>{item.vendor} · Qty {item.quantity}</small></span><strong>{formatMoney(item.price * item.quantity, item.currency || order.currency)}</strong></div>)}</div><div className="order-card-foot"><div><small>Order total</small><b>{formatMoney(order.total, order.currency)}</b>{vendor && <small className="payment-label">{order.payment}</small>}</div><div className="order-actions">{customer && order.status === 'Delivered' && <button className="outline-button" onClick={() => openReview(order)}>Write a review</button>}{customer && order.paymentStatus === 'paid' && <button className="outline-button" onClick={() => showInvoice(order)}>View invoice</button>}{customer && order.paymentStatus === 'paid' && deliveredAllocations.map((allocation) => allocation.returnStatus === 'requested' || allocation.returnStatus === 'approved' || allocation.returnStatus === 'completed' ? <small key={allocation.id}>{allocation.vendor} return · {allocation.returnStatus}</small> : <button className="outline-button" key={allocation.id} onClick={() => requestReturn(order, allocation)}>Request return · {allocation.vendor}</button>)}{vendor && next && <button className="button button-primary" onClick={() => advanceOrder(order.id)}>Mark as {next.toLowerCase()} <span>→</span></button>}</div></div></article>;
}

function StatusBadge({ status }) {
  const kind = status.toLowerCase().replaceAll(' ', '-');
  return <span className={`status-badge status-${kind}`}><i />{status}</span>;
}

function PageHeading({ eyebrow, title, description, action }) {
  return <header className="page-heading"><div><span className="section-kicker">{eyebrow}</span><h1>{title.split(' ').slice(0, -1).join(' ')} <em>{title.split(' ').slice(-1)}</em></h1><p>{description}</p></div>{action}</header>;
}

function Stat({ label, value, change, icon }) {
  return <article className="stat-card"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong><small>{change}</small><span className="stat-trend">↗</span></article>;
}

function EmptyState({ title, description }) {
  return <div className="empty-state"><h2>{title}</h2><p>{description}</p></div>;
}

function ProductForm({ product, currency = 'USD', close, saveProduct }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><form className="form-modal" onSubmit={saveProduct}><div className="form-modal-head"><div><span className="section-kicker">SELLER STUDIO</span><h2>{product ? 'Edit product' : 'Add a product'}</h2><p>New and updated listings go to admin review.</p></div><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button></div><label>Product name<input name="name" defaultValue={product?.name} placeholder="e.g. Hand-thrown breakfast bowl" required maxLength="100" /></label><div className="form-grid"><label>Category<select name="category" defaultValue={product?.category || 'Home'}><option>Home</option><option>Accessories</option><option>Stationery</option></select></label><label>Product type<input name="productType" defaultValue={product?.productType || ''} placeholder="e.g. Cups, bowls, or drinkware" required maxLength="60" /></label><label>Base price ({currency})<input name="price" type="number" min="0.01" step="0.01" defaultValue={product?.price} placeholder="24.00" required /></label><label>Available stock<input name="stock" type="number" min="0" defaultValue={product?.stock ?? 1} required /></label><label className="form-span image-upload-label">Product photo<input name="photo" type="file" accept="image/png,image/jpeg,image/webp" /><small>PNG, JPG, or WebP · maximum 5 MB</small></label><label className="form-span">Description<textarea name="description" rows="4" defaultValue={product?.description} placeholder="Tell shoppers what makes this piece special…" maxLength="2000" required /></label></div><div className="form-modal-actions"><button type="button" className="outline-button" onClick={close}>Cancel</button><button className="button button-primary">{product ? 'Save draft changes' : 'Submit listing'} <span>→</span></button></div></form></div>;
}

function ReviewForm({ product, close, saveReview }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><form className="form-modal review-modal" onSubmit={saveReview}><div className="form-modal-head"><div><span className="section-kicker">SHARE THE LOVE</span><h2>How was it?</h2><p>Your review helps independent sellers grow.</p></div><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button></div><div className="review-product"><b>{product?.name}</b></div><label>Rating<select name="rating" defaultValue="5"><option value="5">★★★★★ · Loved it</option><option value="4">★★★★☆ · Really good</option><option value="3">★★★☆☆ · It’s okay</option><option value="2">★★☆☆☆ · Not for me</option><option value="1">★☆☆☆☆ · Disappointed</option></select></label><label>Your review<textarea name="review" rows="4" required minLength="8" maxLength="500" placeholder="What did you like about it?" /></label><div className="form-modal-actions"><button type="button" className="outline-button" onClick={close}>Cancel</button><button className="button button-primary">Post review <span>→</span></button></div></form></div>;
}

function InvoiceModal({ order, close }) {
  const itemTotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const currency = order.currency || 'USD';
  const discount = Number(order.discount ?? ((order.discountMinor || 0) / 100));
  const shipping = order.shippingMinor === undefined ? Math.max(0, order.total - itemTotal + discount) : order.shippingMinor / 100;
  const tax = (order.taxMinor || 0) / 100;
  return <div className="modal-backdrop invoice-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="invoice-modal" role="dialog" aria-modal="true" aria-label={`Invoice ${order.id}`}><div className="invoice-actions"><button className="outline-button" onClick={close}>Close</button><button className="button button-primary" onClick={() => window.print()}>Print / save PDF <span>↓</span></button></div><article className="invoice-print"><div className="invoice-head"><div><span className="brand-mark">ML</span><h2>market<span>lane</span></h2></div><div><b>INVOICE</b><span>{order.orderNumber || order.id}</span></div></div><div className="invoice-meta"><div><small>BILLED TO</small><b>{order.customer}</b><span>{order.email}</span></div><div><small>ORDER DATE</small><b>{order.date}</b><span>Payment: {order.payment}</span></div></div><div className="invoice-lines"><div className="invoice-line invoice-line-head"><span>ITEM</span><span>QTY</span><span>UNIT PRICE</span><span>AMOUNT</span></div>{order.items.map((item, index) => <div className="invoice-line" key={`${order.id}-invoice-${index}`}><span><b>{item.name}</b><small>Sold by {item.vendor}</small></span><span>{item.quantity}</span><span>{formatMoney(item.price, currency)}</span><b>{formatMoney(item.price * item.quantity, currency)}</b></div>)}</div><div className="invoice-total"><span>Items subtotal</span><b>{formatMoney(order.subtotalMinor === undefined ? itemTotal : order.subtotalMinor / 100, currency)}</b>{discount > 0 && <><span>Discount</span><b>−{formatMoney(discount, currency)}</b></>}<span>Shipping</span><b>{formatMoney(shipping, currency)}</b>{tax > 0 && <><span>Tax</span><b>{formatMoney(tax, currency)}</b></>}<strong>Total paid · test mode</strong><strong>{formatMoney(order.total, currency)}</strong></div><p className="invoice-footer-note">Thank you for supporting independent sellers.<br />Market Lane · Stripe test-mode invoice · No live payment</p></article></section></div>;
}

function SignInPrompt({ openAccount }) {
  return <div className="empty-state page-empty"><span>◌</span><h2>Sign in to continue</h2><p>Your orders and checkout are tied to your Market Lane account.</p><button className="button button-primary" onClick={openAccount}>Sign in or create account <span>→</span></button></div>;
}

function VendorPendingPage({ profile }) {
  const status = profile?.status || 'pending';
  const description = status === 'rejected' ? 'The application was declined. Contact marketplace support if you need help.' : status === 'suspended' ? 'This shop is suspended. Contact marketplace support for next steps.' : 'Your application is in the review queue. You will be able to publish listings after approval.';
  return <section className="dashboard-page"><PageHeading eyebrow="SELLER APPLICATION" title="Shop review" description="Seller access is controlled by marketplace administrators." /><section className="panel"><StatusBadge status={status} /><h2>{profile?.shopName || 'Application submitted'}</h2><p>{description}</p></section></section>;
}

function BackendVendorPage({ view, seller, products, orders, addProduct, editProduct, advanceOrder, archiveProduct, connect }) {
  const revenueMinor = orders.reduce((sum, order) => sum + (order.payoutAmountMinor || 0), 0);
  const currency = seller.currency || 'USD';
  const currentProducts = products.filter((product) => !product.archived);
  return <section className="dashboard-page"><PageHeading eyebrow={`SELLER STUDIO · ${seller.shopName.toUpperCase()}`} title={view === 'vendor-orders' ? 'Your orders' : view === 'products' ? 'Product catalog' : 'Shop overview'} description={seller.description || 'Manage your shop, products, and fulfillment.'} action={view === 'products' ? <button className="button button-primary" onClick={addProduct}>＋ Add product</button> : null} />
    {view === 'vendor' && <><div className="stats-grid"><Stat label="Payout allocation" value={formatMoney(revenueMinor / 100, currency)} change="Paid orders in your shop currency" icon="$" /><Stat label="Published products" value={currentProducts.filter((product) => product.status === 'published').length} change="Approved marketplace listings" icon="◒" /><Stat label="Orders to fulfill" value={orders.filter((order) => order.status !== 'Delivered').length} change="Only your shop allocations" icon="▤" /><Stat label="Payout terms" value="30 days" change="After confirmed delivery" icon="↗" /></div>
      <section className="panel"><div className="panel-heading"><div><h2>Stripe Connect test onboarding</h2><p>{seller.stripeDetailsSubmitted && seller.stripeTransfersEnabled && seller.stripePayoutsEnabled ? 'Stripe has confirmed the connected account capabilities for test transfers.' : 'Complete onboarding and wait for Stripe capability confirmation before test transfers can run.'}</p></div><button className="button button-primary" onClick={connect}>{seller.stripeTransfersEnabled ? 'Review test onboarding' : 'Open test onboarding'} <span>→</span></button></div><small>Details submitted: {seller.stripeDetailsSubmitted ? 'yes' : 'no'} · Transfers: {seller.stripeTransfersEnabled ? 'enabled' : 'pending'} · Payouts: {seller.stripePayoutsEnabled ? 'enabled' : 'pending'} · No live transfers are enabled in this pilot.</small></section>
      <section className="panel"><div className="panel-heading"><div><h2>Recent orders</h2><p>Only allocations for {seller.shopName}.</p></div></div>{orders.slice(0, 5).map((order) => <div className="vendor-row" key={order.id}><span className="order-id">{order.orderNumber}</span><span>{order.items.length} item(s)</span><StatusBadge status={order.status} /><b>{formatMoney(order.payoutAmountMinor / 100, order.payoutCurrency || currency)}</b></div>)}</section></>}
    {view === 'products' && <><div className="table-toolbar"><span>{currentProducts.length} listings</span><span>New and edited listings need admin review before publication.</span></div><div className="data-table"><div className="table-head product-table"><span>Product</span><span>Category</span><span>Base price</span><span>Stock</span><span>Status</span><span /></div>{currentProducts.map((product) => <div className="table-row product-table" key={product.id}><div className="table-product"><span className={`table-thumb image-${product.color}`}><ProductVisual product={product} /></span><span><b>{product.name}</b><small>{product.productType}</small></span></div><span>{product.category}</span><b>{formatMoney(product.price, product.baseCurrency || currency)}</b><span>{product.stock} units</span><StatusBadge status={product.status || 'draft'} /><div className="table-actions"><button onClick={() => editProduct(product)}>Edit</button><button className="subtle-danger" onClick={() => archiveProduct(product.id)}>Archive</button></div></div>)}</div></>}
    {view === 'vendor-orders' && <div className="order-list">{orders.map((order) => <OrderCard key={order.id} order={order} vendor advanceOrder={advanceOrder} />)}{orders.length === 0 && <EmptyState title="No orders to fulfill" description="Paid orders assigned to your shop appear here." />}</div>}
  </section>;
}

function BackendAdminPage({ view, products, orders, overview, vendors, moderateVendor, moderateProduct, confirmDelivery, reviewReturn, retryReturnRefund }) {
  const sales = Object.entries(overview?.paidSalesByCurrency || {}).map(([currency, value]) => `${formatMoney(value.grossMinor / 100, currency)} gross`).join(' · ') || 'No paid orders';
  const commission = Object.entries(overview?.paidSalesByCurrency || {}).map(([currency, value]) => formatMoney(value.commissionMinor / 100, currency)).join(' · ') || '—';
  return <section className="dashboard-page"><PageHeading eyebrow="MARKETPLACE CONTROL" title={view === 'admin-orders' ? 'All orders' : view === 'admin-products' ? 'Catalog oversight' : view === 'admin-vendors' ? 'Seller applications' : 'Platform overview'} description="Marketplace records and moderation actions from the API." />
    {view === 'admin' && <><div className="stats-grid"><Stat label="Paid sales" value={sales} change="Stripe test-mode orders only" icon="$" /><Stat label="Commission" value={commission} change="Recorded on paid orders" icon="↗" /><Stat label="Published listings" value={overview?.activeProducts ?? products.filter((product) => product.status === 'published').length} change="Server catalog" icon="◒" /><Stat label="Pending sellers" value={overview?.pendingApplications ?? vendors.filter((vendor) => vendor.status === 'pending').length} change="Awaiting admin decision" icon="♙" /></div><section className="panel"><div className="panel-heading"><div><h2>Recent orders</h2><p>Payments are confirmed by verified Stripe test webhooks.</p></div><span className="pulse-dot">TEST MODE</span></div><OrdersTable orders={orders.slice(0, 5)} admin /></section><section className="panel"><div className="panel-heading"><div><h2>Applications to review</h2><p>Approve only after reviewing seller information.</p></div></div><AdminVendorList vendors={vendors.filter((vendor) => vendor.status === 'pending')} moderateVendor={moderateVendor} /></section></>}
      {view === 'admin-orders' && <><section className="panel"><div className="panel-heading"><div><h2>Order ledger</h2><p>Marketplace order and payment states.</p></div></div><OrdersTable orders={orders} admin /></section><section className="panel"><div className="panel-heading"><div><h2>Delivery confirmation</h2><p>Confirm seller-reported delivery after checking tracking. The 30-day payout hold starts after confirmation.</p></div></div><AdminDeliveryReview orders={orders} confirmDelivery={confirmDelivery} /></section><section className="panel"><div className="panel-heading"><div><h2>Return review</h2><p>Approve a return to request a Stripe test refund. Signed events finish refunds and transfer reversals.</p></div></div><AdminReturnReview orders={orders} reviewReturn={reviewReturn} retryReturnRefund={retryReturnRefund} /></section></>}
    {view === 'admin-products' && <div className="data-table"><div className="table-head admin-product-table"><span>Listing</span><span>Seller</span><span>Category</span><span>Price</span><span>Inventory</span><span>Status</span><span /></div>{products.map((product) => <div className="table-row admin-product-table" key={product.id}><div className="table-product"><span className={`table-thumb image-${product.color}`}><ProductVisual product={product} /></span><b>{product.name}</b></div><span>{product.vendor}</span><span>{product.category}</span><b>{formatMoney(product.price, product.baseCurrency || product.currency)}</b><span>{product.stock}</span><StatusBadge status={product.status || 'draft'} /><div className="table-actions">{product.status !== 'published' && <button onClick={() => moderateProduct(product, 'published')}>Publish</button>}{product.status === 'published' && <button className="subtle-danger" onClick={() => moderateProduct(product, 'unpublished')}>Unpublish</button>}</div></div>)}</div>}
    {view === 'admin-vendors' && <section className="panel"><div className="panel-heading"><div><h2>Seller applications and accounts</h2><p>Every decision is recorded in the audit log.</p></div></div><AdminVendorList vendors={vendors} moderateVendor={moderateVendor} /></section>}
  </section>;
}

function AdminDeliveryReview({ orders, confirmDelivery }) {
  const pending = orders.flatMap((order) => (order.allocations || []).filter((allocation) => ['paid', 'partially_refunded'].includes(order.paymentStatus) && allocation.status === 'delivered' && !allocation.stripeTransferId && !['requested', 'approved', 'completed'].includes(allocation.returnStatus) && (!allocation.deliveryConfirmedAt || allocation.payoutStatus === 'review')).map((allocation) => ({ order, allocation })));
  if (!pending.length) return <EmptyState title="No deliveries need confirmation" description="Delivered allocations awaiting review will appear here." />;
  return <div className="seller-directory">{pending.map(({ order, allocation }) => <article className="seller-card" key={`${order.orderNumber}-${allocation.id}`}><span className="seller-established">{order.orderNumber}</span><h3>{allocation.vendor}</h3><p>{allocation.carrier || 'Carrier not provided'} · {allocation.trackingNumber || 'Tracking not provided'}</p><small>Payment: {order.paymentStatus} · Connect transfers: {allocation.deliveryConfirmedAt ? 'payout review required' : 'delivery not confirmed'} · Payout: {allocation.payoutStatus}</small><div className="table-actions"><button onClick={() => confirmDelivery(order.orderNumber, allocation)}>{allocation.deliveryConfirmedAt ? 'Requeue payout after review' : 'Confirm delivery · start 30-day hold'}</button></div></article>)}</div>;
}

function AdminReturnReview({ orders, reviewReturn, retryReturnRefund }) {
  const pending = orders.flatMap((order) => (order.allocations || []).filter((allocation) => allocation.returnStatus === 'requested' || (allocation.returnStatus === 'approved' && allocation.refundStatus !== 'succeeded')).map((allocation) => ({ order, allocation })));
  if (!pending.length) return <EmptyState title="No return requests to review" description="Customer return requests will appear here." />;
  return <div className="seller-directory">{pending.map(({ order, allocation }) => <article className="seller-card" key={`${order.orderNumber}-${allocation.id}`}><span className="seller-established">{order.orderNumber}</span><h3>{allocation.vendor}</h3><p>{allocation.returnReason || 'Approved return'}</p><small>{allocation.returnStatus === 'requested' ? `Requested ${allocation.returnRequestedAt ? new Date(allocation.returnRequestedAt).toLocaleDateString() : 'recently'}` : `Refund ${allocation.refundStatus || 'pending'} · ${formatMoney((allocation.refundAmountMinor || 0) / 100, order.currency)}`} · Payout: {allocation.payoutStatus}</small><div className="table-actions">{allocation.returnStatus === 'requested' ? <><button onClick={() => reviewReturn(order.orderNumber, allocation, 'approved')}>Approve and refund</button><button className="subtle-danger" onClick={() => reviewReturn(order.orderNumber, allocation, 'rejected')}>Reject</button></> : <button onClick={() => retryReturnRefund(order.orderNumber, allocation.id)}>Retry or check refund</button>}</div></article>)}</div>;
}

function AdminVendorList({ vendors, moderateVendor }) {
  return vendors.length ? <div className="seller-directory">{vendors.map((vendor) => <article className="seller-card" key={vendor.id}><span className="seller-avatar">{vendor.shopName.slice(0, 1)}</span><span className="seller-established">{vendor.country} · {vendor.currency}</span><h3>{vendor.shopName}</h3><p>{vendor.description}</p><small>{vendor.owner?.name} · {vendor.contactEmail}</small><div className="seller-card-stats"><StatusBadge status={vendor.status} /></div><div className="table-actions">{vendor.status !== 'active' && <button onClick={() => moderateVendor(vendor, 'active')}>Approve</button>}{vendor.status === 'pending' && <button className="subtle-danger" onClick={() => moderateVendor(vendor, 'rejected')}>Reject</button>}{vendor.status === 'active' && <button className="subtle-danger" onClick={() => moderateVendor(vendor, 'suspended')}>Suspend</button>}</div></article>)}</div> : <EmptyState title="No applications to review" description="New seller applications will appear here." />;
}

function BackendCouponsPage({ coupons, createCoupon, toggleCoupon }) {
  return <section className="dashboard-page"><PageHeading eyebrow="MARKETPLACE CONTROL" title="Coupon codes" description="Promotions are validated and reserved by the API." />
    <form className="panel coupon-admin-form" onSubmit={createCoupon}><div><span className="section-kicker">NEW PROMOTION</span><h2>Create a coupon</h2><p>Discounts are calculated from current server prices.</p></div><div className="coupon-admin-fields"><label>Coupon code<input name="code" placeholder="e.g. WELCOME15" minLength="4" maxLength="24" pattern="[A-Za-z0-9_-]+" required /></label><label>Discount<input name="percent" type="number" min="1" max="80" defaultValue="10" required /></label><label>Customer note<input name="description" placeholder="A thank-you from Market Lane" /></label><button className="button button-primary">Create coupon <span>＋</span></button></div></form>
    <section className="panel"><div className="panel-heading"><div><h2>Promotions</h2><p>{coupons.filter((coupon) => coupon.status === 'Active').length} active codes · MongoDB-backed</p></div></div><div className="coupon-list">{coupons.map((coupon) => <article className="coupon-row" key={coupon.id}><div className="coupon-code">{coupon.code}</div><div className="coupon-desc"><b>{coupon.percent}% off</b><small>{coupon.description}</small></div><span className="coupon-uses">{coupon.uses} uses</span><StatusBadge status={coupon.status} /><button className="row-action" onClick={() => toggleCoupon(coupon)}>{coupon.status === 'Active' ? 'Pause' : 'Activate'}</button></article>)}</div></section>
  </section>;
}

function BackendAccountModal({ login, authenticated, userRole, resetToken, close, signIn, signUp, signOut, forgotPassword, resetPassword }) {
  const [mode, setMode] = useState(resetToken ? 'reset' : 'signin');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event) {
    event.preventDefault(); setError(''); setMessage('');
    const form = new FormData(event.currentTarget);
    try {
      if (mode === 'signin') await signIn(String(form.get('email')), String(form.get('password')));
      else if (mode === 'signup') await signUp(String(form.get('name')), String(form.get('email')), String(form.get('password')));
      else if (mode === 'forgot') { const result = await forgotPassword(String(form.get('email'))); setMessage(result.data.message); }
      else { await resetPassword(resetToken, String(form.get('password'))); setMode('signin'); setMessage('Password updated. Sign in to continue.'); }
    } catch (submitError) { setError(submitError.message); }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><section className="form-modal account-modal">
    <div className="form-modal-head"><div><span className="section-kicker">YOUR MARKET LANE ACCOUNT</span><h2>{authenticated && mode !== 'reset' ? 'Your account.' : mode === 'signup' ? 'Join the marketplace.' : mode === 'forgot' ? 'Reset your password.' : mode === 'reset' ? 'Choose a new password.' : 'Welcome back.'}</h2><p>{authenticated && mode !== 'reset' ? `${login.email} · ${userRole}` : mode === 'signup' ? 'Create an account. We will email a verification link.' : 'Sign in to manage orders, saved finds, and checkout.'}</p></div><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button></div>
    {authenticated && mode !== 'reset' ? <div className="account-authenticated"><p>Signed in as <b>{login.name}</b>.</p><button className="button button-primary" onClick={signOut}>Sign out</button></div> : <>
      {mode !== 'reset' && <div className="account-tabs"><button type="button" className={mode === 'signin' ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button><button type="button" className={mode === 'signup' ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Create account</button></div>}
      <form onSubmit={submit}>{mode === 'signup' && <label>Your name<input name="name" placeholder="Jordan Lee" required minLength="2" maxLength="100" /></label>}{mode !== 'reset' && <label>Email address<input name="email" type="email" defaultValue={login.email} placeholder="you@example.com" required maxLength="254" /></label>}{(mode === 'signin' || mode === 'signup' || mode === 'reset') && <label>Password<input name="password" type="password" required minLength="12" maxLength="200" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>}{error && <p className="form-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}<button className="button button-primary account-save">{mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : 'Sign in'} <span>→</span></button></form>
      {mode === 'signin' && <button className="save-line" onClick={() => { setMode('forgot'); setError(''); }}>Forgot password?</button>}{mode === 'forgot' && <button className="save-line" onClick={() => setMode('signin')}>Back to sign in</button>}
      <small>Refresh sessions use an HttpOnly secure cookie. Passwords and session tokens are never stored in browser storage.</small>
    </>}
  </section></div>;
}

function BackendSellerApplicationForm({ profile, login, close, submit }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}><form className="form-modal seller-application" onSubmit={submit}><div className="form-modal-head"><div><span className="section-kicker">SELL WITH MARKET LANE</span><h2>Your shop starts here.</h2><p>Seller applications are reviewed by the marketplace admin.</p></div><button type="button" className="modal-close" onClick={close} aria-label="Close">×</button></div><div className="form-grid"><label>Shop name<input name="shopName" defaultValue={profile?.shopName || ''} placeholder="Your shop name" maxLength="80" required /></label><label>Business email<input name="email" type="email" defaultValue={profile?.contactEmail || login.email} placeholder="hello@yourshop.com" required /></label><label>Seller country<select name="country" defaultValue={profile?.country || 'US'}><option value="US">United States</option><option value="CA">Canada</option><option value="GB">United Kingdom</option></select></label><label className="form-span">What do you make?<textarea name="description" rows="3" defaultValue={profile?.description || ''} placeholder="A few words about your shop…" maxLength="500" required /></label></div><div className="seller-demo-note">Approval is required before you can publish products or fulfill orders.</div><div className="form-modal-actions"><button type="button" className="outline-button" onClick={close}>Not now</button><button className="button button-primary">Submit application <span>→</span></button></div></form></div>;
}

export default App;
