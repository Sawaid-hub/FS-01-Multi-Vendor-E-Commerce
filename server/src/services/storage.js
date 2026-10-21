const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const { S3Client, PutObjectCommand, HeadObjectCommand, HeadBucketCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { ApiError } = require('../utils/api-error');

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function createStorage(config) {
  const s3 = config.s3Bucket ? new S3Client({ region: config.s3Region, endpoint: config.s3Endpoint || undefined, forcePathStyle: Boolean(config.s3Endpoint), credentials: config.s3AccessKeyId ? { accessKeyId: config.s3AccessKeyId, secretAccessKey: config.s3SecretAccessKey } : undefined }) : null;
  async function createUpload({ vendorId, contentType, size }) {
    if (!allowedTypes.has(contentType) || !Number.isInteger(size) || size < 1 || size > 5 * 1024 * 1024) throw new ApiError(400, 'invalid_upload');
    const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
    const key = `vendors/${vendorId}/${crypto.randomUUID()}.${extension}`;
    if (s3) {
      const command = new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, ContentType: contentType, ContentLength: size, Metadata: { 'vendor-id': String(vendorId) } });
      return { key, uploadUrl: await getSignedUrl(s3, command, { expiresIn: 300 }), method: 'PUT', expiresIn: 300, storage: 's3-compatible' };
    }
    return { key, uploadUrl: null, method: 'POST', expiresIn: 300, storage: 'local', uploadEndpoint: '/api/v1/vendor/uploads/local' };
  }
  async function storeLocal({ key, contentType, bytes }) {
    if (s3) throw new ApiError(404, 'not_found');
    const match = /^vendors\/([a-f\d]{24})\/([a-f0-9-]+)\.(jpg|png|webp)$/i.exec(key);
    if (!match) throw new ApiError(400, 'invalid_upload_key');
    const signature = contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : contentType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : contentType === 'image/webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' : false;
    const expectedExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
    if (!signature || !allowedTypes.has(contentType) || !key.endsWith(`.${expectedExtension}`) || bytes.length > 5 * 1024 * 1024) throw new ApiError(400, 'invalid_image_content');
    const destination = path.resolve(config.uploadsDir, key);
    if (!destination.startsWith(path.resolve(config.uploadsDir) + path.sep)) throw new ApiError(400, 'invalid_upload_key');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { flag: 'wx' });
    return { key, contentType, size: bytes.length };
  }
  async function confirm({ key, vendorId }) {
    const ownedKey = /^vendors\/([a-f\d]{24})\/([a-f0-9-]+)\.(jpg|png|webp)$/i.exec(key);
    if (!ownedKey || ownedKey[1].toLowerCase() !== String(vendorId).toLowerCase()) throw new ApiError(403, 'upload_not_owned');
    if (s3) {
      let object;
      try { object = await s3.send(new HeadObjectCommand({ Bucket: config.s3Bucket, Key: key })); } catch { throw new ApiError(404, 'uploaded_object_not_found'); }
      if (!allowedTypes.has(object.ContentType) || object.ContentLength < 1 || object.ContentLength > 5 * 1024 * 1024) throw new ApiError(400, 'invalid_uploaded_object');
      let signature;
      try { const firstBytes = await s3.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key, Range: 'bytes=0-11' })); signature = Buffer.from(await firstBytes.Body.transformToByteArray()); }
      catch { throw new ApiError(400, 'invalid_uploaded_object'); }
      const validSignature = object.ContentType === 'image/png' ? signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : object.ContentType === 'image/jpeg' ? signature[0] === 0xff && signature[1] === 0xd8 : signature.toString('ascii', 0, 4) === 'RIFF' && signature.toString('ascii', 8, 12) === 'WEBP';
      const expectedExtension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[object.ContentType];
      if (!validSignature || !key.endsWith(`.${expectedExtension}`)) throw new ApiError(400, 'invalid_uploaded_object');
      return { key, contentType: object.ContentType, size: object.ContentLength };
    }
    const file = path.resolve(config.uploadsDir, key);
    try {
      const bytes = await fs.readFile(file);
      const contentType = key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
      const validSignature = contentType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : contentType === 'image/jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!validSignature || bytes.length > 5 * 1024 * 1024) throw new ApiError(400, 'invalid_image_content');
      return { key, contentType, size: bytes.length };
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(404, 'uploaded_object_not_found'); }
  }
  async function read(key) {
    if (s3) return s3.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
    const file = path.resolve(config.uploadsDir, key);
    if (!file.startsWith(path.resolve(config.uploadsDir) + path.sep)) throw new ApiError(404, 'not_found');
    return fs.readFile(file);
  }
  async function healthCheck() {
    if (!s3) return true;
    await s3.send(new HeadBucketCommand({ Bucket: config.s3Bucket }));
    return true;
  }
  return { createUpload, storeLocal, confirm, read, healthCheck, isConfigured: Boolean(s3), localMode: !s3 };
}

module.exports = { createStorage, allowedTypes };
