/**
 * Stellar Network Integration Service
 * Handles Stellar blockchain operations for payments and smart contracts
 * Supports both testnet and mainnet networks with automatic switching
 */

const StellarSdk = require('stellar-sdk');
const axios = require('axios');

class StellarService {
  constructor() {
    this.currentNetwork = process.env.STELLAR_NETWORK || 'testnet';
    this.server = null;
    this.horizonUrl = null;
    this.networkPassphrase = null;
    
    this.networks = {
      testnet: {
        horizonUrl: 'https://horizon-testnet.stellar.org',
        networkPassphrase: 'Test SDF Network ; September 2015',
        friendbotUrl: 'https://friendbot.stellar.org'
      },
      mainnet: {
        horizonUrl: 'https://horizon.stellar.org',
        networkPassphrase: 'Public Global Stellar Network ; September 2015',
        friendbotUrl: null
      }
    };
    
    this.initializeNetwork();
  }

  /**
   * Initialize Stellar server based on current network
   */
  initializeNetwork(network = this.currentNetwork) {
    try {
      const networkConfig = this.networks[network];
      if (!networkConfig) {
        throw new Error(`Unknown network: ${network}`);
      }

      this.horizonUrl = networkConfig.horizonUrl;
      this.networkPassphrase = networkConfig.networkPassphrase;
      
      // Set network passphrase globally
      StellarSdk.Network.use(new StellarSdk.Network(this.networkPassphrase));
      
      // Create server instance
      this.server = new StellarSdk.Server(this.horizonUrl, {
        allowHttp: process.env.NODE_ENV === 'development'
      });

      this.currentNetwork = network;
      console.log(`Stellar service initialized on ${network}`);
      
      return { success: true, network };
    } catch (error) {
      console.error('Failed to initialize Stellar network:', error);
      throw error;
    }
  }

  /**
   * Switch between testnet and mainnet
   */
  switchNetwork(targetNetwork) {
    if (!this.networks[targetNetwork]) {
      throw new Error(`Invalid network: ${targetNetwork}. Available: testnet, mainnet`);
    }

    const previousNetwork = this.currentNetwork;
    this.initializeNetwork(targetNetwork);

    return {
      success: true,
      previousNetwork,
      currentNetwork: targetNetwork,
      message: `Switched from ${previousNetwork} to ${targetNetwork}`
    };
  }

  /**
   * Generate a new Stellar keypair
   */
  generateKeypair() {
    const keypair = StellarSdk.Keypair.random();
    return {
      publicKey: keypair.publicKey(),
      secretKey: keypair.secret(),
      canSign: true
    };
  }

  /**
   * Get account details from Stellar network
   */
  async getAccount(publicKey) {
    try {
      const account = await this.server.loadAccount(publicKey);
      return {
        success: true,
        account: {
          id: account.id,
          balances: account.balances,
          sequence: account.sequence,
          subentryCount: account.subentry_count,
          thresholds: account.thresholds,
          flags: account.flags,
          signers: account.signers
        }
      };
    } catch (error) {
      if (error.response && error.response.status === 404) {
        return {
          success: false,
          error: 'Account not found',
          isUnfunded: true
        };
      }
      throw error;
    }
  }

  /**
   * Fund account on testnet using Friendbot
   */
  async fundAccount(publicKey) {
    if (this.currentNetwork !== 'testnet') {
      throw new Error('Friendbot funding only available on testnet');
    }

    try {
      const friendbotUrl = `${this.networks.testnet.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`;
      const response = await axios.get(friendbotUrl);
      
      return {
        success: true,
        message: 'Account funded with 10,000 XLM',
        transactionHash: response.data.hash
      };
    } catch (error) {
      throw new Error(`Failed to fund account: ${error.message}`);
    }
  }

  /**
   * Create and submit a payment transaction
   */
  async createPayment(sourceSecret, destinationPublicKey, amount, assetType = 'XLM', memo = '') {
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourcePublicKey = sourceKeypair.publicKey();

      // Load source account
      const sourceAccount = await this.server.loadAccount(sourcePublicKey);

      // Build transaction
      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: await this.getBaseFee(),
        timebounds: await this.server.fetchTimebounds(100)
      })
        .addOperation(StellarSdk.Operation.payment({
          destination: destinationPublicKey,
          asset: assetType === 'XLM' ? StellarSdk.Asset.native() : new StellarSdk.Asset(assetType),
          amount: amount.toString()
        }))
        .addMemo(memo ? StellarSdk.Memo.text(memo) : StellarSdk.Memo.none())
        .build();

      // Sign and submit
      transaction.sign(sourceKeypair);
      const result = await this.server.submitTransaction(transaction);

      return {
        success: true,
        transactionHash: result.hash,
        ledger: result.ledger,
        createdAt: result.created_at,
        network: this.currentNetwork
      };
    } catch (error) {
      throw new Error(`Payment failed: ${error.message}`);
    }
  }

  /**
   * Create multiple payments in batch
   */
  async createBatchPayments(sourceSecret, payments) {
    try {
      const sourceKeypair = StellarSdk.Keypair.fromSecret(sourceSecret);
      const sourcePublicKey = sourceKeypair.publicKey();

      // Load source account
      const sourceAccount = await this.server.loadAccount(sourcePublicKey);

      // Build transaction with multiple payment operations
      let transactionBuilder = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: await this.getBaseFee(),
        timebounds: await this.server.fetchTimebounds(100)
      });

      // Add all payment operations
      payments.forEach(payment => {
        transactionBuilder = transactionBuilder.addOperation(
          StellarSdk.Operation.payment({
            destination: payment.destination,
            asset: payment.assetType === 'XLM' ? StellarSdk.Asset.native() : new StellarSdk.Asset(payment.assetType),
            amount: payment.amount.toString()
          })
        );
        
        if (payment.memo) {
          transactionBuilder = transactionBuilder.addMemo(StellarSdk.Memo.text(payment.memo));
        }
      });

      const transaction = transactionBuilder.build();
      transaction.sign(sourceKeypair);
      const result = await this.server.submitTransaction(transaction);

      return {
        success: true,
        transactionHash: result.hash,
        paymentCount: payments.length,
        network: this.currentNetwork
      };
    } catch (error) {
      throw new Error(`Batch payment failed: ${error.message}`);
    }
  }

  /**
   * Check payment path for optimal routing
   */
  async getPaymentPaths(sourceAsset, destinationAsset, destinationAmount) {
    try {
      const paths = await this.server.paths(
        sourceAsset,
        destinationAsset,
        destinationAmount.toString()
      ).call();

      return {
        success: true,
        paths: paths.records || []
      };
    } catch (error) {
      throw new Error(`Failed to get payment paths: ${error.message}`);
    }
  }

  /**
   * Get current base fee from network
   */
  async getBaseFee() {
    try {
      const feeStats = await this.server.feeStats();
      return Math.ceil(parseFloat(feeStats.last_ledger_base_fee)).toString();
    } catch (error) {
      // Default fee if unable to fetch
      return '100';
    }
  }

  /**
   * Monitor transactions for a specific account
   */
  monitorTransactions(accountId, callback) {
    const cursor = 'now';
    
    this.server.transactions()
      .forAccount(accountId)
      .cursor(cursor)
      .stream({
        onmessage: (transaction) => {
          callback(null, transaction);
        },
        onerror: (error) => {
          callback(error);
        }
      });
  }

  /**
   * Get transaction history for an account
   */
  async getTransactionHistory(accountId, limit = 10) {
    try {
      const transactions = await this.server.transactions()
        .forAccount(accountId)
        .limit(limit)
        .order('desc')
        .call();

      return {
        success: true,
        transactions: transactions.records.map(tx => ({
          hash: tx.hash,
          createdAt: tx.created_at,
          fee: tx.fee_charged,
          operationCount: tx.operation_count,
          memo: tx.memo,
          successful: tx.successful
        }))
      };
    } catch (error) {
      throw new Error(`Failed to get transaction history: ${error.message}`);
    }
  }

  /**
   * Verify transaction by hash
   */
  async verifyTransaction(transactionHash) {
    try {
      const transaction = await this.server.transactions(transactionHash).call();
      return {
        success: true,
        verified: true,
        transaction: {
          hash: transaction.hash,
          createdAt: transaction.created_at,
          fee: transaction.fee_charged,
          operationCount: transaction.operation_count,
          successful: transaction.successful,
          ledger: transaction.ledger_attr
        }
      };
    } catch (error) {
      return {
        success: false,
        verified: false,
        error: 'Transaction not found'
      };
    }
  }

  /**
   * Get current XLM price in USD (mock implementation)
   */
  async getXLMPrice() {
    try {
      // In production, use CoinGecko or similar API
      const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd');
      return {
        success: true,
        price: response.data.stellar.usd,
        currency: 'USD',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      // Fallback price
      return {
        success: true,
        price: 0.12,
        currency: 'USD',
        timestamp: new Date().toISOString(),
        isEstimate: true
      };
    }
  }

  /**
   * Convert XLM to fiat amount
   */
  async convertXLMTToFiat(xlmAmount, fiatCurrency = 'USD') {
    const priceData = await this.getXLMPrice();
    const fiatAmount = xlmAmount * priceData.price;
    
    return {
      xlmAmount,
      fiatAmount,
      currency: fiatCurrency,
      exchangeRate: priceData.price,
      timestamp: priceData.timestamp
    };
  }

  /**
   * Convert fiat to XLM amount
   */
  async convertFiatToXLM(fiatAmount, fiatCurrency = 'USD') {
    const priceData = await getXLMPrice();
    const xlmAmount = fiatAmount / priceData.price;
    
    return {
      fiatAmount,
      xlmAmount,
      currency: fiatCurrency,
      exchangeRate: priceData.price,
      timestamp: priceData.timestamp
    };
  }

  /**
   * Health check for Stellar network connectivity
   */
  async healthCheck() {
    try {
      const ledger = await this.server.ledgers().order('desc').limit(1).call();
      const latestLedger = ledger.records[0];
      
      return {
        status: 'healthy',
        network: this.currentNetwork,
        horizonUrl: this.horizonUrl,
        latestLedger: latestLedger.sequence,
        ledgerClosedAt: latestLedger.closed_at,
        responseTime: Date.now(),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        network: this.currentNetwork,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get network statistics
   */
  async getNetworkStats() {
    try {
      const ledgers = await this.server.ledgers().order('desc').limit(10).call();
      const baseFee = await this.getBaseFee();
      
      return {
        network: this.currentNetwork,
        latestLedger: ledgers.records[0].sequence,
        averageLedgerCloseTime: this.calculateAverageCloseTime(ledgers.records),
        baseFee,
        protocolVersion: ledgers.records[0].protocol_version,
        totalTransactions: ledgers.records.reduce((sum, ledger) => sum + ledger.transaction_count, 0)
      };
    } catch (error) {
      throw new Error(`Failed to get network stats: ${error.message}`);
    }
  }

  /**
   * Calculate average ledger close time
   */
  calculateAverageCloseTime(ledgers) {
    if (ledgers.length < 2) return 0;
    
    let totalTimeDiff = 0;
    for (let i = 1; i < ledgers.length; i++) {
      const prev = new Date(ledgers[i - 1].closed_at);
      const curr = new Date(ledgers[i].closed_at);
      totalTimeDiff += (prev - curr) / 1000; // Convert to seconds
    }
    
    return totalTimeDiff / (ledgers.length - 1);
  }
}

module.exports = StellarService;
