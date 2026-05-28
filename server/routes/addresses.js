const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/addresses — Get all addresses for the user
router.get("/", requireAuth, (req, res) => {
    try {
        const addresses = db
            .prepare("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC")
            .all(req.user.id);
        res.json({ success: true, addresses });
    } catch (err) {
        console.error("Address fetch error:", err);
        res.status(500).json({ success: false, message: "Error fetching addresses." });
    }
});

// POST /api/addresses — Add a new address
router.post("/", requireAuth, (req, res) => {
    try {
        const { label, full_name, phone, address_line1, address_line2, city, state, pincode, landmark, lat, lng, is_default } = req.body;

        if (!full_name || !phone || !address_line1 || !city || !state || !pincode) {
            return res.status(400).json({ success: false, message: "Name, phone, address, city, state, and pincode are required." });
        }

        // If this is set as default, unset other defaults
        if (is_default) {
            db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").run(req.user.id);
        }

        // If this is the user's first address, make it default
        const count = db.prepare("SELECT COUNT(*) as cnt FROM addresses WHERE user_id = ?").get(req.user.id).cnt;
        const makeDefault = is_default || count === 0 ? 1 : 0;

        const result = db.prepare(`
            INSERT INTO addresses (user_id, label, full_name, phone, address_line1, address_line2, city, state, pincode, landmark, lat, lng, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            req.user.id,
            label || "Home",
            full_name,
            phone,
            address_line1,
            address_line2 || "",
            city,
            state,
            pincode,
            landmark || "",
            lat || 0,
            lng || 0,
            makeDefault
        );

        const address = db.prepare("SELECT * FROM addresses WHERE id = ?").get(result.lastInsertRowid);
        res.status(201).json({ success: true, message: "Address added!", address });
    } catch (err) {
        console.error("Address add error:", err);
        res.status(500).json({ success: false, message: "Error adding address." });
    }
});

// PUT /api/addresses/:id — Update an address
router.put("/:id", requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const existing = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(id, req.user.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Address not found." });
        }

        const { label, full_name, phone, address_line1, address_line2, city, state, pincode, landmark, lat, lng, is_default } = req.body;

        if (is_default) {
            db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").run(req.user.id);
        }

        db.prepare(`
            UPDATE addresses SET
                label = COALESCE(?, label),
                full_name = COALESCE(?, full_name),
                phone = COALESCE(?, phone),
                address_line1 = COALESCE(?, address_line1),
                address_line2 = COALESCE(?, address_line2),
                city = COALESCE(?, city),
                state = COALESCE(?, state),
                pincode = COALESCE(?, pincode),
                landmark = COALESCE(?, landmark),
                lat = COALESCE(?, lat),
                lng = COALESCE(?, lng),
                is_default = COALESCE(?, is_default),
                updated_at = datetime('now')
            WHERE id = ? AND user_id = ?
        `).run(
            label, full_name, phone, address_line1, address_line2,
            city, state, pincode, landmark, lat, lng,
            is_default !== undefined ? (is_default ? 1 : 0) : null,
            id, req.user.id
        );

        const address = db.prepare("SELECT * FROM addresses WHERE id = ?").get(id);
        res.json({ success: true, message: "Address updated!", address });
    } catch (err) {
        console.error("Address update error:", err);
        res.status(500).json({ success: false, message: "Error updating address." });
    }
});

// DELETE /api/addresses/:id — Delete an address
router.delete("/:id", requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const existing = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(id, req.user.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Address not found." });
        }

        db.prepare("DELETE FROM addresses WHERE id = ? AND user_id = ?").run(id, req.user.id);

        // If deleted address was default, make the most recent address default
        if (existing.is_default) {
            const next = db.prepare("SELECT id FROM addresses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(req.user.id);
            if (next) {
                db.prepare("UPDATE addresses SET is_default = 1 WHERE id = ?").run(next.id);
            }
        }

        res.json({ success: true, message: "Address deleted." });
    } catch (err) {
        console.error("Address delete error:", err);
        res.status(500).json({ success: false, message: "Error deleting address." });
    }
});

// PUT /api/addresses/:id/default — Set as default address
router.put("/:id/default", requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const existing = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(id, req.user.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Address not found." });
        }

        db.prepare("UPDATE addresses SET is_default = 0 WHERE user_id = ?").run(req.user.id);
        db.prepare("UPDATE addresses SET is_default = 1 WHERE id = ?").run(id);

        res.json({ success: true, message: "Default address updated." });
    } catch (err) {
        console.error("Set default address error:", err);
        res.status(500).json({ success: false, message: "Error updating default address." });
    }
});

module.exports = router;
