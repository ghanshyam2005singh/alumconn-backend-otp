const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

// Basic security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false
}));

// Rate limiting for production
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // 100 requests per 15 minutes in production
  message: {
    error: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP specific rate limiting
const otpLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 OTP requests per 5 minutes
  message: {
    error: 'Too many OTP requests, please try again later.'
  },
  keyGenerator: (req) => {
    return req.body.email || req.ip; // Rate limit by email or IP
  }
});

// CORS configuration for production
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? [
        'https://alumconn.in', // Replace with your actual frontend domain
        'exp://your-expo-app-url', // Replace with your Expo app URL
        // Add localhost origins for development access to production backend
        'http://localhost:3000',
        'http://localhost:3001', 
        'http://localhost:8080',
        'http://localhost:8081',
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:8080',
        'http://127.0.0.1:8081',
        // Add your local IP for mobile testing
        'http://10.156.20.137:3000',
        'http://10.156.20.137:8081',
        // Expo development server
        'exp://localhost:19000',
        'exp://10.156.20.137:19000',
        'exp://192.168.29.91:8081'
      ]
    : '*', // Allow all origins in development
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(limiter);

// In-memory storage for OTPs (use Redis in production for scaling)
const otpStorage = new Map();

// Health check endpoint - KEEP THE SERVER ALIVE
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    resendConfigured: !!process.env.RESEND_API_KEY
  });
});

// Self-ping to keep server alive (Render free tier)
if (process.env.NODE_ENV === 'production') {
  const keepAlive = () => {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
    
    // Ping every 14 minutes to prevent Render from sleeping
    setInterval(() => {
      fetch(`${url}/health`)
        .then(response => {
          console.log(`Keep-alive ping: ${response.status} at ${new Date().toISOString()}`);
        })
        .catch(error => {
          console.error('Keep-alive ping failed:', error.message);
        });
    }, 14 * 60 * 1000); // 14 minutes
  };

  // Start keep-alive after server starts
  setTimeout(keepAlive, 60000); // Wait 1 minute after startup
}

// Generate random 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send Email via Resend
const sendEmail = async (to, subject, html) => {
  try {
    const { data, error } = await resend.emails.send({
      from: `Alumconn <team@${process.env.RESEND_DOMAIN}>`,
      to: [to],
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('Resend error:', error);
      return { success: false, error: error.message };
    }

    console.log('Email sent successfully:', data);
    return { success: true, data };
  } catch (error) {
    console.error('Email sending failed:', error);
    return { success: false, error: error.message };
  }
};

// Input validation middleware
const validateEmail = (req, res, next) => {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Valid email is required'
    });
  }
  next();
};

const validateOTP = (req, res, next) => {
  const { email, otp } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Valid email is required'
    });
  }
  
  if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({
      success: false,
      error: 'Valid 6-digit OTP is required'
    });
  }
  
  next();
};

// Send Signup OTP
app.post('/api/otp/send-signup', otpLimiter, validateEmail, async (req, res) => {
  console.log('Received signup OTP request:', req.body.email);
  
  const { email } = req.body;
  const otp = generateOTP();
  const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
  
  // Store OTP
  otpStorage.set(`signup_${email}`, { otp, expiresAt });
  
  console.log(`Generated signup OTP for ${email}: ${otp}`);
  
  // Send email
  const emailResult = await sendEmail(
    email,
    'Alumconn - Verify Your Email',
    `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #03045e; margin: 0;">
          <a href="https://alumconn.in" style="color: #03045e; text-decoration: none;">Alumconn</a>
        </h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Alumni Connection Platform</p>
      </div>
      
      <div style="background: #f8fafc; border-radius: 10px; padding: 30px; margin: 20px 0;">
        <h2 style="color: #03045e; margin: 0 0 20px 0; text-align: center;">Welcome to Alumconn!</h2>
        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
          Thank you for signing up with Alumconn. To complete your registration, please verify your email address using the OTP below:
        </p>
        
        <div style="background: white; border: 2px dashed #03045e; border-radius: 10px; padding: 25px; text-align: center; margin: 25px 0;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Your verification code:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #03045e; font-family: 'Courier New', monospace;">
            ${otp}
          </div>
        </div>
        
        <div style="background: #fef3cd; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="color: #92400e; font-size: 14px; margin: 0;">
            ⏰ This OTP will expire in <strong>5 minutes</strong>. Please enter it promptly to verify your account.
          </p>
        </div>
         <!-- Visit Site Button -->
        <div style="text-align: center; margin: 25px 0;">
          <a href="https://alumconn.in" style="display: inline-block; background-color: #03045e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            🌐 Visit Alumconn.in
          </a>
        </div>
        
        <p style="color: #6b7280; font-size: 14px; line-height: 1.5;">
          If you didn't create an account with Alumconn, please ignore this email or contact our support team.
        </p>
      </div>
      
      <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0 0 10px 0;">
          This email was sent by Alumconn • Alumni Connection Platform
        </p>
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          <a href="https://alumconn.in" style="color: #03045e; text-decoration: none;">Visit our website</a> | 
          <a href="mailto:team@alumconn.in" style="color: #03045e; text-decoration: none;">Contact Support</a>
        </p>
      </div>
    </div>
    `
  );
  
  if (!emailResult.success) {
    console.error('Failed to send email:', emailResult.error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send email. Please try again.'
    });
  }
  
  res.json({
    success: true,
    message: 'OTP sent successfully to your email',
    expiresIn: 300
  });
});

// Send Reset OTP
app.post('/api/otp/send-reset', otpLimiter, validateEmail, async (req, res) => {
  console.log('Received reset OTP request:', req.body.email);
  
  const { email } = req.body;
  const otp = generateOTP();
  const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
  
  // Store OTP
  otpStorage.set(`reset_${email}`, { otp, expiresAt });
  
  console.log(`Generated reset OTP for ${email}: ${otp}`);
  
  // Send email
  const emailResult = await sendEmail(
    email,
    'Alumconn - Password Reset Request',
    `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #03045e; margin: 0;">
          <a href="https://alumconn.in" style="color: #03045e; text-decoration: none;">Alumconn</a>
        </h1>
        <p style="color: #6b7280; margin: 5px 0 0 0;">Alumni Connection Platform</p>
      </div>
      
      <div style="background: #f8fafc; border-radius: 10px; padding: 30px; margin: 20px 0;">
        <h2 style="color: #dc2626; margin: 0 0 20px 0; text-align: center;">Password Reset Request</h2>
        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
          We received a request to reset your password for your Alumconn account. Use the OTP below to proceed with password reset:
        </p>
        
        <div style="background: white; border: 2px dashed #dc2626; border-radius: 10px; padding: 25px; text-align: center; margin: 25px 0;">
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 10px 0;">Your reset code:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #dc2626; font-family: 'Courier New', monospace;">
            ${otp}
          </div>
        </div>
        
        <div style="background: #fef3cd; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="color: #92400e; font-size: 14px; margin: 0;">
            ⏰ This OTP will expire in <strong>5 minutes</strong>. Please use it promptly to reset your password.
          </p>
        </div>
        <!-- Visit Site Button -->
        <div style="text-align: center; margin: 25px 0;">
          <a href="https://alumconn.in" style="display: inline-block; background-color: #03045e; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
            🌐 Visit Alumconn.in
          </a>
        </div>
        
        <div style="background: #fee2e2; border-radius: 8px; padding: 15px; margin: 20px 0;">
          <p style="color: #991b1b; font-size: 14px; margin: 0;">
            🔒 If you didn't request a password reset, please ignore this email and your password will remain unchanged.
          </p>
        </div>
      </div>
      
      <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0 0 10px 0;">
          This email was sent by Alumconn • Alumni Connection Platform
        </p>
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          <a href="https://alumconn.in" style="color: #03045e; text-decoration: none;">Visit our website</a> | 
          <a href="mailto:team@alumconn.in" style="color: #03045e; text-decoration: none;">Contact Support</a>
        </p>
      </div>
    </div>
    `
  );
  
  if (!emailResult.success) {
    return res.status(500).json({
      success: false,
      error: 'Failed to send email. Please try again.'
    });
  }
  
  res.json({
    success: true,
    message: 'Reset OTP sent successfully to your email',
    expiresIn: 300
  });
});

// Verify Signup OTP
app.post('/api/otp/verify-signup', validateOTP, (req, res) => {
  console.log('Received verify signup request:', req.body.email);
  
  const { email, otp } = req.body;
  const storedData = otpStorage.get(`signup_${email}`);
  
  if (!storedData) {
    return res.status(400).json({
      success: false,
      error: 'OTP not found or expired. Please request a new one.'
    });
  }
  
  if (Date.now() > storedData.expiresAt) {
    otpStorage.delete(`signup_${email}`);
    return res.status(400).json({
      success: false,
      error: 'OTP has expired. Please request a new one.'
    });
  }
  
  if (storedData.otp !== otp) {
    return res.status(400).json({
      success: false,
      error: 'Invalid OTP. Please check and try again.'
    });
  }
  
  // Remove OTP after successful verification
  otpStorage.delete(`signup_${email}`);
  
  console.log(`Successfully verified signup OTP for ${email}`);
  
  res.json({
    success: true,
    message: 'Email verified successfully!'
  });
});

// Verify Reset OTP
app.post('/api/otp/verify-reset', validateOTP, (req, res) => {
  console.log('Received verify reset request:', req.body.email);
  
  const { email, otp } = req.body;
  const storedData = otpStorage.get(`reset_${email}`);
  
  if (!storedData) {
    return res.status(400).json({
      success: false,
      error: 'OTP not found or expired. Please request a new one.'
    });
  }
  
  if (Date.now() > storedData.expiresAt) {
    otpStorage.delete(`reset_${email}`);
    return res.status(400).json({
      success: false,
      error: 'OTP has expired. Please request a new one.'
    });
  }
  
  if (storedData.otp !== otp) {
    return res.status(400).json({
      success: false,
      error: 'Invalid OTP. Please check and try again.'
    });
  }
  
  // Remove OTP after successful verification
  otpStorage.delete(`reset_${email}`);
  
  console.log(`Successfully verified reset OTP for ${email}`);
  
  res.json({
    success: true,
    message: 'Reset OTP verified successfully!'
  });
});

// Enhanced health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    resendConfigured: !!process.env.RESEND_API_KEY,
    memoryUsage: process.memoryUsage(),
    activeOTPs: otpStorage.size
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend server running on http://0.0.0.0:${PORT}`);
  console.log(`📱 Network access: http://10.156.20.137:${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('\n📋 Available endpoints:');
  console.log('- GET  /health');
  console.log('- GET  /api/health');
  console.log('- POST /api/otp/send-signup');
  console.log('- POST /api/otp/send-reset');
  console.log('- POST /api/otp/verify-signup');
  console.log('- POST /api/otp/verify-reset');
  
  console.log('\n🔧 Environment variables:');
  console.log('- RESEND_API_KEY:', process.env.RESEND_API_KEY ? '✅ Set' : '❌ Not set');
  console.log('- RESEND_DOMAIN:', process.env.RESEND_DOMAIN || '❌ Not set');
  console.log('- FROM_EMAIL:', process.env.FROM_EMAIL || '❌ Not set');
  
  if (process.env.NODE_ENV === 'production') {
    console.log('\n🔄 Keep-alive service will start in 1 minute');
  }
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});