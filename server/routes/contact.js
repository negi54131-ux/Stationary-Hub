const express = require("express");
const db = require("../db/database");

const router = express.Router();

// POST /api/contact — Submit a contact message
router.post("/", (req, res) => {
    try {
        const { name, email, subject, message } = req.body;

        if (!name || !email || !message) {
            return res.status(400).json({ success: false, message: "Name, email, and message are required." });
        }

        db.prepare(`
      INSERT INTO contact_messages (name, email, subject, message)
      VALUES (?, ?, ?, ?)
    `).run(name.trim(), email.toLowerCase().trim(), subject || "", message.trim());

        res.status(201).json({
            success: true,
            message: "Thank you for contacting us. We'll get back to you soon."
        });
    } catch (err) {
        console.error("Contact error:", err);
        res.status(500).json({ success: false, message: "Error sending message." });
    }
});

module.exports = router;
