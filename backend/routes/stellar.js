const express = require('express');
const StellarService = require('../services/stellarService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const stellarService = new StellarService();

// Get current network status
router.get('/network', authenticateToken, async (req, res) => {
  try {
    const network = stellarService.currentNetwork;
    const health = await stellarService.healthCheck();
    
    res.json({
      success: true,
      network,
      health
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Switch network (testnet/mainnet)
router.post('/network/switch', authenticateToken, async (req, res) => {
  try {
    const { network } = req.body;
    
    if (!['testnet', 'mainnet'].includes(network)) {
      return res.status(400).json({ error: 'Invalid network. Must be testnet or mainnet' });
    }
    
    const result = stellarService.switchNetwork(network);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Generate new Stellar keypair
router.post('/keypair/generate', authenticateToken, (req, res) => {
  try {
    const keypair = stellarService.generateKeypair();
    res.json({
      success: true,
      keypair
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get account details
router.get('/account/:publicKey', authenticateToken, async (req, res) => {
  try {
    const { publicKey } = req.params;
    const account = await stellarService.getAccount(publicKey);
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fund account on testnet
router.post('/account/fund', authenticateToken, async (req, res) => {
  try {
    const { publicKey } = req.body;
    
    if (stellarService.currentNetwork !== 'testnet') {
      return res.status(400).json({ error: 'Funding only available on testnet' });
    }
    
    const result = await stellarService.fundAccount(publicKey);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create payment
router.post('/payment', authenticateToken, async (req, res) => {
  try {
    const { sourceSecret, destinationPublicKey, amount, assetType = 'XLM', memo } = req.body;
    
    // Validate required fields
    if (!sourceSecret || !destinationPublicKey || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields: sourceSecret, destinationPublicKey, amount' 
      });
    }
    
    const result = await stellarService.createPayment(
      sourceSecret,
      destinationPublicKey,
      amount,
      assetType,
      memo
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create batch payments
router.post('/payment/batch', authenticateToken, async (req, res) => {
  try {
    const { sourceSecret, payments } = req.body;
    
    if (!sourceSecret || !payments || !Array.isArray(payments)) {
      return res.status(400).json({ error: 'Invalid request parameters' });
    }
    
    const result = await stellarService.createBatchPayments(sourceSecret, payments);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment paths
router.get('/payment/paths', authenticateToken, async (req, res) => {
  try {
    const { sourceAsset, destinationAsset, destinationAmount } = req.query;
    
    if (!sourceAsset || !destinationAsset || !destinationAmount) {
      return res.status(400).json({ error: 'Missing query parameters' });
    }
    
    const result = await stellarService.getPaymentPaths(
      sourceAsset,
      destinationAsset,
      destinationAmount
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get transaction history
router.get('/transactions/:accountId', authenticateToken, async (req, res) => {
  try {
    const { accountId } = req.params;
    const { limit = 10 } = req.query;
    
    const result = await stellarService.getTransactionHistory(accountId, parseInt(limit));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify transaction
router.get('/transaction/verify/:hash', authenticateToken, async (req, res) => {
  try {
    const { hash } = req.params;
    const result = await stellarService.verifyTransaction(hash);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get XLM price
router.get('/price/xlm', async (req, res) => {
  try {
    const result = await stellarService.getXLMPrice();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert XLM to fiat
router.get('/convert/xlm-to-fiat', async (req, res) => {
  try {
    const { amount, currency = 'USD' } = req.query;
    
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }
    
    const result = await stellarService.convertXLMTToFiat(parseFloat(amount), currency);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert fiat to XLM
router.get('/convert/fiat-to-xlm', async (req, res) => {
  try {
    const { amount, currency = 'USD' } = req.query;
    
    if (!amount) {
      return res.status(400).json({ error: 'Amount is required' });
    }
    
    const result = await stellarService.convertFiatToXLM(parseFloat(amount), currency);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get network statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await stellarService.getNetworkStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const health = await stellarService.healthCheck();
    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message });
  }
});

module.exports = router;
