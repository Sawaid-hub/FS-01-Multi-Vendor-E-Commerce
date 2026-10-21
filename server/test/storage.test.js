const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const mongoose = require('mongoose');
const { createStorage } = require('../src/services/storage');

it('validates local image signatures, key ownership, and path traversal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'market-lane-upload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const storage = createStorage({ s3Bucket: '', uploadsDir: root });
  const vendorId = new mongoose.Types.ObjectId().toString();
  const key = `vendors/${vendorId}/01234567-89ab-cdef-0123-456789abcdef.png`;
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  await assert.rejects(storage.storeLocal({ key: `vendors/${vendorId}/../../escape.png`, contentType: 'image/png', bytes: pngHeader }), { code: 'invalid_upload_key' });
  await assert.rejects(storage.storeLocal({ key, contentType: 'image/png', bytes: Buffer.from('not an image') }), { code: 'invalid_image_content' });
  await storage.storeLocal({ key, contentType: 'image/png', bytes: pngHeader });
  assert.equal((await storage.confirm({ key, vendorId })).contentType, 'image/png');
  await assert.rejects(storage.confirm({ key, vendorId: new mongoose.Types.ObjectId().toString() }), { code: 'upload_not_owned' });
});
