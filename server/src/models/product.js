const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorProfile', required: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  slug: { type: String, required: true, trim: true, lowercase: true },
  productType: { type: String, required: true, trim: true, maxlength: 60 },
  description: { type: String, required: true, trim: true, maxlength: 2000 },
  category: { type: String, required: true, enum: ['Home', 'Accessories', 'Stationery'] },
  priceMinor: { type: Number, required: true, min: 1, max: 100000000 },
  currency: { type: String, required: true, enum: ['USD', 'CAD', 'GBP'] },
  stock: { type: Number, required: true, min: 0, max: 1000000 },
  status: { type: String, enum: ['draft', 'published', 'unpublished', 'archived', 'flagged'], default: 'draft', index: true },
  imageKeys: [{ type: String, maxlength: 300 }],
  ratingAverage: { type: Number, min: 0, max: 5, default: 0 },
  ratingCount: { type: Number, min: 0, default: 0 }
}, { timestamps: true, versionKey: false });

productSchema.index({ name: 'text', productType: 'text', description: 'text' });
productSchema.index({ vendorId: 1, status: 1 });
productSchema.index({ category: 1, status: 1, priceMinor: 1 });
productSchema.index({ slug: 1 }, { unique: true });

module.exports = mongoose.model('Product', productSchema);
