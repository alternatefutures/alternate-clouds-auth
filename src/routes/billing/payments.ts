/**
 * Payments Routes
 * Process card and crypto payments
 */

import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { authMiddleware, requireAuthUser } from '../../middleware/auth';
import { dbService } from '../../services/db.service';
import { getProvider, getCryptoProvider, isProviderAvailable } from '../../services/payments';

const app = new Hono();

app.use('*', authMiddleware);

const processPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  paymentMethodId: z.string().min(1).optional(),
  amount: z.number().int().min(1).optional(), // Optional partial payment
});

const createCryptoPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  chainId: z.number().int().min(1).optional().default(1), // Default to Ethereum mainnet
  tokenSymbol: z.string().optional().default('usdc'),
});

const recordCryptoPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  txHash: z.string().min(1),
  blockchain: z.string().min(1),
  fromAddress: z.string().min(1),
  amount: z.number().int().min(1),
});

/**
 * POST /billing/payments
 * Process a card payment
 */
app.post('/', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = processPaymentSchema.parse(body);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const invoice = await dbService.getInvoiceById(data.invoiceId);
    if (!invoice || invoice.customer_id !== customer.id) {
      return c.json({ error: 'Invoice not found' }, 404);
    }

    if (invoice.status === 'PAID') {
      return c.json({ error: 'Invoice already paid' }, 400);
    }

    // Get payment method
    let paymentMethod;
    if (data.paymentMethodId) {
      paymentMethod = await dbService.getPaymentMethodById(data.paymentMethodId);
      if (!paymentMethod || paymentMethod.customer_id !== customer.id) {
        return c.json({ error: 'Payment method not found' }, 404);
      }
    } else {
      // Get default payment method
      const methods = await dbService.listPaymentMethodsByCustomerId(customer.id);
      paymentMethod = methods.find((m) => m.is_default === 1) || methods[0];
      if (!paymentMethod) {
        return c.json({ error: 'No payment method available' }, 400);
      }
    }

    if (paymentMethod.type !== 'CARD') {
      return c.json({ error: 'Payment method is not a card. Use /payments/crypto for crypto payments.' }, 400);
    }

    const amount = data.amount || invoice.amount_due;
    if (amount > invoice.amount_due) {
      return c.json({ error: 'Payment amount exceeds amount due' }, 400);
    }

    // Get provider
    const provider = getProvider(paymentMethod.provider);
    const customerId = paymentMethod.provider === 'stripe' ? customer.stripe_customer_id : customer.stax_customer_id;
    const paymentMethodId = paymentMethod.stripe_payment_method_id || paymentMethod.stax_payment_method_id;

    if (!customerId || !paymentMethodId) {
      return c.json({ error: 'Payment provider not configured for this customer' }, 400);
    }

    // Create payment intent
    const paymentIntent = await provider.createPaymentIntent({
      amount,
      currency: invoice.currency,
      customerId,
      paymentMethodId,
      metadata: {
        invoiceId: invoice.id,
        userId: user.userId,
      },
    });

    // Confirm the payment
    const confirmedIntent = await provider.confirmPaymentIntent(paymentIntent.id);

    // Record payment in database
    const payment = await dbService.createPayment({
      id: nanoid(),
      customer_id: customer.id,
      invoice_id: invoice.id,
      payment_method_id: paymentMethod.id,
      amount,
      currency: invoice.currency,
      status: confirmedIntent.status === 'succeeded' ? 'SUCCEEDED' : 'PENDING',
      provider: paymentMethod.provider,
      stripe_payment_intent_id: paymentMethod.provider === 'stripe' ? confirmedIntent.id : undefined,
      stax_transaction_id: paymentMethod.provider === 'stax' ? confirmedIntent.id : undefined,
    });

    // Update invoice if payment succeeded
    if (confirmedIntent.status === 'succeeded') {
      const newAmountPaid = invoice.amount_paid + amount;
      const newAmountDue = invoice.total - newAmountPaid;

      await dbService.updateInvoice(invoice.id, {
        amount_paid: newAmountPaid,
        amount_due: newAmountDue,
        status: newAmountDue <= 0 ? 'PAID' : 'OPEN',
        paid_at: newAmountDue <= 0 ? Date.now() : undefined,
      });
    }

    return c.json({
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        currency: payment.currency,
        invoiceId: payment.invoice_id,
        createdAt: payment.created_at,
      },
      clientSecret: paymentIntent.clientSecret,
    });
  } catch (error) {
    console.error('Process payment error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to process payment' }, 500);
  }
});

/**
 * POST /billing/payments/crypto/create
 * Create a crypto payment request
 */
app.post('/crypto/create', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = createCryptoPaymentSchema.parse(body);

    if (!isProviderAvailable('relay')) {
      return c.json({ error: 'Crypto payments not configured' }, 400);
    }

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const invoice = await dbService.getInvoiceById(data.invoiceId);
    if (!invoice || invoice.customer_id !== customer.id) {
      return c.json({ error: 'Invoice not found' }, 404);
    }

    if (invoice.status === 'PAID') {
      return c.json({ error: 'Invoice already paid' }, 400);
    }

    // Create crypto payment request
    const cryptoProvider = getCryptoProvider();
    const paymentIntent = await cryptoProvider.createPaymentIntent({
      amount: invoice.amount_due,
      currency: invoice.currency,
      customerId: customer.id,
      chainId: data.chainId,
      tokenSymbol: data.tokenSymbol,
      metadata: {
        invoiceId: invoice.id,
        userId: user.userId,
      },
    });

    // Record pending payment
    const payment = await dbService.createPayment({
      id: nanoid(),
      customer_id: customer.id,
      invoice_id: invoice.id,
      amount: invoice.amount_due,
      currency: invoice.currency,
      status: 'PENDING',
      provider: 'relay',
      blockchain: data.chainId.toString(),
      to_address: paymentIntent.depositAddress,
    });

    return c.json({
      payment: {
        id: payment.id,
        status: 'PENDING',
        amount: invoice.amount_due,
        currency: invoice.currency,
        depositAddress: paymentIntent.depositAddress,
        chainId: paymentIntent.chainId,
        tokenAddress: paymentIntent.tokenAddress,
        tokenSymbol: data.tokenSymbol,
        expiresAt: paymentIntent.expiresAt,
      },
    });
  } catch (error) {
    console.error('Create crypto payment error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to create crypto payment' }, 500);
  }
});

/**
 * POST /billing/payments/crypto/record
 * Record a crypto payment claim from the client.
 * Payment is created as PENDING_VERIFICATION — invoice is NOT updated.
 * Settlement happens only via provider webhook or server-side on-chain verification.
 */
app.post('/crypto/record', async (c) => {
  try {
    const user = requireAuthUser(c);
    const body = await c.req.json();
    const data = recordCryptoPaymentSchema.parse(body);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ error: 'Customer not found' }, 404);
    }

    const invoice = await dbService.getInvoiceById(data.invoiceId);
    if (!invoice || invoice.customer_id !== customer.id) {
      return c.json({ error: 'Invoice not found' }, 404);
    }

    if (invoice.status === 'PAID') {
      return c.json({ error: 'Invoice already paid' }, 400);
    }

    // Check if tx hash already recorded
    const existingPayment = await dbService.getPaymentByTxHash(data.txHash);
    if (existingPayment) {
      return c.json({ error: 'Transaction already recorded', paymentId: existingPayment.id }, 400);
    }

    // Record payment as PENDING — do NOT mark as SUCCEEDED or update invoice.
    // Only server-side verification (webhook or on-chain check) should settle.
    const payment = await dbService.createPayment({
      id: nanoid(),
      customer_id: customer.id,
      invoice_id: invoice.id,
      amount: data.amount,
      currency: invoice.currency,
      status: 'PENDING',
      provider: 'relay',
      tx_hash: data.txHash,
      blockchain: data.blockchain,
      from_address: data.fromAddress,
    });

    return c.json({
      payment: {
        id: payment.id,
        status: payment.status,
        amount: payment.amount,
        txHash: payment.tx_hash,
        blockchain: payment.blockchain,
        invoiceId: payment.invoice_id,
        createdAt: payment.created_at,
      },
      message: 'Payment recorded. It will be settled after on-chain verification.',
    });
  } catch (error) {
    console.error('Record crypto payment error:', error);

    if (error instanceof z.ZodError) {
      return c.json({ error: 'Invalid request data', details: error.issues }, 400);
    }

    return c.json({ error: 'Failed to record crypto payment' }, 500);
  }
});

/**
 * GET /billing/payments
 * List payments for authenticated user
 */
app.get('/', async (c) => {
  try {
    const user = requireAuthUser(c);
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const customer = await dbService.getBillingCustomerByUserId(user.userId);
    if (!customer) {
      return c.json({ payments: [] });
    }

    const payments = await dbService.listPaymentsByCustomerId(customer.id);

    return c.json({
      payments: payments.slice(0, limit).map((p) => ({
        id: p.id,
        invoiceId: p.invoice_id,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        provider: p.provider,
        txHash: p.tx_hash,
        blockchain: p.blockchain,
        createdAt: p.created_at,
      })),
    });
  } catch (error) {
    console.error('List payments error:', error);
    return c.json({ error: 'Failed to list payments' }, 500);
  }
});

export default app;
