/**
 * Healthcare Provider Integration Service
 * Integrates with EHR systems, practice management software, and healthcare APIs
 * Supports HL7 FHIR, Epic, Cerner, and other major EHR providers
 */

const axios = require('axios');
const { HL7Parser } = require('./hl7Parser');
const { FHIRConverter } = require('./fhirConverter');

class ProviderIntegrationService {
  constructor() {
    this.hl7Parser = new HL7Parser();
    this.fhirConverter = new FHIRConverter();
    
    // Supported EHR integrations
    this.ehrProviders = {
      epic: {
        name: 'Epic MyChart',
        fhirBase: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
        authType: 'oauth2',
        supported: true
      },
      cerner: {
        name: 'Cerner PowerChart',
        fhirBase: 'https://fhir-open.cerner.com/r4',
        authType: 'oauth2',
        supported: true
      },
      allscripts: {
        name: 'Allscripts Developer Platform',
        fhirBase: 'https://apis.allscriptscloud.com/fhir-r4-standard-server',
        authType: 'oauth2',
        supported: true
      },
      athenahealth: {
        name: 'athenahealth API',
        fhirBase: 'https://api.athenahealth.com/fhir/r4',
        authType: 'oauth2',
        supported: true
      },
      nextgen: {
        name: 'NextGen Healthcare',
        fhirBase: 'https://fhir.nextgen.com/nge/prod/fhir-api-r4',
        authType: 'oauth2',
        supported: true
      }
    };

    // Practice management systems
    this.practiceManagementSystems = {
      advancedmd: {
        name: 'AdvancedMD',
        apiBase: 'https://pm.advancedmd.com/api',
        supported: true
      },
      kareo: {
        name: 'Kareo',
        apiBase: 'https://api.kareo.com/api/v1',
        supported: true
      },
      drchrono: {
        name: 'DrChrono',
        apiBase: 'https://drchrono-sandbox.appspot.com',
        supported: true
      }
    };

    this.activeConnections = new Map();
  }

  /**
   * Register EHR integration configuration
   */
  async registerEHRIntegration(config) {
    const { provider, credentials, settings } = config;

    if (!this.ehrProviders[provider]) {
      throw new Error(`Unsupported EHR provider: ${provider}`);
    }

    const ehrConfig = {
      id: `ehr_${provider}_${Date.now()}`,
      provider,
      name: this.ehrProviders[provider].name,
      fhirBase: settings.fhirBase || this.ehrProviders[provider].fhirBase,
      authType: this.ehrProviders[provider].authType,
      credentials: {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        redirectUri: credentials.redirectUri
      },
      settings: {
        autoSync: settings.autoSync || false,
        syncInterval: settings.syncInterval || 3600000, // 1 hour
        dataTypes: settings.dataTypes || ['Patient', 'Observation', 'Condition', 'Medication']
      },
      status: 'configured',
      createdAt: new Date().toISOString()
    };

    // Store connection (in production, persist to database)
    this.activeConnections.set(ehrConfig.id, ehrConfig);

    return {
      success: true,
      integrationId: ehrConfig.id,
      message: `${this.ehrProviders[provider].name} integration registered`
    };
  }

  /**
   * Authenticate with EHR system using OAuth2
   */
  async authenticateWithEHR(integrationId, authorizationCode) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration) {
      throw new Error('Integration not found');
    }

    try {
      const tokenResponse = await axios.post(
        `${integration.fhirBase}/oauth2/token`,
        {
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: integration.credentials.redirectUri,
          client_id: integration.credentials.clientId,
          client_secret: integration.credentials.clientSecret
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      integration.accessToken = tokenResponse.data.access_token;
      integration.refreshToken = tokenResponse.data.refresh_token;
      integration.tokenExpiresAt = new Date(Date.now() + (tokenResponse.data.expires_in * 1000));
      integration.status = 'connected';

      return {
        success: true,
        accessToken: tokenResponse.data.access_token,
        expiresIn: tokenResponse.data.expires_in,
        scope: tokenResponse.data.scope
      };
    } catch (error) {
      throw new Error(`EHR authentication failed: ${error.message}`);
    }
  }

  /**
   * Fetch patient data from EHR system
   */
  async fetchPatientData(integrationId, patientId) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('EHR not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const response = await axios.get(
        `${integration.fhirBase}/Patient/${patientId}`,
        {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Accept': 'application/fhir+json'
          }
        }
      );

      return {
        success: true,
        patient: this.transformFHIRPatient(response.data),
        source: integration.name,
        fetchedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Failed to fetch patient data: ${error.message}`);
    }
  }

  /**
   * Fetch patient observations (vitals, lab results)
   */
  async fetchPatientObservations(integrationId, patientId, options = {}) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('EHR not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const params = new URLSearchParams({ patient: patientId });
      
      if (options.category) {
        params.append('category', options.category);
      }
      
      if (options.dateFrom) {
        params.append('date', `ge${options.dateFrom}`);
      }
      
      if (options.dateTo) {
        params.append('date', `le${options.dateTo}`);
      }

      const response = await axios.get(
        `${integration.fhirBase}/Observation?${params}`,
        {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Accept': 'application/fhir+json'
          }
        }
      );

      return {
        success: true,
        observations: response.data.entry.map(entry => this.transformFHIObservation(entry.resource)),
        count: response.data.entry.length,
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Failed to fetch observations: ${error.message}`);
    }
  }

  /**
   * Fetch patient conditions (diagnoses)
   */
  async fetchPatientConditions(integrationId, patientId) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('EHR not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const response = await axios.get(
        `${integration.fhirBase}/Condition?patient=${patientId}`,
        {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Accept': 'application/fhir+json'
          }
        }
      );

      return {
        success: true,
        conditions: response.data.entry.map(entry => this.transformFHIRCondition(entry.resource)),
        count: response.data.entry.length,
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Failed to fetch conditions: ${error.message}`);
    }
  }

  /**
   * Fetch patient medications
   */
  async fetchPatientMedications(integrationId, patientId) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('EHR not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const response = await axios.get(
        `${integration.fhirBase}/MedicationRequest?patient=${patientId}`,
        {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Accept': 'application/fhir+json'
          }
        }
      );

      return {
        success: true,
        medications: response.data.entry.map(entry => this.transformFHIRMedication(entry.resource)),
        count: response.data.entry.length,
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Failed to fetch medications: ${error.message}`);
    }
  }

  /**
   * Create/update patient record in EHR system
   */
  async syncPatientToEHR(integrationId, patientData) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('EHR not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const fhirPatient = this.convertToFHIRPatient(patientData);

      const response = await axios.post(
        `${integration.fhirBase}/Patient`,
        fhirPatient,
        {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
          }
        }
      );

      return {
        success: true,
        patientId: response.data.id,
        message: 'Patient synced to EHR successfully',
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Failed to sync patient: ${error.message}`);
    }
  }

  /**
   * Create clinical note in EHR
   */
  async createClinicalNote(integrationId, noteData) {
    const integration = this.activeConnections.get(integrationId);
    
    if (!integration || integration.status !== 'connected') {
      throw new Error('EHR not connected');
    }

    try {
      await this.ensureValidToken(integration);

      const fhirComposition = this.convertToFHIRComposition(noteData);

      const response = await axios.post(
        `${integration.fhirBase}/Composition`,
        fhirComposition,
        {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`,
            'Content-Type': 'application/fhir+json',
            'Accept': 'application/fhir+json'
          }
        }
      );

      return {
        success: true,
        noteId: response.data.id,
        message: 'Clinical note created successfully',
        source: integration.name
      };
    } catch (error) {
      throw new Error(`Failed to create clinical note: ${error.message}`);
    }
  }

  /**
   * Schedule appointment in practice management system
   */
  async scheduleAppointment(pmSystemId, appointmentData) {
    // Implementation would integrate with specific PM system APIs
    // This is a mock implementation
    const pmSystem = this.practiceManagementSystems[pmSystemId];
    
    if (!pmSystem) {
      throw new Error(`Unsupported practice management system: ${pmSystemId}`);
    }

    // Mock appointment scheduling
    return {
      success: true,
      appointmentId: `apt_${Date.now()}`,
      system: pmSystem.name,
      message: 'Appointment scheduled successfully',
      details: appointmentData
    };
  }

  /**
   * Get appointment availability from practice management system
   */
  async getAvailability(pmSystemId, providerId, dateRange) {
    const pmSystem = this.practiceManagementSystems[pmSystemId];
    
    if (!pmSystem) {
      throw new Error(`Unsupported practice management system: ${pmSystemId}`);
    }

    // Mock availability lookup
    return {
      success: true,
      system: pmSystem.name,
      providerId,
      dateRange,
      availableSlots: [
        { date: '2024-01-15', times: ['09:00', '10:00', '11:00'] },
        { date: '2024-01-16', times: ['14:00', '15:00', '16:00'] }
      ]
    };
  }

  /**
   * Transform FHIR Patient resource to standard format
   */
  transformFHIRPatient(fhirPatient) {
    return {
      id: fhirPatient.id,
      identifier: fhirPatient.identifier?.map(id => ({
        system: id.system,
        value: id.value
      })),
      name: {
        first: fhirPatient.name?.[0]?.given?.join(' '),
        last: fhirPatient.name?.[0]?.family
      },
      gender: fhirPatient.gender,
      birthDate: fhirPatient.birthDate,
      contact: {
        telecom: fhirPatient.telecom,
        address: fhirPatient.address
      },
      generalPractitioner: fhirPatient.generalPractitioner
    };
  }

  /**
   * Transform FHIR Observation to standard format
   */
  transformFHIObservation(fhirObservation) {
    return {
      id: fhirObservation.id,
      status: fhirObservation.status,
      category: fhirObservation.category?.[0]?.coding?.[0]?.code,
      code: {
        text: fhirObservation.code.text,
        coding: fhirObservation.code.coding
      },
      value: {
        value: fhirObservation.valueQuantity?.value,
        unit: fhirObservation.valueQuantity?.unit,
        system: fhirObservation.valueQuantity?.system
      },
      effectiveDateTime: fhirObservation.effectiveDateTime,
      issued: fhirObservation.issued,
      performer: fhirObservation.performer,
      referenceRange: fhirObservation.referenceRange
    };
  }

  /**
   * Transform FHIR Condition to standard format
   */
  transformFHIRCondition(fhirCondition) {
    return {
      id: fhirCondition.id,
      clinicalStatus: fhirCondition.clinicalStatus?.coding?.[0]?.code,
      verificationStatus: fhirCondition.verificationStatus?.coding?.[0]?.code,
      category: fhirCondition.category?.[0]?.coding?.[0]?.code,
      code: {
        text: fhirCondition.code.text,
        coding: fhirCondition.code.coding
      },
      subject: fhirCondition.subject,
      onsetDateTime: fhirCondition.onsetDateTime,
      recordedDate: fhirCondition.recordedDate,
      recorder: fhirCondition.recorder
    };
  }

  /**
   * Transform FHIR Medication to standard format
   */
  transformFHIRMedication(fhirMedication) {
    return {
      id: fhirMedication.id,
      status: fhirMedication.status,
      intent: fhirMedication.intent,
      medication: {
        text: fhirMedication.medicationCodeableConcept?.text,
        coding: fhirMedication.medicationCodeableConcept?.coding
      },
      subject: fhirMedication.subject,
      dosage: fhirMedication.dosageInstruction?.map(dosage => ({
        text: dosage.text,
        timing: dosage.timing,
        doseAndRate: dosage.doseAndRate
      })),
      dispenseRequest: fhirMedication.dispenseRequest
    };
  }

  /**
   * Convert standard patient data to FHIR format
   */
  convertToFHIRPatient(patientData) {
    return {
      resourceType: 'Patient',
      identifier: patientData.identifiers?.map(id => ({
        system: id.system,
        value: id.value
      })),
      name: [{
        given: patientData.name.first ? [patientData.name.first] : [],
        family: patientData.name.last
      }],
      gender: patientData.gender,
      birthDate: patientData.birthDate,
      telecom: patientData.contact?.telecom || [],
      address: patientData.contact?.address || []
    };
  }

  /**
   * Convert clinical note to FHIR Composition
   */
  convertToFHIRComposition(noteData) {
    return {
      resourceType: 'Composition',
      status: 'final',
      type: {
        coding: [{
          system: 'http://loinc.org',
          code: noteData.type || '34133-9',
          display: 'Summarization of episode note'
        }]
      },
      subject: { reference: `Patient/${noteData.patientId}` },
      date: noteData.date || new Date().toISOString(),
      author: [{ reference: `Practitioner/${noteData.practitionerId}` }],
      title: noteData.title,
      section: [{
        title: noteData.sectionTitle || 'Clinical Note',
        text: {
          status: 'generated',
          div: `<div>${noteData.content}</div>`
        }
      }]
    };
  }

  /**
   * Ensure access token is valid, refresh if needed
   */
  async ensureValidToken(integration) {
    if (!integration.accessToken || new Date() >= integration.tokenExpiresAt) {
      await this.refreshToken(integration);
    }
  }

  /**
   * Refresh OAuth2 token
   */
  async refreshToken(integration) {
    try {
      const tokenResponse = await axios.post(
        `${integration.fhirBase}/oauth2/token`,
        {
          grant_type: 'refresh_token',
          refresh_token: integration.refreshToken,
          client_id: integration.credentials.clientId,
          client_secret: integration.credentials.clientSecret
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      integration.accessToken = tokenResponse.data.access_token;
      integration.refreshToken = tokenResponse.data.refresh_token;
      integration.tokenExpiresAt = new Date(Date.now() + (tokenResponse.data.expires_in * 1000));

      return { success: true };
    } catch (error) {
      integration.status = 'disconnected';
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  /**
   * Get list of configured integrations
   */
  getConfiguredIntegrations() {
    return Array.from(this.activeConnections.values()).map(integration => ({
      id: integration.id,
      provider: integration.provider,
      name: integration.name,
      status: integration.status,
      lastSync: integration.lastSync,
      createdAt: integration.createdAt
    }));
  }

  /**
   * Test EHR connection
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
      await this.ensureValidToken(integration);
      
      // Test by fetching metadata
      const response = await axios.get(
        `${integration.fhirBase}/metadata`,
        {
          headers: {
            'Authorization': `Bearer ${integration.accessToken}`
          }
        }
      );

      return {
        success: true,
        message: 'Connection successful',
        fhirVersion: response.data.fhirVersion,
        systemName: response.data.name,
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
}

module.exports = ProviderIntegrationService;
