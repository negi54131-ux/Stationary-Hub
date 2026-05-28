const express = require("express");
const db = require("../db/database");

const router = express.Router();

// POST /api/newsletter — Subscribe to newsletter
router.post("/", (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required." });
        }

        // Simple email validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: "Please enter a valid email address." });
        }

        const existing = db.prepare("SELECT * FROM newsletter_subscribers WHERE email = ?").get(email.toLowerCase());
        if (existing) {
            if (existing.active) {
                return res.json({ success: true, message: "You're already subscribed!" });
            }
            // Re-activate
            db.prepare("UPDATE newsletter_subscribers SET active = 1 WHERE email = ?").run(email.toLowerCase());
            return res.json({ success: true, message: "Welcome back! Your subscription is re-activated." });
        }

        db.prepare("INSERT INTO newsletter_subscribers (email) VALUES (?)").run(email.toLowerCase().trim());

        res.status(201).json({
            success: true,
            message: "Welcome aboard! You'll receive our weekly drops."
        });
    } catch (err) {
        console.error("Newsletter error:", err);
        res.status(500).json({ success: false, message: "Error subscribing to newsletter." });
    }
});

// DELETE /api/newsletter — Unsubscribe
router.delete("/", (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ success: false, message: "Email is required." });
        }

        db.prepare("UPDATE newsletter_subscribers SET active = 0 WHERE email = ?").run(email.toLowerCase());
        res.json({ success: true, message: "You have been unsubscribed." });
    } catch (err) {
        console.error("Unsubscribe error:", err);
        res.status(500).json({ success: false, message: "Error unsubscribing." });
    }
});

module.exports = router;
