const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db/database");
const { generateToken } = require("../middleware/auth");

const router = express.Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
    try {
        const { name, email, password, phone } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: "Name, email, and password are required." });
        }

        if (password.length < 6) {
            return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
        }

        // Check existing user
        const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
        if (existing) {
            return res.status(409).json({ success: false, message: "An account with this email already exists." });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = crypto.randomUUID();

        db.prepare(`
      INSERT INTO users (id, name, email, password, phone) 
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, name.trim(), email.toLowerCase().trim(), hashedPassword, phone || "");

        const token = generateToken({ id: userId, email: email.toLowerCase(), name: name.trim(), role: "customer" });

        res.status(201).json({
            success: true,
            message: "Account created successfully.",
            token,
            user: { id: userId, name: name.trim(), email: email.toLowerCase(), role: "customer" }
        });
    } catch (err) {
        console.error("Register error:", err);
        res.status(500).json({ success: false, message: "Server error during registration." });
    }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: "Email and password are required." });
        }

        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
        if (!user) {
            return res.status(401).json({ success: false, message: "Invalid email or password." });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ success: false, message: "Invalid email or password." });
        }

        const token = generateToken({ id: user.id, email: user.email, name: user.name, role: user.role });

        res.json({
            success: true,
            message: "Login successful.",
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role }
        });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ success: false, message: "Server error during login." });
    }
});

// GET /api/auth/me
router.get("/me", (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    const user = db.prepare("SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?").get(req.user.id);
    if (!user) {
        return res.status(404).json({ success: false, message: "User not found." });
    }

    res.json({ success: true, user });
});

// PUT /api/auth/profile
router.put("/profile", (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    const { name, phone } = req.body;
    const updates = [];
    const values = [];

    if (name) { updates.push("name = ?"); values.push(name.trim()); }
    if (phone !== undefined) { updates.push("phone = ?"); values.push(phone); }

    if (!updates.length) {
        return res.status(400).json({ success: false, message: "No fields to update." });
    }

    updates.push("updated_at = datetime('now')");
    values.push(req.user.id);

    db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const user = db.prepare("SELECT id, name, email, phone, role FROM users WHERE id = ?").get(req.user.id);
    res.json({ success: true, message: "Profile updated.", user });
});

// PUT /api/auth/password
router.put("/password", async (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Not authenticated." });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ success: false, message: "Current and new passwords are required." });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ success: false, message: "New password must be at least 6 characters." });
    }

    const user = db.prepare("SELECT password FROM users WHERE id = ?").get(req.user.id);
    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
        return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    db.prepare("UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?").run(hashed, req.user.id);

    res.json({ success: true, message: "Password changed successfully." });
});

module.exports = router;
