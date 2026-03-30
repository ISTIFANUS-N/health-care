const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const JobProcessor = require('./services/jobProcessor');

// API Gateway imports
const { APIGateway, CircuitBreaker, EnhancedRateLimiter, RequestCache, ApiVersioning } = require('./middleware/apiGateway');
const { ServiceRegistry, GatewayProxy } = require('./services/serviceRegistry');

// Initialize job processor
const jobProcessor = new JobProcessor();

// Initialize API Gateway
const apiGateway = new APIGateway({
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeout: 30000
  },
  rateLimiter: {
    windowMs: 60000,
    maxRequests: 100,
    slowDown: {
      enabled: true,
      threshold: 20,
      delayMs: 100
    }
  },
  cache: {
    maxSize: 500,
    ttl: 60000,
    ttlByPath: {
      '/api/providers': 300000,  // 5 minutes for providers
      '/api/patients': 60000      // 1 minute for patients
    }
  },
  versioning: {
    currentVersion: 'v1',
    supportedVersions: ['v1'],
    deprecatedVersions: [],
    sunsetDates: {}
  },
  securityHeaders: {
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameguard: { action: 'deny' }
  }
});

// Initialize Service Registry
const serviceRegistry = new ServiceRegistry({
  heartbeatInterval: 30000,
  heartbeatTimeout: 90000,
  healthCheckInterval: 60000,
  loadBalancerStrategy: 'round-robin'
});

// Initialize Gateway Proxy
const gatewayProxy = new GatewayProxy(serviceRegistry, { timeout: 30000 });

// Register internal services
serviceRegistry.register('auth', { host: 'localhost', port: 3000, metadata: { version: 'v1' } });
serviceRegistry.register('patients', { host: 'localhost', port: 3000, metadata: { version: 'v1' } });
serviceRegistry.register('providers', { host: 'localhost', port: 3000, metadata: { version: 'v1' } });
serviceRegistry.register('appointments', { host: 'localhost', port: 3000, metadata: { version: 'v1' } });
serviceRegistry.register('telemedicine', { host: 'localhost', port: 3000, metadata: { version: 'v1' } });

// Import routes
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const telemedicineRoutes = require('./routes/telemedicine');
const fraudDetectionRoutes = require('./routes/fraudDetection');
const providerDirectoryRoutes = require('./routes/providerDirectory');
const appointmentsRoutes = require('./routes/appointments');
const providerAvailabilityRoutes = require('./routes/providerAvailability');
const reviewModerationRoutes = require('./routes/reviewModeration');
const paymentsRoutes = require('./routes/payments');
const paymentsExportRoutes = require('./src/routes/paymentsExport');
const stellarRoutes = require('./routes/stellar');
const providerIntegrationRoutes = require('./routes/providerIntegration');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // In production, restrict to actual frontend URL
    methods: ['GET', 'POST']
  }
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Gateway Middleware Stack
const gatewayMiddleware = apiGateway.middleware();
gatewayMiddleware.forEach(middleware => app.use(middleware));

// Database setup
const DB_PATH = path.join(__dirname, 'database', 'healthcare.sqlite');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/telemedicine', telemedicineRoutes);
app.use('/api/fraud', fraudDetectionRoutes);
app.use('/api/providers', providerDirectoryRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/provider-availability', providerAvailabilityRoutes);
app.use('/api/review-moderation', reviewModerationRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/payments', paymentsExportRoutes);
app.use('/api/stellar', stellarRoutes);
app.use('/api/provider-integration', providerIntegrationRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const services = serviceRegistry.getAllServices();
  const circuitBreakerStates = {};
  
  // Get circuit breaker states for all services
  const cb = apiGateway.getCircuitBreaker();
  for (const serviceName of Object.keys(services)) {
    const state = cb.getState(serviceName);
    circuitBreakerStates[serviceName] = state.status;
  }
  
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    gateway: {
      version: req.apiVersion || 'v1',
      cache: {
        enabled: true,
        size: apiGateway.getCache().cache.size
      },
      circuitBreaker: circuitBreakerStates,
      rateLimiter: {
        windowMs: 60000,
        maxRequests: 100
      }
    },
    services: {
      registered: Object.keys(services).length,
      details: services,
      jobProcessor: jobProcessor.isRunning,
      transformations: true
    }
  });
});

// Service Registry Management Routes
app.get('/api/gateway/services', (req, res) => {
  res.json(serviceRegistry.getAllServices());
});

app.post('/api/gateway/services/:name/register', (req, res) => {
  const { name } = req.params;
  const instance = serviceRegistry.register(name, req.body);
  res.status(201).json(instance.toJSON());
});

app.delete('/api/gateway/services/:name/:instanceId', (req, res) => {
  const { name, instanceId } = req.params;
  const success = serviceRegistry.deregister(name, instanceId);
  res.json({ success });
});

app.post('/api/gateway/services/:name/heartbeat/:instanceId', (req, res) => {
  const { name, instanceId } = req.params;
  const success = serviceRegistry.heartbeat(name, instanceId);
  res.json({ success });
});

// Cache management routes
app.delete('/api/gateway/cache', (req, res) => {
  apiGateway.getCache().invalidate('*');
  res.json({ success: true, message: 'Cache cleared' });
});

app.delete('/api/gateway/cache/:pattern', (req, res) => {
  const { pattern } = req.params;
  apiGateway.getCache().invalidate(pattern);
  res.json({ success: true, message: `Cache invalidated for pattern: ${pattern}` });
});

// Socket.io initialization for Telemedicine signaling
const TelemedicineService = require('./services/telemedicineService');
const telemedicineService = new TelemedicineService(io);
telemedicineService.initialize();

// Real-time data broadcaster initialization
const RealtimeDataBroadcaster = require('./services/realtimeDataBroadcaster');
const realtimeDataBroadcaster = new RealtimeDataBroadcaster(io);

// Make broadcaster accessible globally
global.realtimeBroadcaster = realtimeDataBroadcaster;

// Transaction WebSocket server initialization
const TransactionServer = require('./src/websocket/transactionServer');
const TransactionMonitor = require('./src/services/transactionMonitor');
const TransactionEvents = require('./src/events/transactionEvents');

// Initialize transaction services
const transactionMonitor = new TransactionMonitor();
const transactionServer = new TransactionServer(io);
const transactionEvents = new TransactionEvents(transactionServer, transactionMonitor);

// Make services accessible globally
global.transactionMonitor = transactionMonitor;
global.transactionServer = transactionServer;
global.transactionEvents = transactionEvents;

// System monitoring service initialization
const { SystemMonitoringService, getMonitoringService } = require('./services/systemMonitoringService');
const monitoringService = getMonitoringService(io);
global.monitoringService = monitoringService;

// Dashboard routes
const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes);

// Search routes
const searchRoutes = require('./routes/search');
app.use('/api/search', searchRoutes);

// Document management routes
const documentRoutes = require('./routes/documents');
app.use('/api/documents', documentRoutes);

// User profile management routes
const profileRoutes = require('./routes/profile');
app.use('/api/profile', profileRoutes);

// Transaction routes
const transactionRoutes = require('./routes/transactions');
app.use('/api/transactions', transactionRoutes);

// Static file serving for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

io.on('connection', (socket) => {
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Database init
async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        reject(err);
        return;
      }
      console.log('Database initialized');
      resolve();
    });
  });
}

// Start server
async function startServer() {
  try {
    await initializeDatabase();
    
    // Initialize monitoring service
    monitoringService.initialize();
    console.log('[Server] System monitoring service initialized');
    
    // Initialize transaction services
    await transactionMonitor.initialize();
    console.log('[Server] Transaction monitoring service initialized');
    
    server.listen(3000, () => {
      console.log('Server running on port 3000');
      console.log('[Server] Real-time dashboard available at /dashboard');
      console.log('[Server] Transaction WebSocket endpoint: /ws/transactions');
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');

  await jobProcessor.shutdown();
  await transactionEvents.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, shutting down gracefully');

  await jobProcessor.shutdown();
  await transactionEvents.shutdown();
  process.exit(0);
});

startServer();

module.exports = { app, io, apiGateway, serviceRegistry };
