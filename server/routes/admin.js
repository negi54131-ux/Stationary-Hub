const express = require('express');
const db = require('../db/database');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

function safeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

const MAX_EMAIL_LENGTH = 25;

const allowedFrequencies = ['daily', 'weekly', 'monthly'];
const allowedReports = ['analytics'];

router.get('/export-schedules', requireAdmin, (_req, res) => {
    try {
        const rows = db.prepare(
            'SELECT id, supplier_email, report_type, frequency, email, active, last_sent_at FROM export_schedules ORDER BY updated_at DESC'
        ).all();
        res.json({ success: true, schedules: rows });
    } catch (err) {
        console.error('Admin schedules list error:', err);
        res.status(500).json({ success: false, message: 'Failed to load schedules.' });
    }
});

router.post('/export-schedules', requireAdmin, (req, res) => {
    try {
        const supplierEmail = safeString(req.body.supplierEmail).toLowerCase();
        const reportType = safeString(req.body.reportType) || 'analytics';
        const frequency = safeString(req.body.frequency) || 'daily';
        const email = safeString(req.body.email).toLowerCase();
        const active = req.body.active === false ? 0 : 1;

        if (!supplierEmail || !isValidEmail(supplierEmail)) {
            return res.status(400).json({ success: false, message: 'Supplier email is invalid.' });
        }

        if (supplierEmail.length > MAX_EMAIL_LENGTH) {
            return res.status(400).json({ success: false, message: `Supplier email must be ${MAX_EMAIL_LENGTH} characters or fewer.` });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Recipient email is invalid.' });
        }

        if (email.length > MAX_EMAIL_LENGTH) {
            return res.status(400).json({ success: false, message: `Recipient email must be ${MAX_EMAIL_LENGTH} characters or fewer.` });
        }

        if (!allowedFrequencies.includes(frequency)) {
            return res.status(400).json({ success: false, message: 'Invalid frequency.' });
        }

        if (!allowedReports.includes(reportType)) {
            return res.status(400).json({ success: false, message: 'Invalid report type.' });
        }

        db.prepare(
            'INSERT INTO export_schedules (supplier_email, report_type, frequency, email, active) VALUES (?, ?, ?, ?, ?)'
        ).run(supplierEmail, reportType, frequency, email, active);

        res.status(201).json({ success: true });
    } catch (err) {
        console.error('Admin schedule create error:', err);
        res.status(500).json({ success: false, message: 'Failed to create schedule.' });
    }
});

router.put('/export-schedules/:id', requireAdmin, (req, res) => {
    try {
        const id = Number(req.params.id);
        const frequency = safeString(req.body.frequency) || 'daily';
        const email = safeString(req.body.email).toLowerCase();
        const active = req.body.active === false ? 0 : (String(req.body.active) === '1' ? 1 : 0);

        if (!Number.isInteger(id)) {
            return res.status(400).json({ success: false, message: 'Invalid schedule id.' });
        }

        if (!allowedFrequencies.includes(frequency)) {
            return res.status(400).json({ success: false, message: 'Invalid frequency.' });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Recipient email is invalid.' });
        }

        if (email.length > MAX_EMAIL_LENGTH) {
            return res.status(400).json({ success: false, message: `Recipient email must be ${MAX_EMAIL_LENGTH} characters or fewer.` });
        }

        const existing = db.prepare('SELECT id FROM export_schedules WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Schedule not found.' });
        }

        db.prepare(
            'UPDATE export_schedules SET frequency = ?, email = ?, active = ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(frequency, email, active, id);

        res.json({ success: true });
    } catch (err) {
        console.error('Admin schedule update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update schedule.' });
    }
});

router.delete('/export-schedules/:id', requireAdmin, (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id)) {
            return res.status(400).json({ success: false, message: 'Invalid schedule id.' });
        }

        const existing = db.prepare('SELECT id FROM export_schedules WHERE id = ?').get(id);
        if (!existing) {
            return res.status(404).json({ success: false, message: 'Schedule not found.' });
        }

        db.prepare('DELETE FROM export_schedules WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        console.error('Admin schedule delete error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete schedule.' });
    }
});

module.exports = router;
