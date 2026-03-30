const express = require('express');
const ProviderIntegrationService = require('../services/providerIntegrationService');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();
const integrationService = new ProviderIntegrationService();

// ============================================
// EHR INTEGRATION MANAGEMENT
// ============================================

// Get available EHR providers
router.get('/ehr/providers', authenticateToken, (req, res) => {
  try {
    const providers = Object.keys(integrationService.ehrProviders).map(key => ({
      id: key,
      name: integrationService.ehrProviders[key].name,
      fhirBase: integrationService.ehrProviders[key].fhirBase,
      authType: integrationService.ehrProviders[key].authType,
      supported: integrationService.ehrProviders[key].supported
    }));

    res.json({
      success: true,
      providers
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Register new EHR integration
router.post('/ehr/register', authenticateToken, async (req, res) => {
  try {
    const { provider, credentials, settings } = req.body;

    if (!provider || !credentials) {
      return res.status(400).json({ 
        error: 'Provider and credentials are required' 
      });
    }

    const result = await integrationService.registerEHRIntegration({
      provider,
      credentials,
      settings
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Authenticate with EHR system
router.post('/ehr/:integrationId/authenticate', authenticateToken, async (req, res) => {
  try {
    const { integrationId } = req.params;
    const { authorizationCode } = req.body;

    if (!authorizationCode) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const result = await integrationService.authenticateWithEHR(
      integrationId,
      authorizationCode
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Test EHR connection
router.get('/ehr/:integrationId/test', authenticateToken, async (req, res) => {
  try {
    const { integrationId } = req.params;
    const result = await integrationService.testConnection(integrationId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get configured integrations
router.get('/integrations', authenticateToken, (req, res) => {
  try {
    const integrations = integrationService.getConfiguredIntegrations();
    
    res.json({
      success: true,
      integrations
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PATIENT DATA SYNCHRONIZATION
// ============================================

// Fetch patient data from EHR
router.get('/ehr/:integrationId/patient/:patientId', authenticateToken, async (req, res) => {
  try {
    const { integrationId, patientId } = req.params;
    const result = await integrationService.fetchPatientData(integrationId, patientId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch patient observations (vitals, labs)
router.get('/ehr/:integrationId/patient/:patientId/observations', authenticateToken, async (req, res) => {
  try {
    const { integrationId, patientId } = req.params;
    const { category, dateFrom, dateTo } = req.query;

    const result = await integrationService.fetchPatientObservations(
      integrationId,
      patientId,
      { category, dateFrom, dateTo }
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch patient conditions (diagnoses)
router.get('/ehr/:integrationId/patient/:patientId/conditions', authenticateToken, async (req, res) => {
  try {
    const { integrationId, patientId } = req.params;
    const result = await integrationService.fetchPatientConditions(integrationId, patientId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Fetch patient medications
router.get('/ehr/:integrationId/patient/:patientId/medications', authenticateToken, async (req, res) => {
  try {
    const { integrationId, patientId } = req.params;
    const result = await integrationService.fetchPatientMedications(integrationId, patientId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Sync patient to EHR
router.post('/ehr/:integrationId/patient/sync', authenticateToken, async (req, res) => {
  try {
    const { integrationId } = req.params;
    const patientData = req.body;

    if (!patientData || !patientData.id) {
      return res.status(400).json({ error: 'Patient data with ID is required' });
    }

    const result = await integrationService.syncPatientToEHR(integrationId, patientData);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create clinical note in EHR
router.post('/ehr/:integrationId/note', authenticateToken, async (req, res) => {
  try {
    const { integrationId } = req.params;
    const { patientId, practitionerId, title, content, type, sectionTitle } = req.body;

    if (!patientId || !practitionerId || !content) {
      return res.status(400).json({ 
        error: 'patientId, practitionerId, and content are required' 
      });
    }

    const result = await integrationService.createClinicalNote(integrationId, {
      patientId,
      practitionerId,
      title,
      content,
      type,
      sectionTitle
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// PRACTICE MANAGEMENT INTEGRATION
// ============================================

// Get available practice management systems
router.get('/pm/systems', authenticateToken, (req, res) => {
  try {
    const systems = Object.keys(integrationService.practiceManagementSystems).map(key => ({
      id: key,
      name: integrationService.practiceManagementSystems[key].name,
      apiBase: integrationService.practiceManagementSystems[key].apiBase,
      supported: integrationService.practiceManagementSystems[key].supported
    }));

    res.json({
      success: true,
      systems
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get appointment availability
router.get('/pm/:systemId/availability', authenticateToken, async (req, res) => {
  try {
    const { systemId } = req.params;
    const { providerId, startDate, endDate } = req.query;

    if (!providerId) {
      return res.status(400).json({ error: 'providerId is required' });
    }

    const result = await integrationService.getAvailability(systemId, providerId, {
      startDate,
      endDate
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Schedule appointment
router.post('/pm/:systemId/appointment', authenticateToken, async (req, res) => {
  try {
    const { systemId } = req.params;
    const { 
      providerId, 
      patientId, 
      dateTime, 
      duration, 
      reason, 
      notes 
    } = req.body;

    if (!providerId || !patientId || !dateTime) {
      return res.status(400).json({ 
        error: 'providerId, patientId, and dateTime are required' 
      });
    }

    const result = await integrationService.scheduleAppointment(systemId, {
      providerId,
      patientId,
      dateTime,
      duration: duration || 30,
      reason,
      notes
    });

    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HL7/FHIR UTILITIES
// ============================================

// Parse HL7 message
router.post('/hl7/parse', authenticateToken, async (req, res) => {
  try {
    const { hl7Message } = req.body;

    if (!hl7Message) {
      return res.status(400).json({ error: 'HL7 message is required' });
    }

    const parsed = integrationService.hl7Parser.parse(hl7Message);
    
    res.json({
      success: true,
      parsed
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert HL7 to FHIR
router.post('/hl7/convert-to-fhir', authenticateToken, async (req, res) => {
  try {
    const { hl7Message, resourceType } = req.body;

    if (!hl7Message) {
      return res.status(400).json({ error: 'HL7 message is required' });
    }

    const parsedHL7 = integrationService.hl7Parser.parse(hl7Message);
    const fhirResource = integrationService.fhirConverter.convertHL7ToFHIR(parsedHL7, resourceType);

    res.json({
      success: true,
      fhirResource
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Convert standard format to FHIR
router.post('/fhir/convert', authenticateToken, async (req, res) => {
  try {
    const { dataType, data } = req.body;

    if (!dataType || !data) {
      return res.status(400).json({ error: 'dataType and data are required' });
    }

    let fhirResource;
    
    switch (dataType) {
      case 'patient':
        fhirResource = integrationService.convertToFHIRPatient(data);
        break;
      case 'composition':
        fhirResource = integrationService.convertToFHIRComposition(data);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported data type' });
    }

    res.json({
      success: true,
      fhirResource
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// SYNC STATUS AND MONITORING
// ============================================

// Get sync status for all integrations
router.get('/sync/status', authenticateToken, (req, res) => {
  try {
    const integrations = integrationService.getConfiguredIntegrations();
    
    const syncStatus = integrations.map(integration => ({
      id: integration.id,
      name: integration.name,
      status: integration.status,
      lastSync: integration.lastSync,
      health: integration.status === 'connected' ? 'healthy' : 'unhealthy'
    }));

    res.json({
      success: true,
      syncStatus,
      summary: {
        total: syncStatus.length,
        healthy: syncStatus.filter(s => s.health === 'healthy').length,
        unhealthy: syncStatus.filter(s => s.health === 'unhealthy').length
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
