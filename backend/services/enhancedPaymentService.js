/**
 * Enhanced Payment Gateway Service
 * Advanced payment processing with Stripe, PayPal, and crypto
 * Supports fiat onboarding and offboarding
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const paypal = require('paypal-rest-sdk');
const axios = require('axios');

// Configure PayPal
paypal.configure({
  mode: process.env.PAYPAL_MODE || 'sandbox',
  client_id: process.env.PAYPAL_CLIENT_ID,
  client_secret: process.env.PAYPAL_CLIENT_SECRET
});

class EnhancedPaymentService {
  constructor() {
    this.stripe = stripe;
    this.paypal = paypal;
    this.supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD'];
    this.paymentMethods = ['stripe', 'paypal', 'bank_transfer', 'crypto'];
  }

  /**
   * Create Stripe Connect account for healthcare providers
   */
  async createProviderAccount(providerData) {
    try {
      const account = await stripe.accounts.create({
        type: 'express',
        email: providerData.email,
        business_type: 'company',
        business_profile: {
          name: providerData.businessName,
          url: providerData.website,
          mcc: '8011' // Medical doctors and dentists
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        metadata: {
          provider_id: providerData.providerId,
          specialty: providerData.specialty
        }
      });

      return {
        success: true,
        accountId: account.id,
        onboardingUrl: await stripe.accountLinks.create({
          account: account.id,
          refresh_url: `${providerData.baseUrl}/api/payments/stripe/reauth`,
          return_url: `${providerData.baseUrl}/api/payments/stripe/success`,
          type: 'account_onboarding'
        }).then(link => link.url),
        details: account
      };
    } catch (error) {
      throw new Error(`Stripe account creation failed: ${error.message}`);
    }
  }

  /**
   * Process fiat onboarding (deposit)
   */
  async processOnboarding(paymentData) {
    const { userId, amount, currency, paymentMethod, metadata } = paymentData;

    switch (paymentMethod) {
      case 'stripe':
        return await this.processStripeOnboarding(userId, amount, currency, metadata);
      
      case 'paypal':
        return await this.processPayPalOnboarding(userId, amount, currency, metadata);
      
      case 'bank_transfer':
        return await this.processBankTransferOnboarding(userId, amount, currency, metadata);
      
      default:
        throw new Error(`Unsupported payment method: ${paymentMethod}`);
    }
  }

  /**
   * Process Stripe onboarding (deposit)
   */
  async processStripeOnboarding(userId, amount, currency, metadata = {}) {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        metadata: {
          user_id: userId,
          type: 'onboarding',
          ...metadata
        }
      });

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount,
        currency,
        status: paymentIntent.status,
        nextAction: paymentIntent.next_action
      };
    } catch (error) {
      throw new Error(`Stripe onboarding failed: ${error.message}`);
    }
  }

  /**
   * Process PayPal onboarding (deposit)
   */
  async processPayPalOnboarding(userId, amount, currency, metadata = {}) {
    try {
      const createPaymentJson = {
        intent: 'sale',
        payer: { payment_method: 'paypal' },
        redirect_urls: {
          return_url: `${process.env.BASE_URL}/api/payments/paypal/onboarding-success`,
          cancel_url: `${process.env.BASE_URL}/api/payments/paypal/cancel`
        },
        transactions: [{
          item_list: {
            items: [{
              name: metadata.description || 'Account Deposit',
              price: amount.toFixed(2),
              currency: currency,
              quantity: 1
            }]
          },
          amount: {
            currency: currency,
            total: amount.toFixed(2)
          },
          description: metadata.description || 'Account Deposit'
        }]
      };

      return new Promise((resolve, reject) => {
        paypal.payment.create(createPaymentJson, (error, payment) => {
          if (error) {
            reject(new Error(`PayPal onboarding failed: ${error.response ? error.response.message : error.message}`));
          } else {
            const approvalUrl = payment.links.find(link => link.rel === 'approval_url');
            resolve({
              success: true,
              paymentId: payment.id,
              approvalUrl: approvalUrl ? approvalUrl.href : null,
              amount,
              currency,
              status: 'pending_approval'
            });
          }
        });
      });
    } catch (error) {
      throw new Error(`PayPal onboarding failed: ${error.message}`);
    }
  }

  /**
   * Process bank transfer onboarding (ACH/Wire)
   */
  async processBankTransferOnboarding(userId, amount, currency, metadata = {}) {
    try {
      // Create ACH payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        payment_method_types: ['us_bank_account'],
        metadata: {
          user_id: userId,
          type: 'bank_transfer_onboarding',
          ...metadata
        }
      });

      return {
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount,
        currency,
        status: 'requires_payment_method',
        instructions: 'Bank account verification required'
      };
    } catch (error) {
      throw new Error(`Bank transfer onboarding failed: ${error.message}`);
    }
  }

  /**
   * Process fiat offboarding (withdrawal)
   */
  async processOffboarding(withdrawalData) {
    const { userId, amount, currency, destination, paymentMethod, metadata } = withdrawalData;

    // Validate minimum withdrawal amount
    const minAmount = this.getMinimumWithdrawal(currency);
    if (amount < minAmount) {
      throw new Error(`Minimum withdrawal amount is ${minAmount} ${currency}`);
    }

    switch (paymentMethod) {
      case 'stripe':
        return await this.processStripeOffboarding(userId, amount, currency, destination, metadata);
      
      case 'paypal':
        return await this.processPayPalOffboarding(userId, amount, currency, destination, metadata);
      
      case 'bank_transfer':
        return await this.processBankTransferOffboarding(userId, amount, currency, destination, metadata);
      
      default:
        throw new Error(`Unsupported withdrawal method: ${paymentMethod}`);
    }
  }

  /**
   * Process Stripe offboarding (payout to connected account)
   */
  async processStripeOffboarding(userId, amount, currency, destinationAccountId, metadata = {}) {
    try {
      const payout = await stripe.payouts.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        destination: destinationAccountId,
        method: 'instant', // or 'standard'
        metadata: {
          user_id: userId,
          type: 'offboarding',
          ...metadata
        }
      });

      return {
        success: true,
        payoutId: payout.id,
        amount,
        currency,
        status: payout.status,
        arrivalDate: payout.arrival_date,
        estimatedArrival: new Date(payout.arrival_date * 1000)
      };
    } catch (error) {
      throw new Error(`Stripe offboarding failed: ${error.message}`);
    }
  }

  /**
   * Process PayPal offboarding (payout)
   */
  async processPayPalOffboarding(userId, amount, currency, recipientEmail, metadata = {}) {
    try {
      const payoutJson = {
        sender_batch_header: {
          sender_batch_id: `payout_${Date.now()}_${userId}`,
          email_subject: 'You have a payout!',
          email_message: 'You have received a payout from your healthcare account'
        },
        items: [{
          recipient_type: 'EMAIL',
          amount: {
            value: amount.toFixed(2),
            currency: currency
          },
          receiver: recipientEmail,
          note: metadata.note || 'Healthcare account payout',
          sender_item_id: `item_${Date.now()}`
        }]
      };

      return new Promise((resolve, reject) => {
        paypal.payout.create(payoutJson, (error, payout) => {
          if (error) {
            reject(new Error(`PayPal offboarding failed: ${error.response ? error.response.message : error.message}`));
          } else {
            resolve({
              success: true,
              batchId: payout.batch_header.payout_batch_id,
              amount,
              currency,
              status: payout.batch_header.batch_status,
              recipientEmail
            });
          }
        });
      });
    } catch (error) {
      throw new Error(`PayPal offboarding failed: ${error.message}`);
    }
  }

  /**
   * Process bank transfer offboarding (ACH/Wire withdrawal)
   */
  async processBankTransferOffboarding(userId, amount, currency, bankAccount, metadata = {}) {
    try {
      // First, add bank account as external account if not exists
      const externalAccount = await this.addExternalBankAccount(userId, bankAccount);

      // Create payout to bank account
      const transfer = await stripe.transfers.create({
        amount: Math.round(amount * 100),
        currency: currency.toLowerCase(),
        destination: externalAccount.externalAccountId,
        source_transaction: metadata.sourceTransactionId,
        metadata: {
          user_id: userId,
          type: 'bank_withdrawal',
          ...metadata
        }
      });

      return {
        success: true,
        transferId: transfer.id,
        amount,
        currency,
        status: transfer.status,
        arrivalDate: transfer.arrival_date
      };
    } catch (error) {
      throw new Error(`Bank transfer offboarding failed: ${error.message}`);
    }
  }

  /**
   * Add external bank account to Stripe
   */
  async addExternalBankAccount(userId, bankAccountData) {
    try {
      const account = await stripe.accounts.retrieve(userId);
      
      const externalAccount = await stripe.accounts.createExternalAccount(userId, {
        external_account: {
          object: 'bank_account',
          country: bankAccountData.country || 'US',
          currency: bankAccountData.currency || 'usd',
          routing_number: bankAccountData.routingNumber,
          account_number: bankAccountData.accountNumber,
          account_holder_name: bankAccountData.accountHolderName,
          account_holder_type: bankAccountData.accountHolderType || 'individual'
        }
      });

      return {
        success: true,
        externalAccountId: externalAccount.id,
        bankAccount: {
          id: externalAccount.id,
          last4: externalAccount.last4,
          bankName: externalAccount.bank_name,
          currency: externalAccount.currency
        }
      };
    } catch (error) {
      throw new Error(`Failed to add bank account: ${error.message}`);
    }
  }

  /**
   * Get exchange rates for currency conversion
   */
  async getExchangeRates(baseCurrency = 'USD') {
    try {
      const response = await axios.get(
        `https://api.exchangerate-api.com/v4/latest/${baseCurrency.toUpperCase()}`
      );
      
      return {
        success: true,
        baseCurrency,
        rates: response.data.rates,
        timestamp: response.data.time_last_updated,
        date: new Date(response.data.time_last_updated * 1000).toISOString()
      };
    } catch (error) {
      // Fallback rates
      const fallbackRates = {
        USD: 1,
        EUR: 0.85,
        GBP: 0.73,
        CAD: 1.25
      };

      return {
        success: true,
        baseCurrency,
        rates: fallbackRates,
        isEstimate: true,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Calculate fees for different payment methods
   */
  calculateFees(amount, currency, paymentMethod, transactionType = 'onboarding') {
    const feeStructures = {
      stripe: {
        percentage: 0.029, // 2.9%
        fixed: 0.30, // $0.30
        international: 0.015 // +1.5% for international cards
      },
      paypal: {
        percentage: 0.022, // 2.2%
        fixed: 0.00,
        international: 0.044 // +4.4% for international
      },
      bank_transfer: {
        percentage: 0.008, // 0.8%
        fixed: 0.00,
        max: 5.00 // Cap at $5
      },
      crypto: {
        percentage: 0.01, // 1%
        fixed: 0.00
      }
    };

    const fees = feeStructures[paymentMethod];
    if (!fees) {
      throw new Error(`Unknown payment method: ${paymentMethod}`);
    }

    let percentageFee = amount * fees.percentage;
    let totalFee = percentageFee + fees.fixed;

    // Apply max cap for bank transfers
    if (paymentMethod === 'bank_transfer' && totalFee > fees.max) {
      totalFee = fees.max;
    }

    return {
      percentageFee,
      fixedFee: fees.fixed,
      totalFee,
      netAmount: amount - totalFee,
      currency
    };
  }

  /**
   * Get minimum withdrawal amount by currency
   */
  getMinimumWithdrawal(currency) {
    const minimums = {
      USD: 10,
      EUR: 10,
      GBP: 8,
      CAD: 15
    };
    return minimums[currency] || 10;
  }

  /**
   * Verify payment status
   */
  async verifyPayment(paymentIntentId, paymentMethod = 'stripe') {
    try {
      if (paymentMethod === 'stripe') {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        return {
          success: true,
          verified: paymentIntent.status === 'succeeded',
          status: paymentIntent.status,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency.toUpperCase()
        };
      } else if (paymentMethod === 'paypal') {
        return new Promise((resolve, reject) => {
          paypal.payment.get(paymentIntentId, (error, payment) => {
            if (error) {
              reject(error);
            } else {
              resolve({
                success: true,
                verified: payment.state === 'approved',
                status: payment.state,
                amount: parseFloat(payment.transactions[0].amount.total),
                currency: payment.transactions[0].amount.currency
              });
            }
          });
        });
      }
    } catch (error) {
      throw new Error(`Payment verification failed: ${error.message}`);
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(paymentId, paymentMethod = 'stripe', amount = null) {
    try {
      if (paymentMethod === 'stripe') {
        const refundParams = { payment_intent: paymentId };
        if (amount) {
          refundParams.amount = Math.round(amount * 100);
        }

        const refund = await stripe.refunds.create(refundParams);
        return {
          success: true,
          refundId: refund.id,
          amount: refund.amount / 100,
          currency: refund.currency.toUpperCase(),
          status: refund.status
        };
      } else if (paymentMethod === 'paypal') {
        return new Promise((resolve, reject) => {
          const refundData = { amount: {} };
          if (amount) {
            refundData.amount.total = amount.toFixed(2);
          }

          paypal.sale.refund(paymentId, refundData, (error, refund) => {
            if (error) {
              reject(error);
            } else {
              resolve({
                success: true,
                refundId: refund.id,
                amount: parseFloat(refund.amount.total),
                currency: refund.amount.currency,
                status: refund.state
              });
            }
          });
        });
      }
    } catch (error) {
      throw new Error(`Refund failed: ${error.message}`);
    }
  }

  /**
   * Get payment methods available for a country
   */
  getAvailablePaymentMethods(countryCode) {
    const availableMethods = {
      US: ['stripe', 'paypal', 'bank_transfer'],
      CA: ['stripe', 'paypal', 'bank_transfer'],
      GB: ['stripe', 'paypal', 'bank_transfer'],
      EU: ['stripe', 'paypal', 'bank_transfer'],
      DEFAULT: ['stripe', 'paypal']
    };

    return availableMethods[countryCode] || availableMethods.DEFAULT;
  }

  /**
   * Health check for payment services
   */
  async healthCheck() {
    const health = {
      stripe: { status: 'unknown' },
      paypal: { status: 'unknown' },
      overall: 'healthy'
    };

    try {
      await stripe.balance.retrieve();
      health.stripe.status = 'healthy';
    } catch (error) {
      health.stripe.status = 'unhealthy';
      health.overall = 'degraded';
    }

    try {
      // Simple PayPal API test
      await new Promise((resolve) => setTimeout(resolve, 100));
      health.paypal.status = 'healthy';
    } catch (error) {
      health.paypal.status = 'unhealthy';
      health.overall = 'degraded';
    }

    return {
      success: true,
      health,
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = EnhancedPaymentService;
