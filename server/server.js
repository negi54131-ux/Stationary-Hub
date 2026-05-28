const path = require("path");
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

// Database & seed
const seed = require("./db/seed");

// Middleware
const { authMiddleware } = require("./middleware/auth");

// Route modules
const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const cartRoutes = require("./routes/cart");
const orderRoutes = require("./routes/orders");
const bulkRoutes = require("./routes/bulk");
const newsletterRoutes = require("./routes/newsletter");
const supportRoutes = require("./routes/support");
const contactRoutes = require("./routes/contact");
const addressRoutes = require("./routes/addresses");
const supplierRoutes = require("./routes/supplier");
const adminRoutes = require("./routes/admin");
const { startScheduledExports } = require("./jobs/scheduledExports");

const app = express();
const PORT = process.env.PORT || 3000;

// Global middleware
const corsOptions = {};
if (process.env.NODE_ENV === "production" && process.env.CORS_ORIGIN) {
    corsOptions.origin = process.env.CORS_ORIGIN;
} else {
    corsOptions.origin = "*";
}
app.use(cors(corsOptions));
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ limit: "15mb", extended: true }));
app.use(morgan("dev"));
app.use(
    express.static(path.join(__dirname, "..", "public"), {
        maxAge: process.env.NODE_ENV === "production" ? "6h" : 0,
        extensions: ["html"]
    })
);

// Attach user from JWT token on every request
app.use(authMiddleware);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/bulk", bulkRoutes);
app.use("/api/newsletter", newsletterRoutes);
app.use("/api/support", supportRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/addresses", addressRoutes);
app.use("/api/supplier", supplierRoutes);
app.use("/api/admin", adminRoutes);

// HTML page routes
const pages = [
    "login", "register", "shop", "categories", "bundles",
    "bulk", "stories", "support", "track", "specialist", "admin-schedules"
];

pages.forEach((page) => {
    app.get(`/${page}`, (_req, res) => {
        res.sendFile(path.join(__dirname, "..", "public", `${page}.html`));
    });
});

// Fallback to index for any unknown path
app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Seed database then start server
seed();
startScheduledExports();

app.listen(PORT, () => {
    console.log(`Stationery shop server running on http://localhost:${PORT}`);
});
