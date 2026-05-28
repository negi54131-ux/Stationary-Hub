const db = require("./database");
const products = require("../data/products");

function seedProducts() {
    const existing = db.prepare("SELECT COUNT(*) as count FROM products").get();

    if (existing.count === 0) {
        console.log("Seeding products into database...");
        const insert = db.prepare(`
      INSERT OR IGNORE INTO products (id, name, description, price, mrp, discount_percent, stock, category, rating, image, featured)
      VALUES (@id, @name, @description, @price, @mrp, @discount_percent, @stock, @category, @rating, @image, @featured)
    `);

        const insertMany = db.transaction((items) => {
            for (const item of items) {
                insert.run({
                    ...item,
                    mrp: item.mrp || item.price,
                    discount_percent: item.discount_percent || 0,
                    featured: item.featured || 0
                });
            }
        });

        insertMany(products);
        console.log(`Seeded ${products.length} products.`);
    } else {
        console.log(`Database already has ${existing.count} products. Skipping seed.`);
    }
}

function ensureDemoUser() {
    const existing = db.prepare("SELECT id, name, email FROM users ORDER BY created_at ASC LIMIT 1").get();
    if (existing) return existing;

    const fallbackUser = {
        id: "demo-seed-user",
        name: "Demo Customer",
        email: "demo.customer@example.com"
    };

    db.prepare(`
      INSERT INTO users (id, name, email, password, phone, role)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        fallbackUser.id,
        fallbackUser.name,
        fallbackUser.email,
        "demo-seed-password",
        "9999999999",
        "customer"
    );

    return fallbackUser;
}

function cleanupDemoOrders() {
    const ids = db.prepare("SELECT id FROM orders WHERE id LIKE 'DEMOQ-%' OR id LIKE 'SEEDQ-%'").all();
    if (!ids.length) {
        console.log("No demo queued orders found to clean.");
        return 0;
    }

    const deleteOrderItems = db.prepare("DELETE FROM order_items WHERE order_id = ?");
    const deleteOrder = db.prepare("DELETE FROM orders WHERE id = ?");

    const tx = db.transaction((orderIds) => {
        for (const row of orderIds) {
            deleteOrderItems.run(row.id);
            deleteOrder.run(row.id);
        }
    });

    tx(ids);
    console.log(`Cleaned ${ids.length} demo queued orders.`);
    return ids.length;
}

function seedDemoQueuedOrders() {
    const user = ensureDemoUser();
    const baseProducts = db.prepare("SELECT id, name, price FROM products ORDER BY created_at ASC LIMIT 3").all();

    if (!baseProducts.length) {
        console.log("No products available. Run product seed first.");
        return;
    }

    const demoOrders = [
        {
            id: "DEMOQ-PLACED-1",
            status: "Placed",
            quantity: 10,
            product: baseProducts[0]
        },
        {
            id: "DEMOQ-PACKED-1",
            status: "Packed",
            quantity: 11,
            product: baseProducts[1] || baseProducts[0]
        },
        {
            id: "DEMOQ-PLACED-2",
            status: "Placed",
            quantity: 12,
            product: baseProducts[2] || baseProducts[0]
        }
    ];

    cleanupDemoOrders();

    const insertOrder = db.prepare(`
      INSERT INTO orders (
        id, user_id, status, total, total_quantity,
        customer_name, customer_email, customer_phone,
        shipping_address, payment_method, payment_detail, notes,
        placed_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        datetime('now'), datetime('now')
      )
    `);

    const insertItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name, product_price, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    const tx = db.transaction((rows) => {
        for (const row of rows) {
            const price = Number(row.product.price || 0);
            const total = price * row.quantity;

            insertOrder.run(
                row.id,
                user.id,
                row.status,
                total,
                row.quantity,
                user.name,
                user.email,
                "9999999999",
                "Demo Address, Demo City",
                "cod",
                "",
                "demo queued order"
            );

            insertItem.run(row.id, row.product.id, row.product.name, price, row.quantity);
        }
    });

    tx(demoOrders);
    console.log(`Seeded ${demoOrders.length} demo queued orders.`);
}

function seed(options = {}) {
    const includeDemoOrders = options.includeDemoOrders === true;
    const cleanupOnly = options.cleanupOnly === true;
    const forceProducts = options.forceProducts === true || process.argv.includes("--force-products");

    if (forceProducts) {
        seedProducts();
    } else {
        console.log("Auto-seeding of products is disabled. Run with --force-products to seed.");
    }

    if (cleanupOnly) {
        cleanupDemoOrders();
        return;
    }

    if (includeDemoOrders) {
        if (process.env.NODE_ENV === "production") {
            console.log("Skipping demo order seed in production mode.");
            return;
        }
        seedDemoQueuedOrders();
    }
}

if (require.main === module) {
    const args = new Set(process.argv.slice(2));
    seed({
        includeDemoOrders: args.has("--demo-orders"),
        cleanupOnly: args.has("--cleanup-demo-orders")
    });
}

module.exports = seed;
