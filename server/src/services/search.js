const Product = require('../models/product');

function createSearchAdapter(config) {
  if (config.searchProvider !== 'elastic') {
    return {
      provider: 'mongodb',
      async healthCheck() { return true; },
      async searchProductIds(query, filters = {}) {
        const mongoFilter = { status: 'published', $text: { $search: query } };
        if (filters.category) mongoFilter.category = filters.category;
        if (filters.productType) mongoFilter.productType = new RegExp(`^${escapeRegex(filters.productType)}$`, 'i');
        const products = await Product.find(mongoFilter).select('_id').sort({ score: { $meta: 'textScore' } }).limit(500).lean();
        return products.map((product) => String(product._id));
      },
      async indexProduct() {},
      async removeProduct() {}
    };
  }

  const baseUrl = config.elasticsearchUrl.replace(/\/$/, '');
  const headers = { Authorization: `ApiKey ${config.elasticsearchApiKey}`, 'Content-Type': 'application/json' };
  const indexUrl = `${baseUrl}/${encodeURIComponent(config.elasticsearchIndex)}`;
  async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`search_provider_http_${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  return {
    provider: 'elastic',
    async healthCheck() {
      const response = await fetch(indexUrl, { method: 'HEAD', headers, signal: AbortSignal.timeout(3000) });
      return response.ok;
    },
    async searchProductIds(query, filters = {}) {
      const filter = [];
      if (filters.category) filter.push({ term: { category: filters.category } });
      if (filters.productType) filter.push({ term: { productType: filters.productType.toLowerCase() } });
      const result = await request(`${indexUrl}/_search`, {
        method: 'POST', body: JSON.stringify({ size: 500, _source: false, query: { bool: { must: [{ multi_match: { query, fields: ['name^3', 'productType^2', 'description'], type: 'best_fields' } }], filter } } })
      });
      return (result.hits?.hits || []).map((hit) => hit._id);
    },
    async indexProduct(product) {
      const doc = { name: product.name, productType: product.productType.toLowerCase(), description: product.description, category: product.category, updatedAt: product.updatedAt };
      await request(`${indexUrl}/_doc/${encodeURIComponent(String(product._id))}`, { method: 'PUT', body: JSON.stringify(doc) });
    },
    async removeProduct(id) {
      const response = await fetch(`${indexUrl}/_doc/${encodeURIComponent(String(id))}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) });
      if (!response.ok && response.status !== 404) throw new Error(`search_provider_http_${response.status}`);
    }
  };
}

async function syncProductIndexEvent(event, adapter) {
  const product = await Product.findById(event.entityId).lean();
  if (!product || product.status !== 'published') return adapter.removeProduct(event.entityId);
  return adapter.indexProduct(product);
}

async function persistProductWithSearchEvent(product, { create = false, config }) {
  const mongoose = require('mongoose');
  const SearchOutboxEvent = require('../models/search-outbox-event');
  const session = await mongoose.startSession();
  let saved;
  try {
    await session.withTransaction(async () => {
      if (create) {
        const [created] = await Product.create([product], { session });
        saved = created;
      } else {
        await product.save({ session });
        saved = product;
      }
      if (config.searchProvider === 'elastic') await SearchOutboxEvent.create([{ eventType: 'product.changed', entityId: String(saved._id) }], { session });
    });
    return saved;
  } finally {
    await session.endSession();
  }
}

function startSearchOutboxWorker(adapter, { intervalMs = 3000 } = {}) {
  if (adapter.provider !== 'elastic') return () => {};
  const SearchOutboxEvent = require('../models/search-outbox-event');
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (let count = 0; count < 20; count += 1) {
        const now = new Date();
        const staleLock = new Date(now.getTime() - 5 * 60 * 1000);
        const event = await SearchOutboxEvent.findOneAndUpdate({
          $or: [
            { status: 'pending', nextAttemptAt: { $lte: now } },
            { status: 'processing', lockedAt: { $lte: staleLock } }
          ]
        }, { $set: { status: 'processing', lockedAt: now }, $inc: { attempts: 1 } }, { new: true, sort: { createdAt: 1 } });
        if (!event) break;
        try {
          await syncProductIndexEvent(event, adapter);
          event.status = 'processed'; event.processedAt = new Date(); event.lockedAt = null; event.lastErrorCode = '';
          await event.save();
        } catch (error) {
          event.status = event.attempts >= 8 ? 'failed' : 'pending';
          event.nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 1000 * (2 ** event.attempts)));
          event.lockedAt = null; event.lastErrorCode = String(error.code || error.name || 'search_sync_failed').slice(0, 100);
          await event.save();
        }
      }
    } catch (error) {
      console.error(JSON.stringify({ event: 'search_outbox_worker_failed', errorType: error.name || 'Error' }));
    } finally { running = false; }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

module.exports = { createSearchAdapter, persistProductWithSearchEvent, startSearchOutboxWorker };
