const express = require("express");
const crypto = require("crypto");
const db = require("../db/database");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const makeOrderId = () =>
    `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

// POST /api/orders — Place an order from cart
router.post("/", requireAuth, (req, res) => {
    try {
        const { name, email, phone, address, address_id, notes, payment_method, payment_detail } = req.body;

        // If address_id provided, look up the full address
        let shippingAddress = address || "";
        if (address_id) {
            const addrRecord = db.prepare("SELECT * FROM addresses WHERE id = ? AND user_id = ?").get(address_id, req.user.id);
            if (addrRecord) {
                shippingAddress = [addrRecord.address_line1, addrRecord.address_line2, addrRecord.landmark, addrRecord.city, addrRecord.state, addrRecord.pincode]
                    .filter(Boolean)
                    .join(", ");
            }
        }

        // Get cart items
        const cartItems = db.prepare(`
      SELECT ci.quantity, ci.product_id,
             p.name as product_name, p.price, p.stock
      FROM cart_items ci
      JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = ?
    `).all(req.user.id);

        if (!cartItems.length) {
            return res.status(400).json({ success: false, message: "Cart is empty." });
        }

        const totalQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
        if (totalQuantity < 2) {
            return res.status(400).json({
                success: false,
                message: `Minimum 2 units required per order. You have ${totalQuantity} units.`
            });
        }

        // Check stock availability
        for (const item of cartItems) {
            if (item.quantity > item.stock) {
                return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${item.product_name}. Available: ${item.stock}, Requested: ${item.quantity}`
                });
            }
        }

        const total = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
        const orderId = makeOrderId();

        // Transaction: create order, add items, update stock, clear cart
        const placeOrder = db.transaction(() => {
            // Create order
                        db.prepare(`
                INSERT INTO orders (id, user_id, status, total, total_quantity, customer_name, customer_email, customer_phone, shipping_address, payment_method, payment_detail, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                orderId,
                req.user.id,
                                "Placed",
                total,
                totalQuantity,
                name || req.user.name,
                email || req.user.email,
                phone || "",
                shippingAddress,
                payment_method || "cod",
                payment_detail || "",
                notes || ""
            );

            // Add order items and update stock
            const insertItem = db.prepare(`
        INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity)
        VALUES (?, ?, ?, ?, ?)
      `);
            const updateStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");

            for (const item of cartItems) {
                insertItem.run(orderId, item.product_id, item.product_name, item.price, item.quantity);
                updateStock.run(item.quantity, item.product_id);
            }

            // Clear cart
            db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.user.id);
        });

        placeOrder();

        // Return full order
        const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId);
        const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(orderId);

        res.status(201).json({
            success: true,
            message: "Order placed successfully!",
            order: {
                ...order,
                items: items.map((i) => ({
                    product: { id: i.product_id, name: i.product_name, price: i.product_price },
                    quantity: i.quantity
                }))
            }
        });
    } catch (err) {
        console.error("Order creation error:", err);
        res.status(500).json({ success: false, message: "Error placing order." });
    }
});

// GET /api/orders — Get user's orders
router.get("/", requireAuth, (req, res) => {
    try {
        const orders = db.prepare(`
      SELECT * FROM orders WHERE user_id = ? ORDER BY placed_at DESC
    `).all(req.user.id);

        const ordersWithItems = orders.map((order) => {
            const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);
            return {
                ...order,
                items: items.map((i) => ({
                    product: { id: i.product_id, name: i.product_name, price: i.product_price },
                    quantity: i.quantity
                }))
            };
        });

        res.json({ success: true, orders: ordersWithItems });
    } catch (err) {
        console.error("Orders fetch error:", err);
        res.status(500).json({ success: false, message: "Error fetching orders." });
    }
});

// GET /api/orders/:id — Get single order (track)
router.get("/:id", (req, res) => {
    try {
        const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found." });
        }

        // Check ownership if authenticated
        if (req.user && order.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: "Access denied." });
        }

        // For unauthenticated users, limit info
        const items = db.prepare("SELECT * FROM order_items WHERE order_id = ?").all(order.id);

        const response = {
            id: order.id,
            status: order.status,
            total: order.total,
            totalQuantity: order.total_quantity,
            placedAt: order.placed_at,
            items: items.map((i) => ({
                product: { id: i.product_id, name: i.product_name, price: i.product_price },
                quantity: i.quantity
            }))
        };

        // Include full details if owner
        if (req.user && order.user_id === req.user.id) {
            response.customer = {
                name: order.customer_name,
                email: order.customer_email,
                phone: order.customer_phone
            };
            response.shippingAddress = order.shipping_address;
            response.notes = order.notes;
        }

        res.json({ success: true, order: response });
    } catch (err) {
        console.error("Order detail error:", err);
        res.status(500).json({ success: false, message: "Error fetching order." });
    }
});

module.exports = router;
