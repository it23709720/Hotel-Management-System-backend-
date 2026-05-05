import { Router } from 'express';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { User, Client, LoginLog } from '../models/index.js';
import { authenticate } from '../middleware/auth.js';
import 'dotenv/config';

const router = Router();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    tls: { rejectUnauthorized: false }
});

// OTP store in memory
const otpStore = {};

// ── Staff Login Step 1 - Send OTP ──
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password)
            return res.status(400).json({ success: false, message: 'Username and password required' });

        const user = await User.findOne({ username, is_active: true });
        if (!user || !(await user.comparePassword(password)))
            return res.status(401).json({ success: false, message: 'Invalid credentials' });

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        otpStore[user._id] = { otp, expires: Date.now() + 5 * 60 * 1000 }; // 5 minutes

        // Send styled OTP email
        try {
            await transporter.sendMail({
                from: `"Grand Azure Hotel" <${process.env.EMAIL_USER}>`,
                to: user.email,
                subject: 'Your Login OTP — Grand Azure Hotel',
                html: `
                <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e0e0e0;border-radius:10px;overflow:hidden">
                  <div style="background:#0D1B2A;padding:24px;text-align:center">
                    <h1 style="color:#C9A84C;margin:0;font-size:22px">Grand Azure Hotel</h1>
                    <p style="color:rgba(255,255,255,0.6);margin:6px 0 0;font-size:13px">Staff Login Verification</p>
                  </div>
                  <div style="padding:32px;text-align:center">
                    <p style="font-size:16px;color:#333">Hello <strong>${user.full_name}</strong>,</p>
                    <p style="color:#666;font-size:14px">Use the OTP below to complete your login.</p>
                    <div style="background:#F8F9FA;border:2px dashed #C9A84C;border-radius:12px;padding:24px;margin:24px 0;display:inline-block;width:80%">
                      <div style="font-size:42px;font-weight:700;letter-spacing:12px;color:#0D1B2A">${otp}</div>
                      <p style="color:#999;font-size:12px;margin:8px 0 0">Valid for <strong>5 minutes</strong></p>
                    </div>
                    <p style="color:#e74c3c;font-size:13px">⚠️ Do not share this OTP with anyone.</p>
                    <p style="color:#999;font-size:12px">If you did not request this, please ignore this email.</p>
                  </div>
                  <div style="background:#f8f9fa;padding:14px;text-align:center;font-size:12px;color:#999;border-top:1px solid #e0e0e0">
                    Grand Azure Hotel | support@grandazure.com
                  </div>
                </div>`
            });
            console.log(`OTP email sent to ${user.email}`);
        } catch (e) {
            console.log('Email failed:', e.message);
            // Still allow login but log the OTP for development
            console.log(`[DEV] OTP for ${username}: ${otp}`);
        }

        res.json({
            success: true,
            requireOTP: true,
            userId: user._id,
            email: user.email.replace(/(.{2})(.*)(@.*)/, '$1***$3'), // masked email
            message: `OTP sent to your email`
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Staff Login Step 2 - Verify OTP ──
router.post('/verify-otp', async (req, res) => {
    try {
        const { userId, otp } = req.body;
        const stored = otpStore[userId];

        if (!stored || Date.now() > stored.expires)
            return res.status(400).json({ success: false, message: 'OTP has expired. Please login again.' });
        if (stored.otp !== otp.toString())
            return res.status(400).json({ success: false, message: 'Incorrect OTP. Please try again.' });

        delete otpStore[userId];
        const user = await User.findById(userId);

        await LoginLog.create({ user_id: user._id, user_type: 'staff', ip_address: req.ip });

        const token = jwt.sign(
            { id: user._id, username: user.username, role: user.role, type: 'staff' },
            process.env.JWT_SECRET, { expiresIn: '24h' }
        );

        res.json({
            success: true, token,
            user: { id: user._id, username: user.username, full_name: user.full_name, role: user.role, email: user.email }
        });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Client Register ──
router.post('/client/register', async (req, res) => {
    try {
        const { username, password, full_name, email, phone, id_type, id_number } = req.body;
        const client = new Client({ username, password, full_name, email, phone, id_type, id_number });
        await client.save();
        res.json({ success: true, message: 'Account created successfully' });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ success: false, message: 'Username or email already exists' });
        res.status(500).json({ success: false, message: err.message });
    }
});

// ── Client Login ──
router.post('/client/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const client = await Client.findOne({ username, is_active: true });
        if (!client || !(await client.comparePassword(password)))
            return res.status(401).json({ success: false, message: 'Invalid credentials' });

        const token = jwt.sign(
            { id: client._id, username: client.username, role: 'client', type: 'client' },
            process.env.JWT_SECRET, { expiresIn: '24h' }
        );
        res.json({ success: true, token, user: { id: client._id, username: client.username, full_name: client.full_name, email: client.email, role: 'client' } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── Logout ──
router.post('/logout', authenticate, async (req, res) => {
    try {
        if (req.user.type === 'staff') {
            await LoginLog.findOneAndUpdate(
                { user_id: req.user.id, logout_time: null },
                { logout_time: new Date() },
                { sort: { login_time: -1 } }
            );
        }
        res.json({ success: true, message: 'Logged out' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
