const express = require("express");
const db = require("../db/database");

const router = express.Router();

// POST /api/support — Submit a support ticket
router.post("/", (req, res) => {
    try {
        const { name, email, orderId, subject, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({ success: false, message: "Name, email, and message are required." });
        }

        const userId = req.user?.id || null;

        const result = db.prepare(`
      INSERT INTO support_tickets (user_id, name, email, order_id, subject, message)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, name.trim(), email.toLowerCase().trim(), orderId || "", subject || "", message.trim());

        res.status(201).json({
            success: true,
            message: "Support ticket submitted. We'll respond within 2 hours.",
            ticketId: result.lastInsertRowid
        });
    } catch (err) {
        console.error("Support ticket error:", err);
        res.status(500).json({ success: false, message: "Error submitting support ticket." });
    }
});

// GET /api/support — Get user's tickets
router.get("/", (req, res) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: "Login to view your tickets." });
    }

    try {
        const tickets = db.prepare(
            "SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC"
        ).all(req.user.id);

        res.json({ success: true, tickets });
    } catch (err) {
        console.error("Tickets fetch error:", err);
        res.status(500).json({ success: false, message: "Error fetching tickets." });
    }
});

module.exports = router;
