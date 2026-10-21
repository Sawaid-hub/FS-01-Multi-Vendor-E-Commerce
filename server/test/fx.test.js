const test = require('node:test');
const assert = require('node:assert/strict');
const { convertMinor, getFxRate } = require('../src/services/fx');
const { ApiError } = require('../src/utils/api-error');

test('same-currency conversion keeps exact minor units', async () => {
  const result = await convertMinor(12345, 'USD', 'USD', { fxRatesOverride: '' });
  assert.equal(result.amountMinor, 12345);
  assert.equal(result.rate, 1);
  assert.equal(result.provider, 'identity');
});

test('configured FX rates convert and return a quote snapshot', async () => {
  const config = { fxRatesOverride: JSON.stringify({ USD: { CAD: 1.36 } }), fxApiUrl: 'https://unused.invalid/latest' };
  const result = await convertMinor(1000, 'USD', 'CAD', config);
  assert.equal(result.amountMinor, 1360);
  assert.equal(result.rate, 1.36);
  assert.equal(result.provider, 'configured-override');
  assert.ok(result.quotedAt instanceof Date);
});

test('invalid configured rates fail closed without a hidden fallback', async () => {
  const config = { fxRatesOverride: '{bad json', fxApiUrl: 'https://unused.invalid/latest' };
  await assert.rejects(getFxRate('USD', 'GBP', config), (error) => error instanceof ApiError && error.status === 503 && error.code === 'fx_configuration_invalid');
});
