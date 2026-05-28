const express = require("express");
const db = require("../db/database");

const router = express.Router();

// GET /api/products — List all or search products
router.get("/", (req, res) => {
    try {
        const { q, category, sort, page = 1, limit = 50, minPrice, maxPrice } = req.query;
        let sql = "SELECT * FROM products WHERE 1=1";
        const params = [];

        if (q) {
            sql += " AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)";
            const search = `%${q.toLowerCase()}%`;
            params.push(search, search, search);
        }

        if (category && category !== "all") {
            sql += " AND category = ?";
            params.push(category);
        }

        if (minPrice) {
            sql += " AND price >= ?";
            params.push(Number(minPrice));
        }

        if (maxPrice) {
            sql += " AND price <= ?";
            params.push(Number(maxPrice));
        }

        // Sorting
        const sortOptions = {
            "price-asc": "price ASC",
            "price-desc": "price DESC",
            "name-asc": "name ASC",
            "name-desc": "name DESC",
            "rating": "rating DESC",
            "newest": "created_at DESC"
        };
        sql += ` ORDER BY ${sortOptions[sort] || "name ASC"}`;

        // Pagination
        const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
        sql += " LIMIT ? OFFSET ?";
        params.push(Number(limit), offset);

        const products = db.prepare(sql).all(...params);

        // Get total count for pagination
        let countSql = "SELECT COUNT(*) as total FROM products WHERE 1=1";
        const countParams = [];
        if (q) {
            countSql += " AND (LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(category) LIKE ?)";
            const search = `%${q.toLowerCase()}%`;
            countParams.push(search, search, search);
        }
        if (category && category !== "all") {
            countSql += " AND category = ?";
            countParams.push(category);
        }
        if (minPrice) {
            countSql += " AND price >= ?";
            countParams.push(Number(minPrice));
        }
        if (maxPrice) {
            countSql += " AND price <= ?";
            countParams.push(Number(maxPrice));
        }

        const { total } = db.prepare(countSql).get(...countParams);

        res.json({
            success: true,
            products,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
            }
        });
    } catch (err) {
        console.error("Products list error:", err);
        res.status(500).json({ success: false, message: "Error fetching products." });
    }
});

// GET /api/products/categories — List unique categories
router.get("/categories", (_req, res) => {
    try {
        const categories = db.prepare("SELECT DISTINCT category FROM products ORDER BY category").all();
        res.json({ success: true, categories: categories.map((c) => c.category) });
    } catch (err) {
        console.error("Categories error:", err);
        res.status(500).json({ success: false, message: "Error fetching categories." });
    }
});

// GET /api/products/featured — Featured products
router.get("/featured", (_req, res) => {
    try {
        const products = db.prepare("SELECT * FROM products WHERE featured = 1 ORDER BY rating DESC LIMIT 12").all();
        res.json({ success: true, products });
    } catch (err) {
        console.error("Featured error:", err);
        res.status(500).json({ success: false, message: "Error fetching featured products." });
    }
});

// GET /api/products/:id — Single product
router.get("/:id", (req, res) => {
    try {
        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(req.params.id);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }
        res.json({ success: true, product });
    } catch (err) {
        console.error("Product detail error:", err);
        res.status(500).json({ success: false, message: "Error fetching product." });
    }
});

module.exports = router;
