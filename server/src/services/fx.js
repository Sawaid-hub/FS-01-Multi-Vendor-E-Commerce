const { ApiError } = require('../utils/api-error');

const rateCache = new Map();
const CACHE_MS = 60 * 60 * 1000;

async function getFxRate(base, quote, config) {
  if (base === quote) return { rate: 1, provider: 'identity', quotedAt: new Date() };
  const key = `${base}:${quote}`;
  const cached = rateCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_MS) return cached.value;
  if (config.fxRatesOverride) {
    try {
      const overrides = JSON.parse(config.fxRatesOverride);
      const rate = Number(overrides?.[base]?.[quote]);
      if (Number.isFinite(rate) && rate > 0) {
        const value = { rate, provider: 'configured-override', quotedAt: new Date() };
        rateCache.set(key, { value, cachedAt: Date.now() });
        return value;
      }
    } catch { throw new ApiError(503, 'fx_configuration_invalid', 'Currency conversion is temporarily unavailable.'); }
  }
  try {
    const url = new URL(config.fxApiUrl);
    url.searchParams.set('base', base);
    url.searchParams.set('symbols', quote);
    const response = await fetch(url, { signal: AbortSignal.timeout(4000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`FX provider returned ${response.status}`);
    const payload = await response.json();
    const rate = Number(payload.rates?.[quote]);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('FX provider returned an invalid rate');
    const value = { rate, provider: url.hostname, quotedAt: payload.date ? new Date(`${payload.date}T00:00:00.000Z`) : new Date() };
    rateCache.set(key, { value, cachedAt: Date.now() });
    return value;
  } catch {
    throw new ApiError(503, 'fx_unavailable', 'Currency conversion is temporarily unavailable. Please try again.');
  }
}

async function convertMinor(amountMinor, base, quote, config) {
  const fx = await getFxRate(base, quote, config);
  return { amountMinor: Math.round(amountMinor * fx.rate), ...fx };
}

module.exports = { getFxRate, convertMinor };
