'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var orders = require('../lib/orders');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

function makeSavedOrder(coupon) {
  // Mirrors the order-line fields written by routes/orders.js.
  var items = [{
    id: 1,
    sku: 'GRN-001',
    name: 'Rice 5kg',
    hsn: '1006',
    price: 500,
    qty: 1
  }];
  var totals = pricing.computeTotals(items, coupon || '');
  var db = { nextOrderId: 1401, orders: [] };
  var order = orders.add(db, {
    date: '22/11/2026',
    customer: 'Walk-in',
    paymentMode: 'cash',
    status: 'completed',
    items: items,
    coupon: coupon || '',
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  });

  return { db: db, order: order, pricing: totals };
}

test('order pricing applies the HSN slab to saved line items', function () {
  var result = makeSavedOrder('');

  assert.equal(result.order.items[0].hsn, '1006');
  assert.equal(Object.hasOwn(result.order.items[0], 'gstRate'), false);
  assert.equal(result.pricing.lines[0].gstPercent, 5);
  assert.equal(result.order.subtotal, 500);
  assert.equal(result.order.tax, 25);
  assert.equal(result.pricing.cgst, 12.5);
  assert.equal(result.pricing.sgst, 12.5);
  assert.equal(result.order.total, 525);
});

test('invoice figures match the GST breakdown and total billed by order pricing', function () {
  var result = makeSavedOrder('SAVE10');
  var figures = invoice.computeInvoiceFigures(result.order);

  assert.equal(figures.subtotal, result.order.subtotal);
  assert.equal(figures.discount, result.order.discount);
  assert.equal(figures.rows[0].gstPercent, result.pricing.lines[0].gstPercent);
  assert.equal(figures.rows[0].lineTax, result.pricing.lines[0].tax);
  assert.equal(figures.tax, result.order.tax);
  assert.equal(figures.cgst, result.pricing.cgst);
  assert.equal(figures.sgst, result.pricing.sgst);
  assert.equal(figures.total, result.order.total);
});

test('invoice uses the same HSN GST as the billed order', function () {
  var result = makeSavedOrder('');
  var figures = invoice.computeInvoiceFigures(result.order);

  assert.equal(figures.rows[0].hsn, '1006');
  assert.equal(figures.rows[0].gstPercent, 5);
  assert.equal(figures.rows[0].lineTax, 25);
  assert.equal(figures.tax, 25);
  assert.equal(figures.cgst, 12.5);
  assert.equal(figures.sgst, 12.5);
  assert.equal(figures.total, 525);
  assert.equal(figures.total, result.order.total);
});

test('invoice applies SAVE10 and GST exactly as billed', function () {
  var result = makeSavedOrder('SAVE10');
  var figures = invoice.computeInvoiceFigures(result.order);

  assert.equal(result.order.discount, 50);
  assert.equal(result.order.tax, 22.5);
  assert.equal(result.order.total, 472.5);
  assert.equal(figures.discount, 50);
  assert.equal(figures.tax, 22.5);
  assert.equal(figures.total, 472.5);
});

test('GST reconciliation matches the invoice to the billed order', function () {
  var result = makeSavedOrder('');
  var reconciliation = reports.getGstReconciliation(result.db);

  assert.equal(reconciliation.totalChecked, 1);
  assert.equal(reconciliation.mismatchCount, 0);
  assert.equal(reconciliation.totalDelta, 0);
  assert.equal(reconciliation.rows[0].delta, 0);
  assert.equal(reconciliation.rows[0].ledgerTax, 25);
  assert.equal(reconciliation.rows[0].invoiceTax, 25);
  assert.equal(reconciliation.rows[0].matched, true);
});

test('rendered invoice shows the billed GST split and total without a mismatch notice', function () {
  var result = makeSavedOrder('SAVE10');
  var html = invoice.render(result.order);

  assert.match(html, /<td class="r">5%<\/td>/);
  assert.match(html, /GST Amt<\/th>[\s\S]*?₹22\.50/);
  assert.match(html, /<td>CGST<\/td><td class="r">₹11\.25/);
  assert.match(html, /<td>SGST<\/td><td class="r">₹11\.25/);
  assert.match(html, /Coupon Discount \(SAVE10\)[\s\S]*?-₹50\.00/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹472\.50/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
});
