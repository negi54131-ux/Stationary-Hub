const express = require("express");
const db = require("../db/database");

const router = express.Router();

// POST /api/bulk — Submit a bulk quote request
router.post("/", (req, res) => {
    try {
        const { name, email, organization, quantity, notes } = req.body;

        if (!name || !email) {
            return res.status(400).json({ success: false, message: "Name and email are required." });
        }

        if (quantity && Number(quantity) < 2) {
            return res.status(400).json({ success: false, message: "Minimum quantity is 2 units." });
        }

        db.prepare(`
      INSERT INTO bulk_requests (name, email, organization, quantity, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(name.trim(), email.toLowerCase().trim(), organization || "", Number(quantity) || 0, notes || "");

        res.status(201).json({
            success: true,
            message: "Bulk quote request submitted! We'll get back to you within 1 business day."
        });
    } catch (err) {
        console.error("Bulk request error:", err);
        res.status(500).json({ success: false, message: "Error submitting bulk request." });
    }
});

// GET /api/bulk — List bulk requests (admin)
router.get("/", (req, res) => {
    if (!req.user || req.user.role !== "admin") {
        return res.status(403).json({ success: false, message: "Admin access required." });
    }

    try {
        const requests = db.prepare("SELECT * FROM bulk_requests ORDER BY created_at DESC").all();
        res.json({ success: true, requests });
    } catch (err) {
        console.error("Bulk list error:", err);
        res.status(500).json({ success: false, message: "Error fetching bulk requests." });
    }
});

module.exports = router;
