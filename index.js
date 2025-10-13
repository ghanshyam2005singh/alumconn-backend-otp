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
        'exp://10.156.20.137:8081',
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

// Send Signup OTP - Clean, professional email template
app.post('/api/otp/send-signup', otpLimiter, validateEmail, async (req, res) => {
  console.log('Received signup OTP request:', req.body.email);
  
  const { email } = req.body;
  const otp = generateOTP();
  const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
  
  // Store OTP
  otpStorage.set(`signup_${email}`, { otp, expiresAt });
  
  console.log(`Generated signup OTP for ${email}: ${otp}`);
  
  // Clean, professional email template
  const emailResult = await sendEmail(
    email,
    'Welcome to Alumconn - Verify Your Email Address',
    `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to Alumconn</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; line-height: 1.6;">
      
      <!-- Main Container -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 0;">
        <tr>
          <td align="center">
            
            <!-- Email Card -->
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); overflow: hidden; max-width: 600px; width: 100%;">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #03045e 0%, #023e8a 100%); padding: 40px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">
                    <a href="https://alumconn.in" style="color: #ffffff; text-decoration: none;">Alumconn</a>
                  </h1>
                  <p style="margin: 8px 0 0 0; color: rgba(255, 255, 255, 0.8); font-size: 14px;">Your College Community Platform</p>
                </td>
              </tr>
              
              <!-- Main Content -->
              <tr>
                <td style="padding: 40px;">
                  
                  <!-- Welcome Message -->
                  <h2 style="margin: 0 0 24px 0; color: #1a202c; font-size: 24px; font-weight: 600; line-height: 1.3;">
                    Welcome to Alumconn
                  </h2>
                  
                  <p style="margin: 0 0 24px 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
                    Thank you for signing up. To complete your registration, please verify your email address by entering the verification code below.
                  </p>
                  
                  <!-- OTP Section -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 32px 0;">
                    <tr>
                      <td style="text-align: center; padding: 24px; background-color: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <p style="margin: 0 0 12px 0; color: #718096; font-size: 14px; font-weight: 500;">
                          Your verification code
                        </p>
                        <div style="font-family: 'Courier New', Monaco, monospace; font-size: 32px; font-weight: 700; color: #03045e; letter-spacing: 8px; margin: 8px 0;">
                          ${otp}
                        </div>
                        <p style="margin: 12px 0 0 0; color: #a0aec0; font-size: 13px;">
                          This code will expire in 5 minutes
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Continue Button -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 32px 0;">
                    <tr>
                      <td style="text-align: center;">
                        <a href="https://alumconn.in" style="display: inline-block; background-color: #03045e; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                          Continue to Alumconn
                        </a>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Help Text -->
                  <p style="margin: 24px 0 0 0; color: #718096; font-size: 14px; line-height: 1.5;">
                    If you didn't create an account, you can safely ignore this email.
                  </p>
                  
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f7fafc; padding: 32px; border-top: 1px solid #e2e8f0; text-align: center;">
                  <p style="margin: 0 0 8px 0; color: #a0aec0; font-size: 12px;">
                    This email was sent by Alumconn
                  </p>
                  <p style="margin: 0; color: #a0aec0; font-size: 12px;">
                    <a href="https://alumconn.in" style="color: #03045e; text-decoration: none;">Visit Website</a> | 
                    <a href="mailto:team@alumconn.in" style="color: #03045e; text-decoration: none;">Support</a>
                  </p>
                </td>
              </tr>
              
            </table>
            
          </td>
        </tr>
      </table>
      
    </body>
    </html>
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

// Send Reset OTP - Clean, professional email template
app.post('/api/otp/send-reset', otpLimiter, validateEmail, async (req, res) => {
  console.log('Received reset OTP request:', req.body.email);
  
  const { email } = req.body;
  const otp = generateOTP();
  const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
  
  // Store OTP
  otpStorage.set(`reset_${email}`, { otp, expiresAt });
  
  console.log(`Generated reset OTP for ${email}: ${otp}`);
  
  // Clean, professional password reset email template
  const emailResult = await sendEmail(
    email,
    'Alumconn - Password Reset Verification',
    `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset - Alumconn</title>
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f8fafc; line-height: 1.6;">
      
      <!-- Main Container -->
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8fafc; padding: 40px 0;">
        <tr>
          <td align="center">
            
            <!-- Email Card -->
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05); overflow: hidden; max-width: 600px; width: 100%;">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #03045e 0%, #023e8a 100%); padding: 40px; text-align: center;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600; letter-spacing: -0.5px;">
                    <a href="https://alumconn.in" style="color: #ffffff; text-decoration: none;">Alumconn</a>
                  </h1>
                  <p style="margin: 8px 0 0 0; color: rgba(255, 255, 255, 0.8); font-size: 14px;">Your College Community Platform</p>
                </td>
              </tr>
              
              <!-- Main Content -->
              <tr>
                <td style="padding: 40px;">
                  
                  <!-- Reset Message -->
                  <h2 style="margin: 0 0 24px 0; color: #1a202c; font-size: 24px; font-weight: 600; line-height: 1.3;">
                    Password Reset Request
                  </h2>
                  
                  <p style="margin: 0 0 24px 0; color: #4a5568; font-size: 16px; line-height: 1.6;">
                    We received a request to reset your password. Use the verification code below to proceed with resetting your password.
                  </p>
                  
                  <!-- OTP Section -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 32px 0;">
                    <tr>
                      <td style="text-align: center; padding: 24px; background-color: #fef5e7; border: 1px solid #f6ad55; border-radius: 8px;">
                        <p style="margin: 0 0 12px 0; color: #c05621; font-size: 14px; font-weight: 500;">
                          Password reset code
                        </p>
                        <div style="font-family: 'Courier New', Monaco, monospace; font-size: 32px; font-weight: 700; color: #c05621; letter-spacing: 8px; margin: 8px 0;">
                          ${otp}
                        </div>
                        <p style="margin: 12px 0 0 0; color: #c05621; font-size: 13px;">
                          This code will expire in 5 minutes
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Continue Button -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 32px 0;">
                    <tr>
                      <td style="text-align: center;">
                        <a href="https://alumconn.in" style="display: inline-block; background-color: #03045e; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
                          Reset Password
                        </a>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Security Notice -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 24px 0;">
                    <tr>
                      <td style="padding: 16px; background-color: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px;">
                        <p style="margin: 0; color: #0c4a6e; font-size: 14px; line-height: 1.5;">
                          <strong>Security Notice:</strong> If you didn't request this password reset, please ignore this email. Your password will remain unchanged.
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #f7fafc; padding: 32px; border-top: 1px solid #e2e8f0; text-align: center;">
                  <p style="margin: 0 0 8px 0; color: #a0aec0; font-size: 12px;">
                    This email was sent by Alumconn
                  </p>
                  <p style="margin: 0; color: #a0aec0; font-size: 12px;">
                    <a href="https://alumconn.in" style="color: #03045e; text-decoration: none;">Visit Website</a> | 
                    <a href="mailto:team@alumconn.in" style="color: #03045e; text-decoration: none;">Support</a>
                  </p>
                </td>
              </tr>
              
            </table>
            
          </td>
        </tr>
      </table>
      
    </body>
    </html>
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