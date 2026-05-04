const jwt = require('jsonwebtoken');
require('dotenv').config();

const authenticate = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (err) {
        // 401 = token expired or invalid (triggers logout on frontend)
        res.status(401).json({ success: false, message: 'Session expired, please login again' });
    }
};

const authorize = (...roles) => (req, res, next) => {
    if (!roles.includes(req.user.role))
        // 403 = logged in but not allowed (do NOT trigger logout)
        return res.status(403).json({ success: false, message: `Access denied. Requires: ${roles.join(' or ')}` });
    next();
};

module.exports = { authenticate, authorize };
