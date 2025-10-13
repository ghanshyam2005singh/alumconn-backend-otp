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

// ...existing code...

// Send Signup OTP - Professional email template
app.post('/api/otp/send-signup', otpLimiter, validateEmail, async (req, res) => {
  console.log('Received signup OTP request:', req.body.email);
  
  const { email } = req.body;
  const otp = generateOTP();
  const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
  
  // Store OTP
  otpStorage.set(`signup_${email}`, { otp, expiresAt });
  
  console.log(`Generated signup OTP for ${email}: ${otp}`);
  
  // Professional email template
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
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); overflow: hidden; max-width: 600px; width: 100%;">
              
              <!-- Header with Brand -->
              <tr>
                <td style="background: linear-gradient(135deg, #03045e 0%, #023e8a 100%); padding: 40px 40px 30px 40px; text-align: center;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="text-align: center;">
                        <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">
                          <a href="https://alumconn.in" style="color: #ffffff; text-decoration: none;">Alumconn</a>
                        </h1>
                        <p style="margin: 8px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 16px; font-weight: 500;">Alumni Connection Platform</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Main Content -->
              <tr>
                <td style="padding: 50px 40px;">
                  
                  <!-- Welcome Section -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="text-align: center; padding-bottom: 30px;">
                        <div style="display: inline-block; width: 60px; height: 60px; background: linear-gradient(135deg, #03045e 0%, #023e8a 100%); border-radius: 50%; margin-bottom: 20px; position: relative;">
                          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 24px;">🎓</div>
                        </div>
                        <h2 style="margin: 0 0 10px 0; color: #1a202c; font-size: 28px; font-weight: 700; line-height: 1.2;">Welcome to Alumconn!</h2>
                        <p style="margin: 0; color: #4a5568; font-size: 18px; line-height: 1.5;">Join thousands of alumni connecting worldwide</p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Description -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                    <tr>
                      <td style="padding: 0 0 30px 0;">
                        <p style="margin: 0; color: #2d3748; font-size: 16px; line-height: 1.6; text-align: center;">
                          We're excited to have you join our community! To complete your registration and secure your account, please verify your email address using the verification code below.
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- OTP Card -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                    <tr>
                      <td style="text-align: center;">
                        <div style="background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%); border: 2px solid #e2e8f0; border-radius: 12px; padding: 30px; margin: 20px 0; position: relative; overflow: hidden;">
                          <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #03045e, #023e8a, #0077b6, #023e8a, #03045e); animation: shimmer 2s ease-in-out infinite;"></div>
                          <p style="margin: 0 0 15px 0; color: #4a5568; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Verification Code</p>
                          <div style="font-family: 'Courier New', Monaco, monospace; font-size: 36px; font-weight: 700; color: #03045e; letter-spacing: 12px; margin: 10px 0; text-shadow: 0 2px 4px rgba(3, 4, 94, 0.1);">
                            ${otp}
                          </div>
                          <p style="margin: 15px 0 0 0; color: #718096; font-size: 13px;">Enter this code in the verification field</p>
                        </div>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Timer Alert -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                    <tr>
                      <td>
                        <div style="background: linear-gradient(135deg, #fff5b4 0%, #fed7aa 100%); border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
                          <div style="display: flex; align-items: center;">
                            <span style="font-size: 20px; margin-right: 12px;">⏰</span>
                            <div>
                              <p style="margin: 0; color: #92400e; font-size: 15px; font-weight: 600;">
                                <strong>Time Sensitive:</strong> This code expires in 5 minutes
                              </p>
                              <p style="margin: 5px 0 0 0; color: #b45309; font-size: 14px;">
                                For your security, please complete verification promptly.
                              </p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- CTA Button -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0 30px 0;">
                    <tr>
                      <td style="text-align: center;">
                        <a href="https://alumconn.in" style="display: inline-block; background: linear-gradient(135deg, #03045e 0%, #023e8a 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(3, 4, 94, 0.2); transition: all 0.3s ease;">
                          <span style="margin-right: 8px;">🌐</span>
                          Continue to Alumconn
                        </a>
                        <p style="margin: 20px 0 0 0; color: #718096; font-size: 14px;">
                          Or visit: <a href="https://alumconn.in" style="color: #03045e; text-decoration: none; font-weight: 600;">alumconn.in</a>
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                </td>
              </tr>
              
              <!-- Security Notice -->
              <tr>
                <td style="background-color: #f7fafc; padding: 30px 40px; border-top: 1px solid #e2e8f0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="text-align: center;">
                        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
                          <p style="margin: 0 0 10px 0; color: #2d3748; font-size: 15px; font-weight: 600;">
                            <span style="margin-right: 8px;">🔒</span>Security Notice
                          </p>
                          <p style="margin: 0; color: #4a5568; font-size: 14px; line-height: 1.5;">
                            We never ask for your verification code via phone or email. If you didn't request this verification, please ignore this message or contact our security team.
                          </p>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #2d3748; padding: 40px 40px 30px 40px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="text-align: center;">
                        <h3 style="margin: 0 0 20px 0; color: #ffffff; font-size: 18px; font-weight: 600;">Stay Connected</h3>
                        <div style="margin: 20px 0;">
                          <a href="https://alumconn.in" style="display: inline-block; margin: 0 15px; color: #90cdf4; text-decoration: none; font-size: 14px; font-weight: 500;">Website</a>
                          <span style="color: #4a5568;">|</span>
                          <a href="mailto:team@alumconn.in" style="display: inline-block; margin: 0 15px; color: #90cdf4; text-decoration: none; font-size: 14px; font-weight: 500;">Support</a>
                          <span style="color: #4a5568;">|</span>
                          <a href="https://alumconn.in/privacy" style="display: inline-block; margin: 0 15px; color: #90cdf4; text-decoration: none; font-size: 14px; font-weight: 500;">Privacy</a>
                        </div>
                        <div style="margin: 25px 0 15px 0; padding-top: 20px; border-top: 1px solid #4a5568;">
                          <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.4;">
                            <strong>Alumconn</strong> - Connecting Alumni Worldwide<br>
                            Building bridges between past, present, and future generations.
                          </p>
                        </div>
                        <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 12px;">
                          © 2024 Alumconn. All rights reserved. | This email was sent to ${email}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
            </table>
            
            <!-- Email Client Compatibility -->
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; margin-top: 20px;">
              <tr>
                <td style="text-align: center; padding: 20px;">
                  <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                    Having trouble viewing this email? <a href="https://alumconn.in" style="color: #03045e;">View in browser</a>
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

// Send Reset OTP - Professional email template
app.post('/api/otp/send-reset', otpLimiter, validateEmail, async (req, res) => {
  console.log('Received reset OTP request:', req.body.email);
  
  const { email } = req.body;
  const otp = generateOTP();
  const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes
  
  // Store OTP
  otpStorage.set(`reset_${email}`, { otp, expiresAt });
  
  console.log(`Generated reset OTP for ${email}: ${otp}`);
  
  // Professional password reset email template
  const emailResult = await sendEmail(
    email,
    'Alumconn - Secure Password Reset Request',
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
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); overflow: hidden; max-width: 600px; width: 100%;">
              
              <!-- Header with Brand -->
              <tr>
                <td style="background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); padding: 40px 40px 30px 40px; text-align: center;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="text-align: center;">
                        <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">
                          <a href="https://alumconn.in" style="color: #ffffff; text-decoration: none;">Alumconn</a>
                        </h1>
                        <p style="margin: 8px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 16px; font-weight: 500;">Alumni Connection Platform</p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Main Content -->
              <tr>
                <td style="padding: 50px 40px;">
                  
                  <!-- Security Alert Section -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="text-align: center; padding-bottom: 30px;">
                        <div style="display: inline-block; width: 60px; height: 60px; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); border-radius: 50%; margin-bottom: 20px; position: relative;">
                          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 24px;">🔐</div>
                        </div>
                        <h2 style="margin: 0 0 10px 0; color: #1a202c; font-size: 28px; font-weight: 700; line-height: 1.2;">Password Reset Request</h2>
                        <p style="margin: 0; color: #4a5568; font-size: 18px; line-height: 1.5;">Secure your account with a new password</p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Description -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                    <tr>
                      <td style="padding: 0 0 30px 0;">
                        <p style="margin: 0; color: #2d3748; font-size: 16px; line-height: 1.6; text-align: center;">
                          We received a request to reset your Alumconn account password. Use the secure verification code below to proceed with resetting your password.
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- OTP Card -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                    <tr>
                      <td style="text-align: center;">
                        <div style="background: linear-gradient(135def, #fef2f2 0%, #fee2e2 100%); border: 2px solid #fca5a5; border-radius: 12px; padding: 30px; margin: 20px 0; position: relative; overflow: hidden;">
                          <div style="position: absolute; top: 0; left: 0; right: 0; height: 4px; background: linear-gradient(90deg, #dc2626, #b91c1c, #ef4444, #b91c1c, #dc2626);"></div>
                          <p style="margin: 0 0 15px 0; color: #7f1d1d; font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">Reset Verification Code</p>
                          <div style="font-family: 'Courier New', Monaco, monospace; font-size: 36px; font-weight: 700; color: #dc2626; letter-spacing: 12px; margin: 10px 0; text-shadow: 0 2px 4px rgba(220, 38, 38, 0.1);">
                            ${otp}
                          </div>
                          <p style="margin: 15px 0 0 0; color: #991b1b; font-size: 13px;">Use this code to reset your password</p>
                        </div>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- Timer Alert -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 25px 0;">
                    <tr>
                      <td>
                        <div style="background: linear-gradient(135deg, #fff5b4 0%, #fed7aa 100%); border-left: 4px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
                          <div style="display: flex; align-items: center;">
                            <span style="font-size: 20px; margin-right: 12px;">⏰</span>
                            <div>
                              <p style="margin: 0; color: #92400e; font-size: 15px; font-weight: 600;">
                                <strong>Security Timer:</strong> Code expires in 5 minutes
                              </p>
                              <p style="margin: 5px 0 0 0; color: #b45309; font-size: 14px;">
                                Complete the password reset process promptly for security.
                              </p>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  </table>
                  
                  <!-- CTA Button -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin: 40px 0 30px 0;">
                    <tr>
                      <td style="text-align: center;">
                        <a href="https://alumconn.in" style="display: inline-block; background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 600; font-size: 16px; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);">
                          <span style="margin-right: 8px;">🔒</span>
                          Reset Password Now
                        </a>
                        <p style="margin: 20px 0 0 0; color: #718096; font-size: 14px;">
                          Or visit: <a href="https://alumconn.in" style="color: #dc2626; text-decoration: none; font-weight: 600;">alumconn.in</a>
                        </p>
                      </td>
                    </tr>
                  </table>
                  
                </td>
              </tr>
              
              <!-- Security Notices -->
              <tr>
                <td style="background-color: #f7fafc; padding: 30px 40px; border-top: 1px solid #e2e8f0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <!-- Security Notice -->
                        <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                          <p style="margin: 0 0 10px 0; color: #2d3748; font-size: 15px; font-weight: 600;">
                            <span style="margin-right: 8px;">🔒</span>Security Notice
                          </p>
                          <p style="margin: 0; color: #4a5568; font-size: 14px; line-height: 1.5;">
                            We never ask for your reset code via phone or email. If you didn't request this reset, please ignore this message and contact our security team immediately.
                          </p>
                        </div>
                        
                        <!-- Not You Alert -->
                        <div style="background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%); border: 1px solid #f87171; border-radius: 8px; padding: 20px;">
                          <p style="margin: 0 0 10px 0; color: #7f1d1d; font-size: 15px; font-weight: 600;">
                            <span style="margin-right: 8px;">⚠️</span>Didn't Request This?
                          </p>
                          <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.5;">
                            If you didn't request a password reset, your account may be at risk. Please <a href="mailto:security@alumconn.in" style="color: #dc2626; font-weight: 600;">contact our security team</a> immediately.
                          </p>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="background-color: #2d3748; padding: 40px 40px 30px 40px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="text-align: center;">
                        <h3 style="margin: 0 0 20px 0; color: #ffffff; font-size: 18px; font-weight: 600;">Need Help?</h3>
                        <div style="margin: 20px 0;">
                          <a href="https://alumconn.in" style="display: inline-block; margin: 0 15px; color: #90cdf4; text-decoration: none; font-size: 14px; font-weight: 500;">Website</a>
                          <span style="color: #4a5568;">|</span>
                          <a href="mailto:support@alumconn.in" style="display: inline-block; margin: 0 15px; color: #90cdf4; text-decoration: none; font-size: 14px; font-weight: 500;">Support</a>
                          <span style="color: #4a5568;">|</span>
                          <a href="mailto:security@alumconn.in" style="display: inline-block; margin: 0 15px; color: #f87171; text-decoration: none; font-size: 14px; font-weight: 500;">Security</a>
                        </div>
                        <div style="margin: 25px 0 15px 0; padding-top: 20px; border-top: 1px solid #4a5568;">
                          <p style="margin: 0; color: #9ca3af; font-size: 13px; line-height: 1.4;">
                            <strong>Alumconn Security Team</strong><br>
                            Protecting your account and personal information 24/7.
                          </p>
                        </div>
                        <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 12px;">
                          © 2024 Alumconn. All rights reserved. | This security email was sent to ${email}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
            </table>
            
            <!-- Email Client Compatibility -->
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%; margin-top: 20px;">
              <tr>
                <td style="text-align: center; padding: 20px;">
                  <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                    Having trouble? <a href="https://alumconn.in/support" style="color: #dc2626;">Contact Security Support</a>
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