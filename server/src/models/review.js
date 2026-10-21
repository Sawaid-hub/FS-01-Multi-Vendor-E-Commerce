const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  body: { type: String, required: true, trim: true, minlength: 8, maxlength: 1000 },
  status: { type: String, enum: ['published', 'hidden'], default: 'published' }
}, { timestamps: true, versionKey: false });
reviewSchema.index({ customerId: 1, productId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
