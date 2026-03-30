/**
 * Insurance Company Integration Service
 * Integrates with major insurance providers for policy verification and claim processing
 * Supports real-time eligibility, claims submission, and status tracking
 */

const axios = require('axios');

class InsuranceIntegrationService {
  constructor() {
    // Major insurance providers with their API configurations
    this.insuranceProviders = {
      unitedhealth: {
        name: 'UnitedHealthcare',
        apiBase: 'https://api.uhcprovider.com/v1',
        eligibilityEndpoint: '/eligibility',
        claimsEndpoint: '/claims',
        authType: 'oauth2',
        supported: true
      },
      aetna: {
        name: 'Aetna',
        apiBase: 'https://api.aetna.com/fhir/v1',
        eligibilityEndpoint: '/CoverageEligibility',
        claimsEndpoint: '/Claim',
        authType: 'oauth2',
        supported: true
      },
      anthem: {
        name: 'Anthem (Elevance)',
        apiBase: 'https://api.anthem.com/fhir/r4',
        eligibilityEndpoint: '/CoverageEligibilityRequest',
        claimsEndpoint: '/Claim',
        authType: 'oauth2',
        supported: true
      },
      cigna: {
        name: 'Cigna Healthcare',
        apiBase: 'https://api.cigna.com/api/v1',
        eligibilityEndpoint: '/eligibility',
        claimsEndpoint: '/claims',
        authType: 'apikey',
        supported: true
      },
      humana: {
        name: 'Humana',
        apiBase: 'https://fhir.humana.com/hapi-fhir-server/r4',
        eligibilityEndpoint: '/CoverageEligibilityRequest',
        claimsEndpoint: '/Claim',
        authType: 'oauth2',
        supported: true
      },
      bcbs: {
        name: 'Blue Cross Blue Shield',
        apiBase: 'https://api.bcbs.com/fhir/r4',
        eligibilityEndpoint: '/CoverageEligibilityRequest',
        claimsEndpoint: '/Claim',
        authType: 'oauth2',
        supported: true,
        note: 'API varies by state plan'
      }
    };

    this.activeConnections = new Map();
  }

  /**
   * Register insurance provider integration
   */
  async registerInsuranceProvider(config) {
    const { provider, credentials, settings } = config;

    if (!this.insuranceProviders[provider]) {
      throw new Error(`Unsupported insurance provider: ${provider}`);
    }

    const insurerConfig = {
      id: `insurer_${provider}_${Date.now()}`,
      provider,
      name: this.insuranceProviders[provider].name,
      apiBase: settings.apiBase || this.insuranceProviders[provider].apiBase,
      authType: this.insuranceProviders[provider].authType,
      credentials: {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        apiKey: credentials.apiKey,
        issuerId: credentials.issuerId
      },
      settings: {
        autoVerify: settings.autoVerify || false,
        autoSubmitClaims: settings.autoSubmitClaims || false,
        preferredFormat: settings.preferredFormat || 'FHIR'
      },
      status: 'configured',
      createdAt: new Date().toISOString()
    };

    this.activeConnections.set(insurerConfig.id, insurerConfig);

    return {
      success: true,
      integrationId: insurerConfig.id,
      message: `${insurerConfig.name} integration registered`
    };
  }

  /**
   * Authenticate with insurance provider API
   */
  async authenticateWithInsurer(integrationId) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration) {
      throw new Error('Integration not found');
    }

    const provider = this.insuranceProviders[integration.provider];

    try {
      let tokenResponse;

      if (provider.authType === 'oauth2') {
        tokenResponse = await axios.post(
          `${integration.apiBase}/oauth2/token`,
          {
            grant_type: 'client_credentials',
            client_id: integration.credentials.clientId,
            client_secret: integration.credentials.clientSecret,
            scope: 'eligibility claims'
          },
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );

        integration.accessToken = tokenResponse.data.access_token;
        integration.tokenExpiresAt = new Date(Date.now() + (tokenResponse.data.expires_in * 1000));
      } else if (provider.authType === 'apikey') {
        integration.apiKey = integration.credentials.apiKey;
      }

      integration.status = 'connected';

      return {
        success: true,
        accessToken: integration.accessToken,
        expiresIn: tokenResponse?.data?.expires_in,
        status: integration.status
      };
    } catch (error) {
      throw new Error(`Insurance provider authentication failed: ${error.message}`);
    }
  }

  /**
   * Verify patient insurance eligibility in real-time
   */
  async verifyEligibility(integrationId, patientInfo, serviceInfo) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('Insurance provider not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const provider = this.insuranceProviders[integration.provider];
      
      // Build eligibility request in FHIR format
      const eligibilityRequest = this.buildEligibilityRequest(patientInfo, serviceInfo);

      const response = await axios.post(
        `${integration.apiBase}${provider.eligibilityEndpoint}`,
        eligibilityRequest,
        {
          headers: this.getAuthHeaders(integration)
        }
      );

      const eligibilityResult = this.parseEligibilityResponse(response.data);

      return {
        success: true,
        eligible: eligibilityResult.isEligible,
        coverage: eligibilityResult.coverage,
        benefits: eligibilityResult.benefits,
        copay: eligibilityResult.copay,
        deductible: eligibilityResult.deductible,
        coinsurance: eligibilityResult.coinsurance,
        effectiveDate: eligibilityResult.effectiveDate,
        expirationDate: eligibilityResult.expirationDate,
        source: integration.name,
        verifiedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Eligibility verification failed: ${error.message}`);
    }
  }

  /**
   * Submit insurance claim electronically (EDI 837 or FHIR)
   */
  async submitClaim(integrationId, claimData) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('Insurance provider not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const provider = this.insuranceProviders[integration.provider];
      
      // Transform claim to FHIR Claim resource
      const fhirClaim = this.buildFHIRClaim(claimData);

      const response = await axios.post(
        `${integration.apiBase}${provider.claimsEndpoint}`,
        fhirClaim,
        {
          headers: this.getAuthHeaders(integration)
        }
      );

      return {
        success: true,
        claimId: response.data.id,
        claimNumber: response.data.identifier?.[0]?.value,
        status: response.data.status,
        submittedAt: new Date().toISOString(),
        acknoledgement: response.data.outcome,
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Claim submission failed: ${error.message}`);
    }
  }

  /**
   * Check claim status
   */
  async checkClaimStatus(integrationId, claimId) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('Insurance provider not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const provider = this.insuranceProviders[integration.provider];

      const response = await axios.get(
        `${integration.apiBase}${provider.claimsEndpoint}/${claimId}`,
        {
          headers: this.getAuthHeaders(integration)
        }
      );

      return {
        success: true,
        claimId: response.data.id,
        status: response.data.status,
        outcome: response.data.outcome,
        totalAmount: response.data.total?.value,
        paidAmount: response.data.payment?.amount?.value,
        adjudication: this.parseAdjudication(response.data.adjudication),
        lastUpdated: response.data.meta?.lastUpdated,
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Claim status check failed: ${error.message}`);
    }
  }

  /**
   * Get claim details and explanation of benefits (EOB)
   */
  async getClaimDetails(integrationId, claimId) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('Insurance provider not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const provider = this.insuranceProviders[integration.provider];

      // Get Claim resource
      const claimResponse = await axios.get(
        `${integration.apiBase}${provider.claimsEndpoint}/${claimId}`,
        {
          headers: this.getAuthHeaders(integration)
        }
      );

      // Get Explanation of Benefits if available
      let eob = null;
      try {
        const eobResponse = await axios.get(
          `${integration.apiBase}/ExplanationOfBenefits?claim=${claimId}`,
          {
            headers: this.getAuthHeaders(integration)
          }
        );
        
        if (eobResponse.data.entry && eobResponse.data.entry.length > 0) {
          eob = eobResponse.data.entry[0].resource;
        }
      } catch (error) {
        // EOB not available, continue without it
      }

      return {
        success: true,
        claim: claimResponse.data,
        explanationOfBenefits: eob,
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Failed to get claim details: ${error.message}`);
    }
  }

  /**
   * Batch submit multiple claims
   */
  async batchSubmitClaims(integrationId, claims) {
    const results = [];

    for (const claim of claims) {
      try {
        const result = await this.submitClaim(integrationId, claim);
        results.push({
          success: true,
          claimData: claim,
          result
        });
      } catch (error) {
        results.push({
          success: false,
          claimData: claim,
          error: error.message
        });
      }
    }

    return {
      success: true,
      total: claims.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * Build FHIR CoverageEligibilityRequest
   */
  buildEligibilityRequest(patientInfo, serviceInfo) {
    return {
      resourceType: 'CoverageEligibilityRequest',
      status: 'active',
      created: new Date().toISOString(),
      provider: {
        reference: `Practitioner/${serviceInfo.providerId}`
      },
      insurer: {
        reference: `Organization/${serviceInfo.insurerId}`
      },
      patient: {
        reference: `Patient/${patientInfo.patientId}`
      },
      servicedDate: serviceInfo.serviceDate,
      item: [{
        category: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/ex-benefitcategory',
            code: serviceInfo.benefitCategory || 'medical'
          }]
        },
        productOrService: {
          coding: [{
            system: 'http://www.ama-assn.org/go/cpt',
            code: serviceInfo.procedureCode
          }]
        }
      }]
    };
  }

  /**
   * Build FHIR Claim resource
   */
  buildFHIRClaim(claimData) {
    return {
      resourceType: 'Claim',
      status: 'active',
      type: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/claim-type',
          code: 'professional'
        }]
      },
      use: 'claim',
      patient: {
        reference: `Patient/${claimData.patientId}`
      },
      billablePeriod: {
        start: claimData.serviceDate,
        end: claimData.serviceDate
      },
      created: new Date().toISOString(),
      insurer: {
        reference: `Organization/${claimData.insurerId}`
      },
      provider: {
        reference: `Practitioner/${claimData.providerId}`
      },
      priority: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/processpriority',
          code: 'normal'
        }]
      },
      diagnosis: claimData.diagnoses?.map((diag, index) => ({
        sequence: index + 1,
        diagnosisReference: {
          reference: `Condition/${diag.conditionId}`
        },
        type: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/ex-diagnosistype',
            code: 'principal'
          }]
        }]
      })),
      item: claimData.items?.map((item, index) => ({
        sequence: index + 1,
        productOrService: {
          coding: [{
            system: 'http://www.ama-assn.org/go/cpt',
            code: item.procedureCode
          }]
        },
        servicedDate: claimData.serviceDate,
        unitPrice: {
          value: item.amount,
          currency: 'USD'
        },
        quantity: item.quantity || 1
      })),
      total: [{
        category: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/adjudication',
            code: 'submitted'
          }]
        },
        amount: {
          value: claimData.totalAmount,
          currency: 'USD'
        }
      }]
    };
  }

  /**
   * Parse eligibility response
   */
  parseEligibilityResponse(response) {
    // Simplified parsing - actual implementation would handle FHIR CoverageEligibilityResponse
    return {
      isEligible: response.status === 'active',
      coverage: {
        plan: response.plan?.name || 'Unknown',
        network: response.network || 'PPO'
      },
      benefits: {
        medical: true,
        surgical: true,
        prescription: response.drugBenefit || false
      },
      copay: response.copay?.amount || 0,
      deductible: response.deductible?.amount || 0,
      coinsurance: response.coinsurance?.percentage || 0,
      effectiveDate: response.period?.start,
      expirationDate: response.period?.end
    };
  }

  /**
   * Parse claim adjudication
   */
  parseAdjudication(adjudication) {
    if (!adjudication) return [];
    
    return adjudication.map(adj => ({
      category: adj.category?.coding?.[0]?.code,
      reason: adj.reason?.coding?.[0]?.display,
      amount: adj.amount?.value,
      percentage: adj.factor ? adj.factor * 100 : null
    }));
  }

  /**
   * Get authentication headers
   */
  getAuthHeaders(integration) {
    const headers = {
      'Content-Type': 'application/fhir+json',
      'Accept': 'application/fhir+json'
    };

    if (integration.authType === 'oauth2' && integration.accessToken) {
      headers['Authorization'] = `Bearer ${integration.accessToken}`;
    } else if (integration.authType === 'apikey' && integration.apiKey) {
      headers['x-api-key'] = integration.apiKey;
    }

    return headers;
  }

  /**
   * Ensure access token is valid
   */
  async ensureValidToken(integration) {
    if (integration.authType === 'oauth2' && 
        (!integration.accessToken || new Date() >= integration.tokenExpiresAt)) {
      await this.authenticateWithInsurer(integration.id);
    }
  }

  /**
   * Get list of configured insurance providers
   */
  getConfiguredProviders() {
    return Array.from(this.activeConnections.values()).map(provider => ({
      id: provider.id,
      insurer: provider.provider,
      name: provider.name,
      status: provider.status,
      authType: provider.authType,
      createdAt: provider.createdAt
    }));
  }

  /**
   * Test insurance provider connection
   */
  async testConnection(integrationId) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration) {
      return {
        success: false,
        message: 'Integration not found'
      };
    }

    try {
      await this.authenticateWithInsurer(integrationId);
      
      return {
        success: true,
        message: 'Connection successful',
        provider: integration.name,
        status: 'connected'
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection test failed: ${error.message}`,
        status: 'disconnected'
      };
    }
  }

  /**
   * Get supported insurance providers
   */
  getSupportedProviders() {
    return Object.keys(this.insuranceProviders).map(key => ({
      id: key,
      name: this.insuranceProviders[key].name,
      apiBase: this.insuranceProviders[key].apiBase,
      authType: this.insuranceProviders[key].authType,
      supported: this.insuranceProviders[key].supported,
      endpoints: {
        eligibility: this.insuranceProviders[key].eligibilityEndpoint,
        claims: this.insuranceProviders[key].claimsEndpoint
      }
    }));
  }
}

module.exports = InsuranceIntegrationService;
