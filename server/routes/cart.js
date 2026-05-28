const express = require("express");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// GET /api/cart — Get user's cart
router.get("/", requireAuth, (req, res) => {
    try {
        const items = db.prepare(`
      SELECT ci.id, ci.quantity, ci.product_id,
             p.name, p.description, p.price, p.stock, p.category, p.rating, p.image
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
      ORDER BY ci.created_at DESC
    `).all(req.user.id);

        const cartItems = items.map((item) => ({
            product: {
                id: item.product_id,
                name: item.name,
                description: item.description,
                price: item.price,
                stock: item.stock,
                category: item.category,
                rating: item.rating,
                image: item.image
            },
            quantity: item.quantity
        }));

        const total = cartItems.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
        const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);

        res.json({ success: true, items: cartItems, total, totalQuantity });
    } catch (err) {
        console.error("Cart fetch error:", err);
        res.status(500).json({ success: false, message: "Error fetching cart." });
    }
});

// POST /api/cart — Add item to cart
router.post("/", requireAuth, (req, res) => {
    try {
        const { productId, quantity = 1 } = req.body;

        if (!productId) {
            return res.status(400).json({ success: false, message: "productId is required." });
        }

        const product = db.prepare("SELECT * FROM products WHERE id = ?").get(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: "Product not found." });
        }

        const qty = Math.max(1, Number(quantity));

        // Check stock
        if (product.stock < qty) {
            return res.status(400).json({ success: false, message: `Only ${product.stock} units available.` });
        }

        const existing = db.prepare("SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?")
            .get(req.user.id, productId);

        if (existing) {
            const newQty = existing.quantity + qty;
            if (newQty > product.stock) {
                return res.status(400).json({ success: false, message: `Only ${product.stock} units available. You already have ${existing.quantity} in cart.` });
            }
            db.prepare("UPDATE cart_items SET quantity = ?, updated_at = datetime('now') WHERE user_id = ? AND product_id = ?")
                .run(newQty, req.user.id, productId);
        } else {
            db.prepare("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)")
                .run(req.user.id, productId, qty);
        }

        res.json({ success: true, message: "Added to cart." });
    } catch (err) {
        console.error("Cart add error:", err);
        res.status(500).json({ success: false, message: "Error adding to cart." });
    }
});

// PUT /api/cart/:productId — Update cart item quantity
router.put("/:productId", requireAuth, (req, res) => {
    try {
        const { productId } = req.params;
        const { quantity } = req.body;

        if (typeof quantity !== "number" || quantity < 0) {
            return res.status(400).json({ success: false, message: "quantity must be >= 0." });
        }

        const existing = db.prepare("SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?")
            .get(req.user.id, productId);

        if (!existing) {
            return res.status(404).json({ success: false, message: "Item not in cart." });
        }

        if (quantity === 0) {
            db.prepare("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?").run(req.user.id, productId);
            return res.json({ success: true, message: "Item removed from cart." });
        }

        // Check stock
        const product = db.prepare("SELECT stock FROM products WHERE id = ?").get(productId);
        if (product && quantity > product.stock) {
            return res.status(400).json({ success: false, message: `Only ${product.stock} units available.` });
        }

        db.prepare("UPDATE cart_items SET quantity = ?, updated_at = datetime('now') WHERE user_id = ? AND product_id = ?")
            .run(quantity, req.user.id, productId);

        res.json({ success: true, message: "Quantity updated." });
    } catch (err) {
        console.error("Cart update error:", err);
        res.status(500).json({ success: false, message: "Error updating cart." });
    }
});

// DELETE /api/cart/:productId — Remove item from cart
router.delete("/:productId", requireAuth, (req, res) => {
    try {
        const { productId } = req.params;
        const result = db.prepare("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?")
            .run(req.user.id, productId);

        if (result.changes === 0) {
            return res.status(404).json({ success: false, message: "Item not in cart." });
        }

        res.json({ success: true, message: "Item removed." });
    } catch (err) {
        console.error("Cart delete error:", err);
        res.status(500).json({ success: false, message: "Error removing item." });
    }
});

// DELETE /api/cart — Clear entire cart
router.delete("/", requireAuth, (req, res) => {
    try {
        db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.user.id);
        res.json({ success: true, message: "Cart cleared." });
    } catch (err) {
        console.error("Cart clear error:", err);
        res.status(500).json({ success: false, message: "Error clearing cart." });
    }
});

module.exports = router;
