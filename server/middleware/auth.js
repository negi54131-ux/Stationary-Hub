const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "stationery-hub-secret-key-change-in-production";

if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
    console.warn("[Security] JWT_SECRET is not set. Please set a strong secret in production.");
}
const JWT_EXPIRES_IN = "7d";

function generateToken(payload) {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch {
        return null;
    }
}

// Attach user to request if valid token present
function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

    if (token) {
        const decoded = verifyToken(token);
        if (decoded) {
            req.user = decoded;
        }
    }
    next();
}

// Require authentication
function requireAuth(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Authentication required. Please login." });
    }
    next();
}

// Require admin role
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Admin access required." });
    }
    next();
}

// Require supplier role
function requireSupplier(req, res, next) {
    if (!req.user || req.user.role !== "supplier") {
        return res.status(403).json({ success: false, message: "Supplier access required." });
    }
    next();
}

module.exports = {
    JWT_SECRET,
    generateToken,
    verifyToken,
    authMiddleware,
    requireAuth,
    requireAdmin,
    requireSupplier
};
