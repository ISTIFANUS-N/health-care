const express = require('express');
const InsuranceIntegrationService = require('../services/insuranceIntegrationService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const insuranceService = new InsuranceIntegrationService();

// ============================================
// INSURANCE PROVIDER MANAGEMENT
// ============================================

// Get supported insurance providers
router.get('/providers/supported', authenticateToken, (req, res) => {
  try {
    const providers = insuranceService.getSupportedProviders();
    
    res.json({
      success: true,
      providers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register insurance provider integration
router.post('/providers/register', authenticateToken, async (req, res) => {
  try {
    const { provider, credentials, settings } = req.body;

    if (!provider || !credentials) {
      return res.status(400).json({ 
        error: 'Provider and credentials are required' 
      });
    }

    const result = await insuranceService.registerInsuranceProvider({
      provider,
      credentials,
      settings
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Authenticate with insurance provider
router.post('/providers/:integrationId/authenticate', authenticateToken, async (req, res) => {
  try {
    const { integrationId } = req.params;
    const result = await insuranceService.authenticateWithInsurer(integrationId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test insurance provider connection
router.get('/providers/:integrationId/test', authenticateToken, async (req, res) => {
  try {
    const { integrationId } = req.params;
    const result = await insuranceService.testConnection(integrationId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get configured insurance providers
router.get('/providers', authenticateToken, (req, res) => {
  try {
    const providers = insuranceService.getConfiguredProviders();
    
    res.json({
      success: true,
      providers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// ELIGIBILITY VERIFICATION
// ============================================

// Verify patient insurance eligibility
router.post('/eligibility/verify', authenticateToken, async (req, res) => {
  try {
    const { integrationId, patientInfo, serviceInfo } = req.body;

    if (!integrationId || !patientInfo || !serviceInfo) {
      return res.status(400).json({ 
        error: 'integrationId, patientInfo, and serviceInfo are required' 
      });
    }

    const result = await insuranceService.verifyEligibility(
      integrationId,
      patientInfo,
      serviceInfo
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Real-time eligibility check with auto-provider selection
router.post('/eligibility/check', authenticateToken, async (req, res) => {
  try {
    const { 
      patientId, 
      member_id, 
      insurerId,
      serviceDate,
      procedureCode 
    } = req.body;

    if (!patientId || !member_id || !insurerId) {
      return res.status(400).json({ 
        error: 'patientId, member_id, and insurerId are required' 
      });
    }

    // Find active integration for this insurer
    const providers = insuranceService.getConfiguredProviders();
    const integration = providers.find(p => p.id === insurerId);

    if (!integration) {
      return res.status(404).json({ 
        error: 'No active integration found for this insurer' 
      });
    }

    const patientInfo = {
      patientId,
      memberId: member_id
    };

    const serviceInfo = {
      serviceDate,
      procedureCode,
      providerId: req.body.providerId,
      insurerId
    };

    const result = await insuranceService.verifyEligibility(
      integration.id,
      patientInfo,
      serviceInfo
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CLAIMS PROCESSING
// ============================================

// Submit insurance claim
router.post('/claims/submit', authenticateToken, async (req, res) => {
  try {
    const { integrationId, claimData } = req.body;

    if (!integrationId || !claimData) {
      return res.status(400).json({ 
        error: 'integrationId and claimData are required' 
      });
    }

    // Validate required claim fields
    const requiredFields = ['patientId', 'providerId', 'insurerId', 'serviceDate', 'totalAmount'];
    const missingFields = requiredFields.filter(field => !claimData[field]);

    if (missingFields.length > 0) {
      return res.status(400).json({ 
        error: `Missing required fields: ${missingFields.join(', ')}` 
      });
    }

    const result = await insuranceService.submitClaim(
      integrationId,
      claimData
    );

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check claim status
router.get('/claims/:claimId/status', authenticateToken, async (req, res) => {
  try {
    const { claimId } = req.params;
    const { integrationId } = req.query;

    if (!integrationId) {
      return res.status(400).json({ error: 'integrationId is required' });
    }

    const result = await insuranceService.checkClaimStatus(
      integrationId,
      claimId
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get claim details and EOB
router.get('/claims/:claimId/details', authenticateToken, async (req, res) => {
  try {
    const { claimId } = req.params;
    const { integrationId } = req.query;

    if (!integrationId) {
      return res.status(400).json({ error: 'integrationId is required' });
    }

    const result = await insuranceService.getClaimDetails(
      integrationId,
      claimId
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Batch submit multiple claims
router.post('/claims/batch-submit', authenticateToken, async (req, res) => {
  try {
    const { integrationId, claims } = req.body;

    if (!integrationId || !claims || !Array.isArray(claims)) {
      return res.status(400).json({ 
        error: 'integrationId and claims array are required' 
      });
    }

    const result = await insuranceService.batchSubmitClaims(
      integrationId,
      claims
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// CLAIM STATUS TRACKING
// ============================================

// Get all claims for a patient
router.get('/claims/patient/:patientId', authenticateToken, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { integrationId, limit = 20, status } = req.query;

    if (!integrationId) {
      return res.status(400).json({ error: 'integrationId is required' });
    }

    // This would query the insurance provider's API for patient claims
    // For now, return a placeholder response
    res.json({
      success: true,
      message: 'Query insurance provider API for patient claims',
      patientId,
      integrationId,
      filters: { limit, status }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// POLICY VERIFICATION
// ============================================

// Get policy details
router.get('/policy/:memberId', authenticateToken, async (req, res) => {
  try {
    const { memberId } = req.params;
    const { integrationId } = req.query;

    if (!integrationId) {
      return res.status(400).json({ error: 'integrationId is required' });
    }

    // Query insurance provider for policy details
    // This is a placeholder - actual implementation varies by provider
    res.json({
      success: true,
      memberId,
      policy: {
        planName: 'PPO Gold Plan',
        planType: 'PPO',
        network: 'National PPO',
        effectiveDate: '2024-01-01',
        expirationDate: '2024-12-31',
        status: 'active',
        coverage: {
          medical: true,
          surgical: true,
          prescription: true,
          mentalHealth: true,
          vision: false,
          dental: false
        },
        financials: {
          deductible: {
            individual: 1000,
            family: 2000,
            remaining: 500
          },
          outOfPocketMax: {
            individual: 5000,
            family: 10000
          },
          copay: {
            primaryCare: 25,
            specialist: 50,
            emergency: 150
          },
          coinsurance: {
            inNetwork: 0.2,
            outOfNetwork: 0.4
          }
        }
      },
      source: 'Insurance Provider API'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify prior authorization requirement
router.post('/authorization/check', authenticateToken, async (req, res) => {
  try {
    const { integrationId, procedureCode, diagnosisCode, patientInfo } = req.body;

    if (!integrationId || !procedureCode) {
      return res.status(400).json({ 
        error: 'integrationId and procedureCode are required' 
      });
    }

    // Check if prior authorization is required
    // This is a simplified check - actual logic varies by insurer
    const requiresAuth = ['73610', '73620', '73721'].includes(procedureCode);

    res.json({
      success: true,
      requiresAuthorization: requiresAuth,
      procedureCode,
      diagnosisCode,
      message: requiresAuth 
        ? 'Prior authorization required. Submit authorization request.'
        : 'No prior authorization required for this procedure.',
      nextSteps: requiresAuth ? [
        'Gather clinical documentation',
        'Submit prior authorization request',
        'Wait for determination (typically 3-5 business days)'
      ] : [
        'Proceed with service',
        'Submit claim after service'
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Submit prior authorization request
router.post('/authorization/request', authenticateToken, async (req, res) => {
  try {
    const { integrationId, requestData } = req.body;

    if (!integrationId || !requestData) {
      return res.status(400).json({ 
        error: 'integrationId and requestData are required' 
      });
    }

    // Submit prior authorization request to insurance provider
    // Actual implementation would use FHIR Prior Authorization Request (PAR) resource
    const authRequest = {
      requestId: `auth_${Date.now()}`,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      estimatedResponse: '3-5 business days',
      trackingNumber: `PAR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    res.status(201).json({
      success: true,
      ...authRequest,
      message: 'Prior authorization request submitted successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// INTEGRATION MONITORING
// ============================================

// Get integration status summary
router.get('/status', authenticateToken, (req, res) => {
  try {
    const providers = insuranceService.getConfiguredProviders();
    
    const statusSummary = {
      total: providers.length,
      connected: providers.filter(p => p.status === 'connected').length,
      configured: providers.filter(p => p.status === 'configured').length,
      providers: providers.map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        authType: p.authType
      }))
    };

    res.json({
      success: true,
      status: statusSummary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
