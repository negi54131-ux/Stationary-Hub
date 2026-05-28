const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const db = require("../db/database");
const { generateToken } = require("../middleware/auth");
const { requireSupplier, requireAuth } = require("../middleware/auth");

const router = express.Router();

const SUPPLIER_EMAIL = (process.env.SUPPLIER_EMAIL || "").toLowerCase().trim();
const SUPPLIER_PASSWORD = process.env.SUPPLIER_PASSWORD || "";

const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || req.connection?.remoteAddress || "unknown";
}

function checkLoginRateLimit(req) {
    const ip = getClientIp(req);
    const now = Date.now();
    const entry = loginAttempts.get(ip) || { count: 0, start: now };
    if (now - entry.start > LOGIN_WINDOW_MS) {
        loginAttempts.set(ip, { count: 1, start: now });
        return { allowed: true };
    }
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        return { allowed: false, retryAfter: Math.ceil((LOGIN_WINDOW_MS - (now - entry.start)) / 1000) };
    }
    entry.count += 1;
    loginAttempts.set(ip, entry);
    return { allowed: true };
}

function safeString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function normalizePricing(priceValue, mrpValue) {
    const price = Number(priceValue || 0);
    const mrpInput = Number(mrpValue || 0);
    const sellingPrice = Number.isFinite(price) && price > 0 ? price : 0;
    const mrpBase = Number.isFinite(mrpInput) && mrpInput > 0 ? mrpInput : sellingPrice;
    const mrp = Math.max(mrpBase, sellingPrice);
    const discountPercent = mrp > 0 && sellingPrice > 0 && sellingPrice < mrp
        ? Math.round(((mrp - sellingPrice) * 100) / mrp)
        : 0;

    return { price: sellingPrice, mrp, discountPercent };
}

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

const MAX_EMAIL_LENGTH = 25;

// POST /api/supplier/login
router.post("/login", (req, res) => {
    const rate = checkLoginRateLimit(req);
    if (!rate.allowed) {
        res.setHeader("Retry-After", String(rate.retryAfter || 60));
        return res.status(429).json({ success: false, message: "Too many login attempts. Try again later." });
    }
    const email = safeString(req.body.email).toLowerCase();
    const password = safeString(req.body.password);

    if (!email || !password) {
        return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    if (email.length > MAX_EMAIL_LENGTH) {
        return res.status(400).json({ success: false, message: `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.` });
    }

    if (!SUPPLIER_EMAIL || !SUPPLIER_PASSWORD) {
        return res.status(500).json({
            success: false,
            message: "Supplier credentials are not configured. Set SUPPLIER_EMAIL and SUPPLIER_PASSWORD."
        });
    }

    if (email !== SUPPLIER_EMAIL || password !== SUPPLIER_PASSWORD) {
        return res.status(401).json({ success: false, message: "Invalid supplier credentials." });
    }

    loginAttempts.delete(getClientIp(req));

    const token = generateToken({ id: "supplier", email, name: "Supplier", role: "supplier" });
    res.json({ success: true, token });
});

// GET /api/supplier/me
router.get("/me", requireSupplier, (req, res) => {
    res.json({ success: true, user: { id: "supplier", email: req.user.email, role: "supplier" } });
});

// GET /api/supplier/visibility
router.get("/visibility", requireAuth, (req, res) => {
    if (!SUPPLIER_EMAIL) {
        return res.status(500).json({ success: false, message: "Supplier email is not configured." });
    }

    const allowed = req.user?.email?.toLowerCase() === SUPPLIER_EMAIL;
    res.json({ success: true, allowed });
});

// POST /api/supplier/issue-token
// Secure helper: issue a supplier-scoped token for an authenticated user whose email matches SUPPLIER_EMAIL
router.post("/issue-token", requireAuth, (req, res) => {
    if (!SUPPLIER_EMAIL) {
        return res.status(500).json({ success: false, message: "Supplier email is not configured." });
    }

    const userEmail = req.user?.email?.toLowerCase();
    if (userEmail !== SUPPLIER_EMAIL) {
        return res.status(403).json({ success: false, message: "Not authorized to receive supplier token." });
    }

    // Issue a supplier-scoped token (does not require sharing SUPPLIER_PASSWORD to client)
    const token = generateToken({ id: "supplier", email: SUPPLIER_EMAIL, name: "Supplier", role: "supplier" });
    res.json({ success: true, token });
});

// GET /api/supplier/products
router.get("/products", requireSupplier, (_req, res) => {
    try {
        const products = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
        res.json({ success: true, products });
    } catch (err) {
        console.error("Supplier products error:", err);
        res.status(500).json({ success: false, message: "Error fetching products." });
    }
});

// POST /api/supplier/products
router.post("/products", requireSupplier, (req, res) => {
    try {
        const name = safeString(req.body.name);
        const description = safeString(req.body.description);
        const category = safeString(req.body.category);
        const image = safeString(req.body.image);
        const pricing = normalizePricing(req.body.price, req.body.mrp);
        const stock = Number(req.body.stock || 0);
        const featured = req.body.featured ? 1 : 0;

        if (!name || !category || !image || pricing.price <= 0 || pricing.mrp <= 0) {
            return res.status(400).json({ success: false, message: "Name, category, image, MRP, and selling price are required." });
        }

        const id = crypto.randomUUID();

        db.prepare(`
            INSERT INTO products (id, name, description, price, mrp, discount_percent, stock, category, image, featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, name, description, pricing.price, pricing.mrp, pricing.discountPercent, stock, category, image, featured);

        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
        res.status(201).json({ success: true, product });
    } catch (err) {
        console.error("Supplier create product error:", err);
        res.status(500).json({ success: false, message: "Error creating product." });
    }
});

// PUT /api/supplier/products/:id
router.put("/products/:id", requireSupplier, (req, res) => {
    try {
        const productId = req.params.id;
        const name = safeString(req.body.name);
        const description = safeString(req.body.description);
        const category = safeString(req.body.category);
        const image = safeString(req.body.image);
        const pricing = normalizePricing(req.body.price, req.body.mrp);
        const stock = Number(req.body.stock || 0);
        const featured = req.body.featured ? 1 : 0;

        if (!name || !category || !image || pricing.price <= 0 || pricing.mrp <= 0) {
            return res.status(400).json({ success: false, message: "Name, category, image, MRP, and selling price are required." });
        }

        const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(productId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }

        db.prepare(`
            UPDATE products
            SET name = ?, description = ?, price = ?, mrp = ?, discount_percent = ?, stock = ?, category = ?, image = ?, featured = ?
            WHERE id = ?
        `).run(name, description, pricing.price, pricing.mrp, pricing.discountPercent, stock, category, image, featured, productId);

        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
        res.json({ success: true, product });
    } catch (err) {
        console.error("Supplier update product error:", err);
        res.status(500).json({ success: false, message: "Error updating product." });
    }
});

// POST /api/supplier/products/bulk-update
router.post("/products/bulk-update", requireSupplier, (req, res) => {
    try {
        const ids = Array.isArray(req.body.ids) ? req.body.ids.map((id) => safeString(id)).filter(Boolean) : [];
        const action = safeString(req.body.action);
        const rawValue = req.body.value;

        if (!ids.length) {
            return res.status(400).json({ success: false, message: "No products selected." });
        }

        const allowedActions = ["set-price", "add-stock", "set-stock", "set-featured"];
        if (!allowedActions.includes(action)) {
            return res.status(400).json({ success: false, message: "Invalid bulk action." });
        }

        const existing = db.prepare("SELECT id, stock, price, mrp FROM products WHERE id = ?");
        const updateStmt = db.prepare(`
            UPDATE products
            SET price = COALESCE(?, price),
                mrp = COALESCE(?, mrp),
                discount_percent = COALESCE(?, discount_percent),
                stock = COALESCE(?, stock),
                featured = COALESCE(?, featured)
            WHERE id = ?
        `);

        const result = { updated: 0, skipped: [] };

        const txn = db.transaction((productIds) => {
            for (const productId of productIds) {
                const row = existing.get(productId);
                if (!row) {
                    result.skipped.push({ id: productId, message: "Product not found." });
                    continue;
                }

                let price = null;
                let mrp = null;
                let discountPercent = null;
                let stock = null;
                let featured = null;

                if (action === "set-price") {
                    price = Number(rawValue);
                    if (!Number.isFinite(price) || price <= 0) {
                        result.skipped.push({ id: productId, message: "Invalid price." });
                        continue;
                    }
                    const mrpBase = Number(row.mrp || price);
                    mrp = Number.isFinite(mrpBase) && mrpBase > 0 ? Math.max(mrpBase, price) : price;
                    discountPercent = mrp > 0 && price < mrp ? Math.round(((mrp - price) * 100) / mrp) : 0;
                }

                if (action === "add-stock") {
                    const delta = Number(rawValue);
                    if (!Number.isFinite(delta)) {
                        result.skipped.push({ id: productId, message: "Invalid stock delta." });
                        continue;
                    }
                    stock = Number(row.stock || 0) + delta;
                }

                if (action === "set-stock") {
                    stock = Number(rawValue);
                    if (!Number.isFinite(stock) || stock < 0) {
                        result.skipped.push({ id: productId, message: "Invalid stock value." });
                        continue;
                    }
                }

                if (action === "set-featured") {
                    const normalized = String(rawValue).toLowerCase();
                    featured = normalized === "1" || normalized === "true" || normalized === "yes" ? 1 : 0;
                }

                updateStmt.run(
                    price,
                    mrp,
                    discountPercent,
                    stock,
                    featured,
                    productId
                );
                result.updated += 1;
            }
        });

        txn(ids);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("Supplier bulk update error:", err);
        res.status(500).json({ success: false, message: "Bulk update failed." });
    }
});

// DELETE /api/supplier/products/:id
router.delete("/products/:id", requireSupplier, (req, res) => {
    try {
        const productId = req.params.id;
        const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(productId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }

        db.prepare("DELETE FROM products WHERE id = ?").run(productId);
        res.json({ success: true });
    } catch (err) {
        console.error("Supplier delete product error:", err);
        res.status(500).json({ success: false, message: "Error deleting product." });
    }
});

// GET /api/supplier/orders
router.get("/orders", requireSupplier, (_req, res) => {
    try {
        const orders = db.prepare("SELECT * FROM orders ORDER BY placed_at DESC").all();
        const products = db.prepare("SELECT id, category FROM products").all();
        const categoryByProductId = new Map(products.map((product) => [product.id, product.category]));
        const ordersWithItems = orders.map((order) => {
            const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
            return {
                ...order,
                items: items.map((item) => ({
                    product_id: item.product_id,
                    name: item.product_name,
                    price: item.product_price,
                    quantity: item.quantity,
                    category: categoryByProductId.get(item.product_id) || "Uncategorized"
                }))
            };
        });

        res.json({ success: true, orders: ordersWithItems });
    } catch (err) {
        console.error("Supplier orders error:", err);
        res.status(500).json({ success: false, message: "Error fetching orders." });
    }
});

// PUT /api/supplier/orders/:id/status
router.put("/orders/:id/status", requireSupplier, (req, res) => {
    try {
        const orderId = req.params.id;
        const status = safeString(req.body.status);
        const allowed = ["Placed", "Packed", "Delivered"];

        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status." });
        }

        const existing = db.prepare("SELECT id FROM orders WHERE id = ?").get(orderId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, orderId);
        const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
        res.json({ success: true, order });
    } catch (err) {
        console.error("Supplier order status error:", err);
        res.status(500).json({ success: false, message: "Error updating order status." });
    }
});

// GET /api/supplier/analytics
router.get("/analytics", requireSupplier, (req, res) => {
    try {
        const start = safeString(req.query.start);
        const end = safeString(req.query.end);
        const group = safeString(req.query.group).toLowerCase() === "month" ? "month" : "day";

        const where = [];
        const params = [];
        if (start) {
            where.push("date(placed_at) >= date(?)");
            params.push(start);
        }
        if (end) {
            where.push("date(placed_at) <= date(?)");
            params.push(end);
        }
        const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

        const summary = db.prepare(`
            SELECT
                COUNT(*) AS total_orders,
                COALESCE(SUM(total), 0) AS total_revenue,
                COALESCE(AVG(total), 0) AS avg_order_value,
                SUM(CASE WHEN status <> 'Delivered' THEN 1 ELSE 0 END) AS pending_orders
            FROM orders
            ${whereSql}
        `).get(...params);

        const bucketExpr = group === "month" ? "strftime('%Y-%m', placed_at)" : "date(placed_at)";
        const series = db.prepare(`
            SELECT ${bucketExpr} AS bucket, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
            FROM orders
            ${whereSql}
            GROUP BY bucket
            ORDER BY bucket ASC
        `).all(...params);

        res.json({
            success: true,
            summary: {
                totalOrders: Number(summary?.total_orders || 0),
                totalRevenue: Number(summary?.total_revenue || 0),
                avgOrderValue: Number(summary?.avg_order_value || 0),
                pendingOrders: Number(summary?.pending_orders || 0)
            },
            series: series.map((row) => ({
                label: row.bucket,
                revenue: Number(row.revenue || 0),
                orders: Number(row.orders || 0)
            }))
        });
    } catch (err) {
        console.error("Supplier analytics error:", err);
        res.status(500).json({ success: false, message: "Error fetching analytics." });
    }
});

// GET /api/supplier/analytics/schedule
router.get("/analytics/schedule", requireSupplier, (_req, res) => {
    try {
        if (!SUPPLIER_EMAIL) {
            return res.status(500).json({ success: false, message: "Supplier email is not configured." });
        }

        const schedule = db.prepare(
            "SELECT id, frequency, email, active, last_sent_at FROM export_schedules WHERE supplier_email = ? AND report_type = 'analytics'"
        ).get(SUPPLIER_EMAIL);

        res.json({ success: true, schedule: schedule || null });
    } catch (err) {
        console.error("Supplier analytics schedule read error:", err);
        res.status(500).json({ success: false, message: "Error loading schedule." });
    }
});

// POST /api/supplier/analytics/schedule
router.post("/analytics/schedule", requireSupplier, (req, res) => {
    try {
        if (!SUPPLIER_EMAIL) {
            return res.status(500).json({ success: false, message: "Supplier email is not configured." });
        }

        const frequency = safeString(req.body.frequency).toLowerCase() || "daily";
        const email = safeString(req.body.email) || SUPPLIER_EMAIL;
        const active = req.body.active === false ? 0 : 1;
        const allowed = ["daily", "weekly", "monthly"];

        if (!allowed.includes(frequency)) {
            return res.status(400).json({ success: false, message: "Invalid frequency." });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: "Invalid email address." });
        }

        if (String(email).length > MAX_EMAIL_LENGTH) {
            return res.status(400).json({ success: false, message: `Email must be ${MAX_EMAIL_LENGTH} characters or fewer.` });
        }

        const existing = db.prepare(
            "SELECT id, active FROM export_schedules WHERE supplier_email = ? AND report_type = 'analytics'"
        ).get(SUPPLIER_EMAIL);

        if (existing) {
            const resetLastSent = active === 1 && existing.active === 0;
            db.prepare(
                "UPDATE export_schedules SET frequency = ?, email = ?, active = ?, last_sent_at = CASE WHEN ? THEN NULL ELSE last_sent_at END, updated_at = datetime('now') WHERE id = ?"
            ).run(frequency, email, active, resetLastSent ? 1 : 0, existing.id);
            return res.json({ success: true });
        }

        db.prepare(
            "INSERT INTO export_schedules (supplier_email, report_type, frequency, email, active) VALUES (?, 'analytics', ?, ?, ?)"
        ).run(SUPPLIER_EMAIL, frequency, email, active);

        res.json({ success: true });
    } catch (err) {
        console.error("Supplier analytics schedule save error:", err);
        res.status(500).json({ success: false, message: "Error saving schedule." });
    }
});

// POST /api/supplier/products/bulk
router.post('/products/bulk', requireSupplier, (req, res) => {
    try {
        const rows = Array.isArray(req.body.products) ? req.body.products : [];
        if (!rows.length) return res.status(400).json({ success: false, message: 'No products provided.' });

        const insert = db.prepare(`
            INSERT INTO products (id, name, description, price, stock, category, image, featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const failures = [];
        const imported = [];

        const insertTxn = db.transaction((items) => {
            for (const [i, r] of items.entries()) {
                try {
                    const name = safeString(r.name || r.title || '');
                    const category = safeString(r.category || 'General');
                    const image = safeString(r.image || r.image_url || '');
                    const description = safeString(r.description || '');
                    const price = Number(r.price || 0);
                    const stock = Number(r.stock || 0);
                    const featured = r.featured ? 1 : 0;

                    if (!name || !category || price <= 0) {
                        failures.push({ row: i, message: 'Missing required fields (name, category, price>0)' });
                        continue;
                    }

                    const id = crypto.randomUUID();
                    insert.run(id, name, description, price, stock, category, image, featured);
                    imported.push(id);
                } catch (errInner) {
                    failures.push({ row: i, message: String(errInner && errInner.message) || 'Insert error' });
                }
            }
        });

        insertTxn(rows);

        res.json({ success: true, imported: imported.length, failures });
    } catch (err) {
        console.error('Bulk import error:', err);
        res.status(500).json({ success: false, message: 'Bulk import failed.' });
    }
});

// GET /api/supplier/returns
router.get("/returns", requireSupplier, (_req, res) => {
    try {
        const returnsList = db.prepare("SELECT * FROM returns ORDER BY created_at DESC").all();
        res.json({ success: true, returns: returnsList });
    } catch (err) {
        console.error("Supplier returns fetch error:", err);
        res.status(500).json({ success: false, message: "Error fetching returns." });
    }
});

// PUT /api/supplier/returns/:id/status
router.put("/returns/:id/status", requireSupplier, (req, res) => {
    try {
        const returnId = req.params.id;
        const status = safeString(req.body.status);
        const allowed = ["Pending", "Accepted", "Denied"];

        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid return status." });
        }

        const existing = db.prepare("SELECT id FROM returns WHERE id = ?").get(returnId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Return request not found." });
        }

        db.prepare("UPDATE returns SET status = ? WHERE id = ?").run(status, returnId);
        res.json({ success: true, message: `Return status updated to ${status}` });
    } catch (err) {
        console.error("Supplier return status update error:", err);
        res.status(500).json({ success: false, message: "Error updating return status." });
    }
});

// POST /api/supplier/upload
router.post("/upload", requireSupplier, (req, res) => {
    try {
        const images = req.body.images;
        if (!Array.isArray(images) || images.length === 0) {
            return res.status(400).json({ success: false, message: "No images provided." });
        }

        const uploadedUrls = [];
        const uploadDir = path.join(__dirname, "../../public/uploads");

        // Ensure directory exists
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        for (let i = 0; i < images.length; i++) {
            const dataUrl = images[i];
            if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
                continue;
            }

            // Extract file extension and base64 data
            const matches = dataUrl.match(/^data:image\/([A-Za-z0-9-+]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                continue;
            }

            const ext = matches[1] === "jpeg" ? "jpg" : matches[1];
            const base64Data = matches[2];
            const buffer = Buffer.from(base64Data, "base64");

            const filename = `img_${Date.now()}_${i}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
            const filepath = path.join(uploadDir, filename);

            fs.writeFileSync(filepath, buffer);
            uploadedUrls.push(`/uploads/${filename}`);
        }

        res.json({ success: true, urls: uploadedUrls });
    } catch (err) {
        console.error("Supplier image upload error:", err);
        res.status(500).json({ success: false, message: "Error uploading images." });
    }
});

// GET /api/supplier/tickets
router.get("/tickets", requireSupplier, (_req, res) => {
    try {
        const tickets = db.prepare("SELECT * FROM support_tickets ORDER BY created_at DESC").all();
        res.json({ success: true, tickets });
    } catch (err) {
        console.error("Supplier tickets fetch error:", err);
        res.status(500).json({ success: false, message: "Error fetching support tickets." });
    }
});

// PUT /api/supplier/tickets/:id/status
router.put("/tickets/:id/status", requireSupplier, (req, res) => {
    try {
        const ticketId = req.params.id;
        const status = safeString(req.body.status).toLowerCase();
        const allowed = ["open", "resolved", "closed"];

        if (!allowed.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid ticket status." });
        }

        const existing = db.prepare("SELECT id FROM support_tickets WHERE id = ?").get(ticketId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Support ticket not found." });
        }

        db.prepare("UPDATE support_tickets SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, ticketId);
        res.json({ success: true, message: `Ticket status updated to ${status}` });
    } catch (err) {
        console.error("Supplier ticket status update error:", err);
        res.status(500).json({ success: false, message: "Error updating ticket status." });
    }
});

module.exports = router;
