const express = require('express');
const EnhancedPaymentService = require('../services/enhancedPaymentService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const paymentService = new EnhancedPaymentService();

// ============================================
// FIAT ONBOARDING (DEPOSIT) ROUTES
// ============================================

// Create Stripe Connect account for providers
router.post('/stripe/connect-account', authenticateToken, async (req, res) => {
  try {
    const providerData = {
      email: req.body.email,
      businessName: req.body.businessName,
      website: req.body.website,
      providerId: req.user.userId,
      specialty: req.body.specialty,
      baseUrl: process.env.FRONTEND_URL || 'http://localhost:3000'
    };

    const result = await paymentService.createProviderAccount(providerData);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initiate Stripe onboarding (deposit)
router.post('/stripe/onboard', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'USD', metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await paymentService.processStripeOnboarding(
      req.user.userId,
      amount,
      currency,
      metadata
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initiate PayPal onboarding (deposit)
router.post('/paypal/onboard', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'USD', description, metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await paymentService.processPayPalOnboarding(
      req.user.userId,
      amount,
      currency,
      { description, ...metadata }
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initiate bank transfer onboarding (ACH/Wire)
router.post('/bank-transfer/onboard', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'USD', metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const result = await paymentService.processBankTransferOnboarding(
      req.user.userId,
      amount,
      currency,
      metadata
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generic onboarding endpoint (auto-detects payment method)
router.post('/onboard', authenticateToken, async (req, res) => {
  try {
    const { amount, paymentMethod, currency = 'USD', metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method is required' });
    }

    const result = await paymentService.processOnboarding({
      userId: req.user.userId,
      amount,
      currency,
      paymentMethod,
      metadata
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// FIAT OFFBOARDING (WITHDRAWAL) ROUTES
// ============================================

// Initiate Stripe offboarding (payout)
router.post('/stripe/offboard', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'USD', destinationAccountId, metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    if (!destinationAccountId) {
      return res.status(400).json({ error: 'Destination account ID is required' });
    }

    const result = await paymentService.processStripeOffboarding(
      req.user.userId,
      amount,
      currency,
      destinationAccountId,
      metadata
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initiate PayPal offboarding (payout)
router.post('/paypal/offboard', authenticateToken, async (req, res) => {
  try {
    const { amount, currency = 'USD', recipientEmail, metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    if (!recipientEmail) {
      return res.status(400).json({ error: 'Recipient email is required' });
    }

    const result = await paymentService.processPayPalOffboarding(
      req.user.userId,
      amount,
      currency,
      recipientEmail,
      metadata
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Initiate bank transfer offboarding (withdrawal to bank)
router.post('/bank-transfer/offboard', authenticateToken, async (req, res) => {
  try {
    const { 
      amount, 
      currency = 'USD', 
      bankAccount,
      metadata = {} 
    } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    if (!bankAccount || !bankAccount.accountNumber || !bankAccount.routingNumber) {
      return res.status(400).json({ error: 'Bank account details are required' });
    }

    const result = await paymentService.processBankTransferOffboarding(
      req.user.userId,
      amount,
      currency,
      bankAccount,
      metadata
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add external bank account
router.post('/bank-account/add', authenticateToken, async (req, res) => {
  try {
    const bankAccountData = {
      country: req.body.country || 'US',
      currency: req.body.currency || 'usd',
      routingNumber: req.body.routingNumber,
      accountNumber: req.body.accountNumber,
      accountHolderName: req.body.accountHolderName,
      accountHolderType: req.body.accountHolderType || 'individual'
    };

    const result = await paymentService.addExternalBankAccount(
      req.user.userId,
      bankAccountData
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generic offboarding endpoint (auto-detects payment method)
router.post('/offboard', authenticateToken, async (req, res) => {
  try {
    const { amount, paymentMethod, destination, currency = 'USD', metadata = {} } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    
    if (!paymentMethod) {
      return res.status(400).json({ error: 'Payment method is required' });
    }
    
    if (!destination) {
      return res.status(400).json({ error: 'Destination is required' });
    }

    const result = await paymentService.processOffboarding({
      userId: req.user.userId,
      amount,
      currency,
      paymentMethod,
      destination,
      metadata
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PAYMENT UTILITY ROUTES
// ============================================

// Get exchange rates
router.get('/exchange-rates', async (req, res) => {
  try {
    const { baseCurrency = 'USD' } = req.query;
    const result = await paymentService.getExchangeRates(baseCurrency);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Calculate fees for a transaction
router.get('/calculate-fees', async (req, res) => {
  try {
    const { amount, currency = 'USD', paymentMethod, transactionType = 'onboarding' } = req.query;
    
    if (!amount || !paymentMethod) {
      return res.status(400).json({ error: 'Amount and payment method are required' });
    }

    const result = paymentService.calculateFees(
      parseFloat(amount),
      currency,
      paymentMethod,
      transactionType
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get minimum withdrawal amount
router.get('/minimum-withdrawal', (req, res) => {
  try {
    const { currency = 'USD' } = req.query;
    const minAmount = paymentService.getMinimumWithdrawal(currency);
    
    res.json({
      success: true,
      currency,
      minimumAmount: minAmount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available payment methods by country
router.get('/available-methods', (req, res) => {
  try {
    const { countryCode } = req.query;
    const methods = paymentService.getAvailablePaymentMethods(countryCode || 'US');
    
    res.json({
      success: true,
      countryCode: countryCode || 'US',
      availableMethods: methods
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify payment status
router.get('/verify/:paymentId', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { paymentMethod = 'stripe' } = req.query;
    
    const result = await paymentService.verifyPayment(paymentId, paymentMethod);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Process refund
router.post('/refund/:paymentId', authenticateToken, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { paymentMethod = 'stripe', amount, reason } = req.body;
    
    const result = await paymentService.refundPayment(
      paymentId,
      paymentMethod,
      amount ? parseFloat(amount) : null
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check for payment services
router.get('/health', async (req, res) => {
  try {
    const health = await paymentService.healthCheck();
    const statusCode = health.health.overall === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

module.exports = router;
