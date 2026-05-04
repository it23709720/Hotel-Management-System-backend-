const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, LoginLog } = require('../models');
const { authenticate, authorize } = require('../middleware/auth');

// Get all users
router.get('/', authenticate, authorize('admin'), async (req, res) => {
    try {
        const users = await User.find({}, '-password').sort('-createdAt');
        res.json({ success: true, data: users });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Create user
router.post('/', authenticate, authorize('admin'), async (req, res) => {
    try {
        const user = new User(req.body);
        await user.save();
        res.json({ success: true, message: 'User created', id: user._id });
    } catch (err) {
        if (err.code === 11000) return res.status(400).json({ success: false, message: 'Username or email already exists' });
        res.status(500).json({ success: false, message: err.message });
    }
});

// Update user
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { full_name, email, username, role, is_active } = req.body;
        // Check if username/email already taken by another user
        if (email) {
            const existing = await User.findOne({ email, _id: { $ne: req.params.id } });
            if (existing) return res.status(400).json({ success: false, message: 'Email already used by another user' });
        }
        if (username) {
            const existing = await User.findOne({ username, _id: { $ne: req.params.id } });
            if (existing) return res.status(400).json({ success: false, message: 'Username already taken' });
        }
        await User.findByIdAndUpdate(req.params.id, { full_name, email, username, role, is_active });
        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Reset password
router.put('/:id/reset-password', authenticate, authorize('admin'), async (req, res) => {
    try {
        const hashed = await bcrypt.hash(req.body.new_password, 10);
        await User.findByIdAndUpdate(req.params.id, { password: hashed });
        res.json({ success: true, message: 'Password reset' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Deactivate user
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
    try {
        if (req.params.id === req.user.id)
            return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });
        await User.findByIdAndUpdate(req.params.id, { is_active: false });
        res.json({ success: true, message: 'User deactivated' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Permanent delete user
router.delete('/:id/permanent', authenticate, authorize('admin'), async (req, res) => {
    try {
        if (req.params.id === String(req.user.id))
            return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.is_active)
            return res.status(400).json({ success: false, message: 'Deactivate user first before deleting' });
        await User.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'User permanently deleted' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// Weekly login report
router.get('/login-report', authenticate, authorize('admin'), async (req, res) => {
    try {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const logs = await LoginLog.find({ login_time: { $gte: since } })
            .populate('user_id', 'full_name username role')
            .sort('-login_time');
        res.json({ success: true, data: logs });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;
