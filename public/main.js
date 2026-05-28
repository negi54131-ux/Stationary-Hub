const productsGrid = document.getElementById("products");
const searchInput = document.getElementById("search-input");
const searchBtn = document.getElementById("search-btn");
const cartDrawer = document.getElementById("cart-drawer");
let cartToggle = document.getElementById("cart-toggle");
const cartClose = document.getElementById("cart-close");
const cartItems = document.getElementById("cart-items");
const cartTotal = document.getElementById("cart-total");
let cartCount = document.getElementById("cart-count");
const toast = document.getElementById("toast");
const catalogCount = document.getElementById("catalog-count");
const sortSelect = document.getElementById("sort-select");
const shopNow = document.getElementById("shop-now");
const viewCart = document.getElementById("view-cart");
const checkout = document.getElementById("checkout");
const checkoutForm = document.getElementById("checkout-form");
const checkoutFormContainer = document.getElementById("checkout-form-container");
const checkoutName = document.getElementById("checkout-name");
const checkoutEmail = document.getElementById("checkout-email");
const checkoutPhone = document.getElementById("checkout-phone");
const orderConfirmation = document.getElementById("order-confirmation");
const filters = document.querySelectorAll(".filter");
const bulkForm = document.getElementById("bulk-form");
const trackForm = document.getElementById("track-form");
const newsletterForm = document.getElementById("newsletter-form");
const supportForm = document.getElementById("support-form");
const supportStatus = document.getElementById("support-status");
const orderTrackResult = document.getElementById("track-result");
const scrollButtons = document.querySelectorAll("[data-scroll]");
const filterJumpButtons = document.querySelectorAll("[data-filter-jump]");
const bundleTriggers = document.querySelectorAll("[data-product-id]");
const homeCategoryList = document.querySelector(".enhanced-categories");
const productCache = new Map();

let catalog = [];
let cartState = { items: [], total: 0 };
let currentUser = null;
let authToken = localStorage.getItem('token');
let searchTimeout = null;
let guestCartSynced = false;
let currentSort = "relevance";
let activeFilter = "all";

const looksLikeJwt = (token) => typeof token === 'string' && token.split('.').length === 3;

const compareState = {
    max: 3,
    items: []
};

const formatPrice = (value) =>
    `\u20B9${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const debounce = (func, delay) => {
    return (...args) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => func(...args), delay);
    };
};

const GUEST_CART_KEY = "stationery-hub-guest-cart";

const getCuratedProductIds = () => {
    const attr = document.body?.dataset.productIds || "";
    if (!attr || attr.toLowerCase() === "all") {
        return [];
    }
    return attr
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
};

const loadGuestCart = () => {
    try {
        return JSON.parse(localStorage.getItem(GUEST_CART_KEY) || "[]");
    } catch (_err) {
        return [];
    }
};

const saveGuestCart = (items) => {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
};

const clearGuestCart = () => localStorage.removeItem(GUEST_CART_KEY);

async function getProductById(productId) {
    if (!productId) return null;
    if (productCache.has(productId)) {
        return productCache.get(productId);
    }
    try {
        const res = await fetch(`/api/products/${encodeURIComponent(productId)}`);
        if (!res.ok) throw new Error("Not found");
        const data = await res.json();
        const product = data.product || data;
        productCache.set(productId, product);
        return product;
    } catch (err) {
        console.error("Unable to load product", err);
        return null;
    }
}

async function renderGuestCart() {
    const guestItems = loadGuestCart();
    if (!guestItems.length) {
        renderCart([], 0);
        return;
    }

    const enriched = [];
    await Promise.all(
        guestItems.map(async (entry) => {
            const product = await getProductById(entry.productId);
            if (!product) return;
            enriched.push({ product, quantity: entry.quantity });
        })
    );

    const total = enriched.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    renderCart(enriched, total);
}

async function addToGuestCart(productId, quantity = 1) {
    if (!productId) return;
    const guestItems = loadGuestCart();
    const existing = guestItems.find((item) => item.productId === productId);
    if (existing) {
        existing.quantity += Math.max(1, quantity);
    } else {
        guestItems.push({ productId, quantity: Math.max(1, quantity) });
    }
    saveGuestCart(guestItems);
    await renderGuestCart();
}

async function updateGuestQuantity(productId, delta) {
    const guestItems = loadGuestCart();
    const entry = guestItems.find((item) => item.productId === productId);
    if (!entry) return;
    entry.quantity = Math.max(0, entry.quantity + delta);
    if (entry.quantity === 0) {
        const updated = guestItems.filter((item) => item.productId !== productId);
        saveGuestCart(updated);
    } else {
        saveGuestCart(guestItems);
    }
    await renderGuestCart();
}

async function removeGuestItem(productId) {
    const updated = loadGuestCart().filter((item) => item.productId !== productId);
    saveGuestCart(updated);
    await renderGuestCart();
}

async function addToCartServer(productId, quantity = 1, options = {}) {
    if (!currentUser || !productId) return;
    const { silent = false, skipFetch = false } = options;
    try {
        const res = await fetch("/api/cart", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + authToken
            },
            body: JSON.stringify({ productId, quantity })
        });
        if (!res.ok) throw new Error("Failed to add to cart");
        if (!silent) {
            showToast("Added to cart");
        }
        if (!skipFetch) {
            await fetchCart();
        }
    } catch (err) {
        showToast("Error adding to cart");
        console.error(err);
    }
}

async function syncGuestCartToServer() {
    if (!currentUser || guestCartSynced) return;
    const guestItems = loadGuestCart();
    if (!guestItems.length) {
        guestCartSynced = true;
        return;
    }

    for (const entry of guestItems) {
        await addToCartServer(entry.productId, entry.quantity, { silent: true, skipFetch: true });
    }

    clearGuestCart();
    guestCartSynced = true;
    await fetchCart();
    showToast("Cart synced to your account");
}

// Authentication functions
async function checkAuth() {
    if (!authToken) return null;
    if (!looksLikeJwt(authToken)) {
        authToken = null;
        localStorage.removeItem('token');
        return null;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (res.ok) {
            const data = await res.json();
            currentUser = data.user;
            updateAuthUI();
            await syncGuestCartToServer();
            return data.user;
        }
    } catch (err) {
        console.error('Auth check failed:', err);
    }
    return null;
}

async function login(email, password) {
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        if (!res.ok) throw new Error('Login failed');

        const data = await res.json();
        authToken = data.token;
        localStorage.setItem('token', authToken);
            // persist user email for quick client-side checks
            try { if (data.user && data.user.email) localStorage.setItem('userEmail', data.user.email); } catch(e) {}
            // notify other tabs / listeners that auth changed
            try { window.dispatchEvent(new Event('auth-changed')); } catch(e) {}
        currentUser = data.user;
        updateAuthUI();
        showToast('Login successful!');
        return data.user;
    } catch (err) {
        showToast('Login failed');
        throw err;
    }
}

async function register(name, email, password) {
    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });

        if (!res.ok) throw new Error('Registration failed');

        const data = await res.json();
        authToken = data.token;
        localStorage.setItem('token', authToken);
            // persist user email for quick client-side checks
            try { if (data.user && data.user.email) localStorage.setItem('userEmail', data.user.email); } catch(e) {}
            // notify other tabs / listeners that auth changed
            try { window.dispatchEvent(new Event('auth-changed')); } catch(e) {}
        currentUser = data.user;
        updateAuthUI();
        showToast('Registration successful!');
        return data.user;
    } catch (err) {
        showToast('Registration failed');
        throw err;
    }
}

async function logout() {
    authToken = null;
    localStorage.removeItem('token');
    try { localStorage.removeItem('userEmail'); } catch(e) {}
    currentUser = null;
    guestCartSynced = false;
    updateAuthUI();
    fetchCart();
    showToast('Logged out');
}

// Supplier header visibility helpers
function showSupplierNav(visible) {
    const el = document.getElementById('supplier-nav');
    if (!el) return;
    if (visible) {
        el.removeAttribute('hidden');
    } else {
        el.setAttribute('hidden', '');
    }
}

function checkSupplierNavVisibility() {
    const el = document.getElementById('supplier-nav');
    if (!el) return;

    // If supplier token exists, show immediately
    const supplierToken = localStorage.getItem('supplierToken');
    if (supplierToken) { showSupplierNav(true); return; }

    // Client-side check: if the signed-in userEmail is the known supplier email, reveal the link
    const userEmail = localStorage.getItem('userEmail');
    if (userEmail && userEmail.toLowerCase() === 'negi54131@gmail.com') {
        showSupplierNav(true);
        return;
    }

    showSupplierNav(false);
}

// Re-check visibility on auth changes, storage changes, and when window gains focus
window.addEventListener('auth-changed', checkSupplierNavVisibility);
window.addEventListener('storage', checkSupplierNavVisibility);
window.addEventListener('focus', checkSupplierNavVisibility);

// Run initial check after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(checkSupplierNavVisibility, 80);
});

function updateAuthUI() {
    const actions = document.querySelector('.actions');
    if (currentUser) {
        actions.innerHTML = `
            <span class="user-greeting">Hello, ${currentUser.name}</span>
            <a class="ghost" href="#" id="my-orders">My Orders</a>
            <button id="logout-btn" class="ghost">Logout</button>
            <button id="cart-toggle">Cart <span id="cart-count">0</span></button>
        `;
    } else {
        actions.innerHTML = `
            <a class="ghost" href="/login">Login</a>
            <a class="ghost" href="/register">Register</a>
            <button id="cart-toggle">Cart <span id="cart-count">0</span></button>
        `;
    }

    // Re-attach cart toggle event
    cartToggle = document.getElementById('cart-toggle');
    cartCount = document.getElementById('cart-count');
    if (cartToggle) {
        cartToggle.addEventListener('click', () => toggleCart(true));
    }

    // Attach logout event
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
    }

    // Attach my orders event
    const myOrdersBtn = document.getElementById('my-orders');
    if (myOrdersBtn) {
        myOrdersBtn.addEventListener('click', showMyOrders);
    }
}

async function fetchProducts(query = "") {
    showSkeletonLoading();
    try {
        const res = await fetch(`/api/products${query ? `?q=${encodeURIComponent(query)}` : ""}`);
        if (!res.ok) throw new Error("Failed to fetch products");
        const data = await res.json();
        const results = data.products || data;
        results.forEach((item) => productCache.set(item.id, item));

        const curatedIds = getCuratedProductIds();
        if (curatedIds.length) {
            const idOrder = new Map(curatedIds.map((id, index) => [id, index]));
            catalog = results
                .filter((item) => idOrder.has(item.id))
                .sort((a, b) => (idOrder.get(a.id) ?? curatedIds.length) - (idOrder.get(b.id) ?? curatedIds.length));
        } else {
            catalog = results;
        }

        renderProducts(getFilteredCatalog());
        renderHomeCategories(catalog);
        if (!currentUser) {
            await renderGuestCart();
        }
    } catch (err) {
        showToast("Error loading products");
        console.error(err);
    }
}

function renderProducts(list = []) {
    if (!productsGrid) return;
    const sorted = sortProducts(list);
    productsGrid.innerHTML = "";
    if (catalogCount) {
        catalogCount.textContent = String(sorted.length);
    }
    if (!sorted.length) {
        productsGrid.innerHTML = `
            <div class="empty-catalog-fallback" style="grid-column: 1 / -1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px 24px; text-align: center; background: var(--bg-card); border-radius: 16px; border: 1.5px dashed var(--border); gap: 16px;">
                <div style="font-size: 3rem;">✨</div>
                <h4 style="margin: 0; font-size: 1.25rem; font-weight: 700; color: var(--primary-dark);">Catalog is ready for your products!</h4>
                <p style="margin: 0; max-width: 420px; font-size: 0.95rem; color: var(--text-muted);">
                    You cleared the demo products. Now, access the <strong>Supplier Hub</strong> to add your own stationery items, set prices, and manage orders.
                </p>
                <a href="/supplier.html" class="primary" style="text-decoration: none; padding: 10px 20px;">Go to Supplier Hub</a>
            </div>
        `;
        return;
    }

    sorted.forEach((item) => {
        const card = document.createElement("article");
        card.className = "card";
        const safeAlt = `${item.name} product photo`.replace(/"/g, '&quot;');
        const badge = getProductBadge(item);
        const firstImg = item.image ? item.image.split(",")[0] : "";
        const thumbMarkup = firstImg
            ? `<img src="${firstImg}" alt="${safeAlt}" loading="lazy" />`
            : `<div class="thumb-fallback" aria-hidden="true">No image</div>`;
        card.innerHTML = `
            <div class="thumb">
                ${thumbMarkup}
                ${badge ? `<span class="product-badge ${badge.variant}">${badge.label}</span>` : ""}
                <span class="thumb-pill">${item.category}</span>
            </div>
            <h3>${item.name}</h3>
            <p>${item.description}</p>
            <div class="meta">
                <span>${formatPrice(item.price)}</span>
                <span>⭐ ${item.rating}</span>
            </div>
            <div class="actions">
                <button class="ghost" data-id="${item.id}" data-action="view">Details</button>
                <button class="primary" data-id="${item.id}" data-action="add">Add</button>
            </div>
        `;
        productsGrid.appendChild(card);
    });
}

function getHomeCategoryGroups(items = []) {
    const groups = new Map();
    items.forEach((item) => {
        const category = String(item.category || "Uncategorized").trim() || "Uncategorized";
        if (!groups.has(category)) {
            groups.set(category, []);
        }
        groups.get(category).push(item);
    });

    return Array.from(groups.entries())
        .map(([category, products]) => ({
            category,
            products,
            examples: products.slice(0, 2).map((product) => product.name).filter(Boolean)
        }))
        .sort((a, b) => b.products.length - a.products.length || a.category.localeCompare(b.category));
}

function renderHomeCategories(items = []) {
    if (!homeCategoryList) return;

    const groups = getHomeCategoryGroups(items);
    if (!groups.length) {
        homeCategoryList.innerHTML = `
            <li><button type="button" disabled><span class="cat-icon">--</span><span class="cat-copy"><span class="cat-label">Loading categories</span><span class="cat-meta">Products will appear here shortly</span></span></button></li>
        `;
        return;
    }

    homeCategoryList.innerHTML = groups.slice(0, 11).map((group, index) => {
        const exampleText = group.examples.length ? group.examples.join(" • ") : "Browse products";
        const isActive = activeFilter === group.category ? " is-active" : "";
        return `
            <li>
                <button type="button" class="${isActive.trim()}" data-home-category="${group.category.replace(/"/g, '&quot;')}">
                    <span class="cat-icon">${String(index + 1).padStart(2, "0")}</span>
                    <span class="cat-copy">
                        <span class="cat-label">${group.category}</span>
                        <span class="cat-meta">${group.products.length} products • ${exampleText}</span>
                    </span>
                </button>
            </li>
        `;
    }).join("");
}

function setHomeCategory(category) {
    if (!category) return;
    activeFilter = category;
    renderHomeCategories(catalog);
    renderProducts(getFilteredCatalog());
    document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function getProductBadge(item) {
    if (!item) return null;
    if (typeof item.stock === "number" && item.stock > 0 && item.stock <= 15) {
        return { label: "Low stock", variant: "warn" };
    }
    if (typeof item.rating === "number" && item.rating >= 4.6) {
        return { label: "Top rated", variant: "accent" };
    }
    if (typeof item.price === "number" && item.price <= 150) {
        return { label: "Best deal", variant: "deal" };
    }
    return null;
}

function sortProducts(list) {
    const sorted = [...list];
    switch (currentSort) {
        case "price-asc":
            return sorted.sort((a, b) => (a.price || 0) - (b.price || 0));
        case "price-desc":
            return sorted.sort((a, b) => (b.price || 0) - (a.price || 0));
        case "rating-desc":
            return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        case "name-asc":
            return sorted.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        default:
            return sorted;
    }
}

function getFilteredCatalog() {
    if (activeFilter === "all") return catalog;
    return catalog.filter((p) => p.category === activeFilter);
}

async function fetchCart() {
    if (!currentUser) {
        await renderGuestCart();
        return;
    }

    try {
        const res = await fetch("/api/cart", {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (!res.ok) throw new Error("Failed to fetch cart");
        const data = await res.json();
        renderCart(data.items, data.total || 0);
    } catch (err) {
        showToast("Error loading cart");
        console.error(err);
    }
}

function renderCart(items, total) {
    cartState = { items, total };
    cartItems.innerHTML = "";
    if (!items.length) {
        cartItems.innerHTML = "<p>Your cart is empty.</p>";
    } else {
        items.forEach((entry) => {
            const row = document.createElement("div");
            row.className = "cart-item";
            row.innerHTML = `
        <div class="row">
          <strong>${entry.product.name}</strong>
          <span>${formatPrice(entry.product.price)}</span>
        </div>
        <div class="row">
          <div class="qty">
            <button data-id="${entry.product.id}" data-action="dec">-</button>
            <span>${entry.quantity}</span>
            <button data-id="${entry.product.id}" data-action="inc">+</button>
          </div>
                    <button class="cart-remove-btn" data-id="${entry.product.id}" data-action="remove">Remove</button>
        </div>
      `;
            cartItems.appendChild(row);
        });
    }

    cartTotal.textContent = formatPrice(total);
    if (cartCount) {
        cartCount.textContent = items.reduce((acc, item) => acc + item.quantity, 0);
    }
}

function toggleCart(open) {
    if (!cartDrawer) return;
    cartDrawer.classList.toggle("open", open);
    cartDrawer.setAttribute("aria-hidden", open ? "false" : "true");
    document.body.classList.toggle("cart-open", open);
    const overlay = document.querySelector('.cart-overlay');
    if (overlay) overlay.classList.toggle('visible', open);
}

async function addToCart(productId, quantity = 1, options = {}) {
    if (!productId) return;
    if (!currentUser) {
        await addToGuestCart(productId, quantity);
        bounceCartCount();
        if (!options?.silent) {
            showToast("Added to cart. Login to checkout.");
        }
        toggleCart(true);
        return;
    }

    await addToCartServer(productId, quantity, options);
    bounceCartCount();
}

async function updateQuantity(productId, delta) {
    if (!productId) return;
    if (!currentUser) {
        await updateGuestQuantity(productId, delta);
        return;
    }

    try {
        const item = cartState.items.find((i) => i.product.id === productId);
        const nextQty = Math.max(0, (item?.quantity || 0) + delta);
        const res = await fetch(`/api/cart/${productId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({ quantity: nextQty })
        });
        if (!res.ok) throw new Error("Failed to update quantity");
        fetchCart();
    } catch (err) {
        showToast("Error updating cart");
        console.error(err);
    }
}

async function removeFromCart(productId) {
    if (!productId) return;
    if (!currentUser) {
        await removeGuestItem(productId);
        return;
    }

    try {
        const res = await fetch(`/api/cart/${productId}`, {
            method: "DELETE",
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (!res.ok) throw new Error("Failed to remove from cart");
        fetchCart();
    } catch (err) {
        showToast("Error removing item");
        console.error(err);
    }
}

function inferToastType(message = "") {
    const text = String(message).toLowerCase();
    if (/error|failed|unable|invalid|expired|network|please login|must|need\s+\d+\s+more|minimum/.test(text)) return "error";
    if (/success|successful|added|saved|sent|placed|welcome|logged out|synced|deleted/.test(text)) return "success";
    return "info";
}

function showToast(message, type) {
    if (!toast) {
        console.log(message);
        return;
    }
    toast.textContent = message;
    const variant = type || inferToastType(message);
    toast.classList.remove("success", "error");
    if (variant === "success" || variant === "error") {
        toast.classList.add(variant);
    }
    toast.classList.add("show");
    setTimeout(() => {
        toast.classList.remove("show");
        toast.classList.remove("success", "error");
    }, 2200);
}

function setSupportStatus(message, type = "success") {
    if (!supportStatus) return;
    supportStatus.hidden = false;
    supportStatus.textContent = message;
    supportStatus.className = `support-status form-feedback ${type}`;
}

// ─── Product Detail Modal ───
async function showProductModal(productId) {
    if (!productId) return;
    try {
        const res = await fetch(`/api/products/${encodeURIComponent(productId)}`);
        if (!res.ok) throw new Error("Product not found");
        const data = await res.json();
        const product = data.product || data;

        const existing = document.querySelector('.product-modal-overlay');
        if (existing) existing.remove();

        const imagesList = product.image ? product.image.split(",").filter(Boolean) : [];
        const mainImageSrc = imagesList[0] || "";
        
        let imagesMarkup = "";
        if (mainImageSrc) {
            imagesMarkup += `<img class="product-modal-img" src="${mainImageSrc}" alt="${(product.name || '').replace(/"/g, '&quot;')}" style="max-height: 280px; object-fit: contain; width: 100%; border-radius: 8px;" />`;
            if (imagesList.length > 1) {
                imagesMarkup += `
                    <div class="product-modal-thumbnails" style="display: flex; gap: 8px; justify-content: center; margin-top: 10px; margin-bottom: 5px; flex-wrap: wrap;">
                        ${imagesList.map((img, idx) => `
                            <img class="modal-thumb-item" src="${img}" data-index="${idx}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px; border: 2px solid ${idx === 0 ? '#c9972f' : '#e2e8f0'}; cursor: pointer; transition: all 0.2s;" />
                        `).join("")}
                    </div>
                `;
            }
        }

        const overlay = document.createElement('div');
        overlay.className = 'product-modal-overlay';
        overlay.innerHTML = `
            <div class="product-modal" style="display: flex; flex-direction: column; gap: 12px; max-width: 500px; padding: 24px;">
                <button class="product-modal-close" aria-label="Close" style="font-size: 28px; z-index: 10;">&times;</button>
                ${imagesMarkup}
                <div class="product-modal-body" style="padding-top: 5px;">
                    <span class="category-badge">${product.category || 'Product'}</span>
                    <h2>${product.name}</h2>
                    <p class="description">${product.description || ''}</p>
                    <div class="price-row">
                        <span class="price-tag">${formatPrice(product.price || 0)}</span>
                        <span class="rating">⭐ ${product.rating || 'N/A'}</span>
                    </div>
                    <div class="product-modal-actions">
                        <button class="primary modal-add-to-cart" data-id="${product.id}">Add to Cart</button>
                        <button class="ghost modal-close-btn">Close</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const closeModal = () => overlay.remove();

        overlay.querySelector('.product-modal-close').addEventListener('click', closeModal);
        overlay.querySelector('.modal-close-btn').addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        if (imagesList.length > 1) {
            overlay.querySelectorAll('.modal-thumb-item').forEach(thumb => {
                thumb.addEventListener('click', (e) => {
                    const src = e.target.src;
                    const mainImg = overlay.querySelector('.product-modal-img');
                    if (mainImg) mainImg.src = src;
                    
                    // Highlight selected thumbnail border
                    overlay.querySelectorAll('.modal-thumb-item').forEach(t => t.style.borderColor = '#e2e8f0');
                    e.target.style.borderColor = '#c9972f';
                });
            });
        }

        overlay.querySelector('.modal-add-to-cart').addEventListener('click', () => {
            addToCart(product.id, 1);
            closeModal();
        });

        document.addEventListener('keydown', function escHandler(e) {
            if (e.key === 'Escape') {
                closeModal();
                document.removeEventListener('keydown', escHandler);
            }
        });
    } catch (err) {
        showToast("Could not load product details");
        console.error(err);
    }
}

// ─── Skeleton Loading ───
function showSkeletonLoading() {
    if (!productsGrid) return;
    productsGrid.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-card';
        skeleton.innerHTML = `
            <div class="skeleton-thumb"></div>
            <div class="skeleton-line medium"></div>
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
        `;
        productsGrid.appendChild(skeleton);
    }
}

// ─── Scroll-to-Top ───
function initScrollToTop() {
    const btn = document.createElement('button');
    btn.className = 'scroll-top-btn';
    btn.innerHTML = '↑';
    btn.setAttribute('aria-label', 'Scroll to top');
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    window.addEventListener('scroll', () => {
        if (window.scrollY > 400) {
            btn.classList.add('visible');
        } else {
            btn.classList.remove('visible');
        }
    }, { passive: true });
}

// ─── Cart Overlay ───
function initCartOverlay() {
    const overlay = document.createElement('div');
    overlay.className = 'cart-overlay';
    document.body.appendChild(overlay);

    overlay.addEventListener('click', () => toggleCart(false));

    const origToggle = toggleCart;
    window._origToggleCart = origToggle;
}

// ─── Topbar Scroll Shadow ───
function initTopbarScroll() {
    const topbar = document.querySelector('.topbar');
    if (!topbar) return;

    window.addEventListener('scroll', () => {
        topbar.classList.toggle('scrolled', window.scrollY > 10);
    }, { passive: true });
}

// ─── Scroll Reveal (IntersectionObserver) ───
function initScrollReveal() {
    const revealEls = document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale');
    if (!revealEls.length) return;

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, i) => {
            if (entry.isIntersecting) {
                // stagger children slightly
                setTimeout(() => entry.target.classList.add('visible'), i * 80);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealEls.forEach(el => observer.observe(el));
}

// ─── Smooth Scroll for data-scroll buttons ───
function initSmoothScroll() {
    document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-scroll]');
        if (!trigger) return;
        e.preventDefault();
        const target = document.querySelector(trigger.dataset.scroll);
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });
}

// ─── Cart Count Bounce Animation ───
function bounceCartCount() {
    if (cartCount) {
        cartCount.classList.remove('cart-bounce');
        void cartCount.offsetWidth; // force reflow
        cartCount.classList.add('cart-bounce');
    }
}

if (productsGrid) {
    productsGrid.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;

        const action = target.dataset.action;
        const id = target.dataset.id;
        if (!action || !id) return;

        if (action === "add") {
            addToCart(id, 1);
        }

        if (action === "view") {
            showProductModal(id);
        }
    });
}

if (cartItems) {
    cartItems.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const { action, id } = target.dataset;
        if (!action || !id) return;

        if (action === "inc") updateQuantity(id, 1);
        if (action === "dec") updateQuantity(id, -1);
        if (action === "remove") removeFromCart(id);
    });
}

cartToggle?.addEventListener("click", () => toggleCart(true));
cartClose?.addEventListener("click", () => toggleCart(false));
viewCart?.addEventListener("click", () => toggleCart(true));
shopNow?.addEventListener("click", () => window.location.href = "/shop");

scrollButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        const target = btn.dataset.scroll;
        if (!target) return;
        const el = document.querySelector(target);
        if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    });
});

filterJumpButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
        const targetFilter = btn.dataset.filterJump;
        if (!targetFilter) return;
        const filterBtn = Array.from(filters).find((f) => f.dataset.filter === targetFilter);
        if (filterBtn) {
            filterBtn.click();
        }
        const catalogSection = document.getElementById("catalog");
        catalogSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
});

bundleTriggers.forEach((btn) => {
    btn.addEventListener("click", () => {
        const productId = btn.dataset.productId;
        const qty = Number(btn.dataset.qty) || 1;
        if (!productId) return;
        addToCart(productId, qty);
    });
});

const heroProductGrid = document.querySelector(".product-grid");
if (heroProductGrid) {
    heroProductGrid.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const btn = target.closest("[data-product-id]");
        if (!btn) return;
        const productId = btn.dataset.productId;
        if (!productId) return;
        addToCart(productId, 1);
    });
}

const debouncedSearch = debounce((query) => fetchProducts(query), 300);

if (searchBtn && searchInput) {
    searchBtn.addEventListener("click", () => fetchProducts(searchInput.value));
    searchInput.addEventListener("input", (e) => debouncedSearch(e.target.value));
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            clearTimeout(searchTimeout);
            fetchProducts(searchInput.value);
        }
    });
}

filters.forEach((btn) => {
    btn.addEventListener("click", () => {
        filters.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeFilter = btn.dataset.filter || "all";
        renderProducts(getFilteredCatalog());
    });
});

if (sortSelect) {
    sortSelect.addEventListener("change", () => {
        currentSort = sortSelect.value || "relevance";
        renderProducts(getFilteredCatalog());
    });
}

if (homeCategoryList) {
    homeCategoryList.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const button = target.closest("[data-home-category]");
        if (!button) return;
        setHomeCategory(button.dataset.homeCategory);
    });
}

function initBundleSorting() {
    const bundleGrid = document.querySelector(".bundle-grid .product-grid");
    const bundleCount = document.getElementById("bundle-count");
    const bundleSort = document.getElementById("bundle-sort");
    const compareClear = document.getElementById("compare-clear");
    if (!bundleGrid) return;
    const cards = Array.from(bundleGrid.querySelectorAll(".product-card"));
    if (!cards.length) return;
    cards.forEach((card, index) => {
        card.dataset.featuredIndex = String(index);
    });
    if (bundleCount) {
        bundleCount.textContent = String(cards.length);
    }
    if (!bundleSort) return;
    bundleSort.addEventListener("change", () => {
        const mode = bundleSort.value || "featured";
        const sorted = [...cards].sort((a, b) => {
            if (mode === "price-asc") {
                return Number(a.dataset.price || 0) - Number(b.dataset.price || 0);
            }
            if (mode === "price-desc") {
                return Number(b.dataset.price || 0) - Number(a.dataset.price || 0);
            }
            if (mode === "rating-desc") {
                return Number(b.dataset.rating || 0) - Number(a.dataset.rating || 0);
            }
            if (mode === "name-asc") {
                const nameA = a.querySelector("h4")?.textContent || "";
                const nameB = b.querySelector("h4")?.textContent || "";
                return nameA.localeCompare(nameB);
            }
            return Number(a.dataset.featuredIndex || 0) - Number(b.dataset.featuredIndex || 0);
        });
        sorted.forEach((card) => bundleGrid.appendChild(card));
    });

    bundleGrid.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest(".product-card");
        if (!card) return;
        if (target.closest("[data-bundle-view]")) {
            showBundleModal(card);
        }
        if (target.closest("[data-bundle-compare]")) {
            toggleBundleCompare(card);
        }
    });

    if (compareClear) {
        compareClear.addEventListener("click", () => {
            compareState.items = [];
            updateCompareUI();
        });
    }
}

function syncBundleCount() {
    const bundleCount = document.getElementById("bundle-count");
    if (!bundleCount) return;
    const count = document.querySelectorAll(".bundle-grid .product-card").length;
    if (count) {
        bundleCount.textContent = String(count);
    }
}

function getBundleData(card) {
    const name = card.dataset.bundleName || card.querySelector("h4")?.textContent || "Bundle";
    const price = Number(card.dataset.bundlePrice || card.dataset.price || 0);
    const rating = card.dataset.bundleRating || card.dataset.rating || "";
    const items = (card.dataset.bundleItems || "").split("|").filter(Boolean);
    const image = card.dataset.bundleImage || card.querySelector("img")?.src || "";
    return { name, price, rating, items, image, id: name.toLowerCase().replace(/\s+/g, "-") };
}

function showBundleModal(card) {
    const data = getBundleData(card);
    const existing = document.querySelector(".bundle-modal-overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.className = "bundle-modal-overlay";
    overlay.innerHTML = `
        <div class="bundle-modal" role="dialog" aria-modal="true">
            <button class="bundle-modal-close" aria-label="Close">&times;</button>
            ${data.image ? `<img class="bundle-modal-img" src="${data.image}" alt="${data.name}" />` : ""}
            <div class="bundle-modal-body">
                <span class="bundle-modal-pill">Bundle details</span>
                <h2>${data.name}</h2>
                <p class="bundle-modal-meta">${formatPrice(data.price)} ${data.rating ? `&bull; ★ ${data.rating}` : ""}</p>
                <ul class="bundle-modal-list">
                    ${data.items.map((item) => `<li>${item}</li>`).join("")}
                </ul>
                <div class="bundle-modal-actions">
                    <button class="ghost" data-bundle-compare>Compare</button>
                    <button class="primary" data-product-id="${card.querySelector('[data-product-id]')?.dataset.productId || ''}">Add to Cart</button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    const closeModal = () => overlay.remove();
    overlay.querySelector(".bundle-modal-close")?.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeModal();
    });
    overlay.querySelector("[data-bundle-compare]")?.addEventListener("click", () => {
        toggleBundleCompare(card);
        closeModal();
    });
    overlay.querySelector("[data-product-id]")?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        const productId = btn.dataset.productId;
        if (productId) addToCart(productId, 1);
        closeModal();
    });
}

function toggleBundleCompare(card) {
    const data = getBundleData(card);
    const existingIndex = compareState.items.findIndex((item) => item.id === data.id);
    if (existingIndex >= 0) {
        compareState.items.splice(existingIndex, 1);
    } else if (compareState.items.length < compareState.max) {
        compareState.items.push(data);
    } else {
        showToast("Select up to 3 kits to compare", "error");
    }
    updateCompareUI();
}

function updateCompareUI() {
    const container = document.getElementById("bundle-compare");
    const grid = document.getElementById("bundle-compare-grid");
    const compareButtons = document.querySelectorAll("[data-bundle-compare]");
    if (!container || !grid) return;
    if (compareState.items.length === 0) {
        container.classList.add("is-hidden");
        grid.innerHTML = "";
        compareButtons.forEach((btn) => btn.classList.remove("compare-selected"));
        return;
    }
    container.classList.remove("is-hidden");
    compareButtons.forEach((btn) => {
        const card = btn.closest(".product-card");
        if (!card) return;
        const id = getBundleData(card).id;
        btn.classList.toggle("compare-selected", compareState.items.some((item) => item.id === id));
    });
    const prices = compareState.items.map((item) => item.price);
    const ratings = compareState.items.map((item) => Number(item.rating || 0));
    const counts = compareState.items.map((item) => item.items.length);
    const minPrice = Math.min(...prices);
    const maxRating = Math.max(...ratings);
    const maxCount = Math.max(...counts);

    grid.innerHTML = compareState.items
        .map((item) => {
            const segment = getBundleSegment(item.name);
            const isBestPrice = item.price === minPrice;
            const isBestRating = Number(item.rating || 0) === maxRating && maxRating > 0;
            const isBestCount = item.items.length === maxCount && maxCount > 0;
            return `
            <article class="compare-card">
                ${item.image ? `<img src="${item.image}" alt="${item.name}" />` : ""}
                <h4>${item.name}</h4>
                <div class="compare-row ${isBestPrice ? "highlight" : ""}">
                    <span>Price</span>
                    <strong>${formatPrice(item.price)}</strong>
                </div>
                <div class="compare-row ${isBestRating ? "highlight" : ""}">
                    <span>Rating</span>
                    <strong>${item.rating ? `★ ${item.rating}` : "N/A"}</strong>
                </div>
                <div class="compare-row ${isBestCount ? "highlight" : ""}">
                    <span>Items</span>
                    <strong>${item.items.length}</strong>
                </div>
                <div class="compare-row">
                    <span>Segment</span>
                    <strong>${segment}</strong>
                </div>
                <ul>
                    ${item.items.map((entry) => `<li>${entry}</li>`).join("")}
                </ul>
            </article>
        `;
        })
        .join("");
}

function getBundleSegment(name = "") {
    const value = name.toLowerCase();
    if (value.includes("classroom") || value.includes("school")) return "Education";
    if (value.includes("corporate") || value.includes("office")) return "Corporate";
    if (value.includes("artist") || value.includes("creator") || value.includes("studio")) return "Creative";
    if (value.includes("founder")) return "Startup";
    return "General";
}

if (checkout) {
    checkout.addEventListener("click", () => {
        if (!currentUser) {
            showToast("Please login to checkout");
            window.location.href = '/login';
            return;
        }

        const totalQty = cartState.items.reduce((sum, item) => sum + item.quantity, 0);
        if (totalQty < 2) {
            showToast(`Need ${2 - totalQty} more items to place order (minimum 2 units)`);
            return;
        }
        checkoutFormContainer.style.display = "block";
        checkout.style.display = "none";
        document.getElementById('cart-drawer').classList.add('checkout-active');
        fetchAddresses();
        updateCheckoutSummary();
        updatePlaceOrderBtn();
        // Scroll the cart-summary so checkout form is visible
        setTimeout(() => {
            const summary = document.querySelector('.cart-summary');
            if (summary) summary.scrollTop = 0;
        }, 100);
    });
}

if (checkoutForm) {
    checkoutForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const totalQty = cartState.items.reduce((sum, item) => sum + item.quantity, 0);
        if (totalQty < 2) {
            showToast("Cart must have minimum 2 units");
            return;
        }

        // Validate payment method
        if (!validatePayment()) return;

        const placeBtn = document.getElementById('place-order-btn');
        const originalBtnHtml = placeBtn ? placeBtn.innerHTML : '';
        if (placeBtn) {
            placeBtn.disabled = true;
            placeBtn.innerHTML = '<span class="place-order-lock">&#8987;</span> Processing Payment...';
        }

        try {
            const paymentMethod = selectedPaymentMethod;
            const paymentDetail = getPaymentDetail();

            const res = await fetch("/api/orders", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify({
                    name: checkoutName.value,
                    email: checkoutEmail.value,
                    phone: checkoutPhone.value,
                    address_id: document.getElementById("checkout-address-id")?.value || null,
                    payment_method: paymentMethod,
                    payment_detail: paymentDetail
                })
            });

            if (!res.ok) throw new Error("Failed to place order");
            const data = await res.json();
            const order = data.order || data;

            // Simulate payment processing animation
            if (placeBtn) placeBtn.innerHTML = '<span class="place-order-lock">&#10003;</span> Payment Successful!';
            await new Promise(r => setTimeout(r, 800));

            showToast(`Order placed! ID: ${order.id}`);

            // Refresh cart state from server (server clears cart on success)
            await fetchCart();

            // Show order confirmation in drawer with payment info
            const itemsHtml = (order.items || [])
                .map((i) => `<li>${i.product.name} × ${i.quantity}</li>`)
                .join("");
            const payMethodLabel = {
                upi: '&#128177; UPI',
                card: '&#128179; Card',
                netbanking: '&#127974; Net Banking',
                wallet: '&#128176; Wallet',
                cod: '&#128230; Cash on Delivery'
            };
            orderConfirmation.innerHTML = `
                <div style="text-align:center; padding: 8px 0 4px;">
                    <div style="font-size:2.5rem; margin-bottom: 4px;">&#10004;&#65039;</div>
                    <h4 style="margin:0 0 4px 0; font-size:1rem; color:#059669;">Order Confirmed!</h4>
                </div>
                <div style="background:#f8f9ff; border-radius:10px; padding:12px; margin:8px 0;">
                    <p style="margin:0 0 4px 0; font-size:0.82rem;">Order ID: <strong>${order.id}</strong></p>
                    <p style="margin:0 0 4px 0; font-size:0.82rem;">Total: <strong>${formatPrice(order.total || 0)}</strong></p>
                    <p style="margin:0; font-size:0.82rem;">Payment: <strong>${payMethodLabel[paymentMethod] || paymentMethod}</strong></p>
                </div>
                <ul style="margin:6px 0 12px 0; padding-left: 18px; font-size: 0.82rem;">${itemsHtml}</ul>
                ${paymentMethod === 'cod' ? '<p style="font-size:0.78rem; color:#92400e; background:#fffbeb; padding:8px; border-radius:6px; margin:0 0 10px; text-align:center;">&#128230; Keep cash/UPI ready at delivery</p>' : '<p style="font-size:0.78rem; color:#059669; background:#ecfdf5; padding:8px; border-radius:6px; margin:0 0 10px; text-align:center;">&#128274; Payment secured. Receipt sent to your email.</p>'}
                <button id="continue-shopping" class="primary block">Continue Shopping</button>
            `;

            checkoutForm.reset();
            selectedPaymentMethod = 'upi';
            selectedBank = 'SBI';
            selectedWallet = '';
            checkoutFormContainer.style.display = "none";
            checkout.style.display = "none";
            orderConfirmation.style.display = "block";
            document.getElementById('cart-drawer').classList.remove('checkout-active');

            const contBtn = document.getElementById("continue-shopping");
            if (contBtn) {
                contBtn.addEventListener("click", () => {
                    orderConfirmation.style.display = "none";
                    checkout.style.display = "block";
                    toggleCart(false);
                });
            }
        } catch (err) {
            showToast("Error placing order");
            console.error(err);
            if (placeBtn) {
                placeBtn.disabled = false;
                placeBtn.innerHTML = originalBtnHtml;
            }
        }
    });
}

if (bulkForm) {
    bulkForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(bulkForm);
        const payload = {
            name: formData.get("name"),
            email: formData.get("email") || "",
            organization: formData.get("organization") || "",
            quantity: Number(formData.get("qty")) || 0,
            notes: formData.get("notes") || ""
        };
        try {
            const res = await fetch("/api/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            showToast(data.message || `Thanks ${payload.name || "there"}, request logged!`);
            bulkForm.reset();
        } catch (err) {
            showToast("Error submitting request. Please try again.");
            console.error(err);
        }
    });
}

const setTrackResult = (content) => {
    if (!orderTrackResult) return;
    if (!content) {
        orderTrackResult.style.display = "none";
        orderTrackResult.innerHTML = "";
        return;
    }
    orderTrackResult.style.display = "block";
    orderTrackResult.innerHTML = content;
};

if (trackForm) {
    trackForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const orderId = trackForm.order.value.trim();
        if (!orderId) return;
        setTrackResult("Checking status...");
        try {
            const headers = authToken ? { "Authorization": "Bearer " + authToken } : {};
            const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, { headers });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                const message = payload?.message || (res.status === 403 ? "Login to view order details" : "Order not found");
                showToast(message);
                setTrackResult(`<p>${message}</p>`);
                return;
            }
            const order = payload.order || payload;
            const items = (order.items || [])
                .map((item) => `<li>${item.product.name} × ${item.quantity}</li>`)
                .join("");
            setTrackResult(`
                <strong>Order ${order.id}</strong><br/>
                Status: ${order.status}<br/>
                Total: ${formatPrice(order.total || 0)}<br/>
                <ul>${items}</ul>
            `);
            showToast(`Order ${order.id} is ${order.status}`);
        } catch (err) {
            console.error(err);
            showToast("Unable to track order right now");
            setTrackResult("<p>Unable to track order right now. Please try later.</p>");
        }
    });
}

if (newsletterForm) {
    newsletterForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = new FormData(newsletterForm).get("email");
        try {
            const res = await fetch("/api/newsletter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            showToast(data.message || `Welcome aboard, ${email}!`);
            newsletterForm.reset();
        } catch (err) {
            showToast("Error subscribing. Please try again.");
            console.error(err);
        }
    });
}

if (supportForm) {
    supportForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const formData = new FormData(supportForm);
        const payload = {
            name: String(formData.get("name") || "").trim(),
            email: String(formData.get("email") || "").trim(),
            orderId: String(formData.get("orderId") || "").trim(),
            subject: String(formData.get("subject") || "").trim(),
            message: String(formData.get("message") || "").trim()
        };

        if (!payload.name || !payload.email || !payload.message) {
            setSupportStatus("Name, email, and message are required.", "error");
            return;
        }

        const submitButton = supportForm.querySelector('button[type="submit"]');
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = "Sending...";
        }

        try {
            const headers = { "Content-Type": "application/json" };
            if (authToken) {
                headers.Authorization = "Bearer " + authToken;
            }

            const res = await fetch("/api/support", {
                method: "POST",
                headers,
                body: JSON.stringify(payload)
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.message || "Could not submit support ticket.");
            }

            setSupportStatus(data.message || "Support ticket submitted.", "success");
            showToast("Support request sent");
            supportForm.reset();
        } catch (err) {
            const message = err?.message || "Error submitting support ticket.";
            setSupportStatus(message, "error");
            showToast("Support request failed");
            console.error(err);
        } finally {
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = "Send request";
            }
        }
    });
}

async function showMyOrders() {
    if (!currentUser) return;

    try {
        const res = await fetch('/api/orders', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });

        if (!res.ok) throw new Error('Failed to fetch orders');

        const data = await res.json();
        const orders = data.orders || data;

        // Create orders modal/page
        const ordersModal = document.createElement('div');
        ordersModal.className = 'orders-modal';
        ordersModal.innerHTML = `
            <div class="orders-overlay" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;">
                <div class="orders-content" style="background: #dfe8f5; padding: 24px; border-radius: 12px; max-width: 600px; max-height: 80vh; overflow-y: auto; width: 90%;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0;">My Orders</h2>
                        <button class="close-orders" style="background: none; border: none; font-size: 24px; cursor: pointer;">&times;</button>
                    </div>
                    ${orders.length === 0 ?
                '<p>You haven\'t placed any orders yet.</p>' :
                orders.map(order => `
                            <div class="order-card" style="border: 1px solid #ddd; border-radius: 8px; padding: 16px; margin-bottom: 12px;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                                    <strong>Order #${order.id}</strong>
                                    <span style="color: #6366f1;">${order.status}</span>
                                </div>
                                    <p style="margin: 4px 0; color: #666;">${new Date(order.placed_at || order.placedAt).toLocaleDateString()}</p>
                                <p style="margin: 4px 0;"><strong>Total: ${formatPrice(order.total)}</strong></p>
                                <details style="margin-top: 8px;">
                                    <summary style="cursor: pointer; color: #6366f1;">View Items (${order.total_quantity || order.totalQuantity} items)</summary>
                                    <ul style="margin-top: 8px; padding-left: 20px;">
                                        ${order.items.map(item => `<li>${item.product.name} × ${item.quantity}</li>`).join('')}
                                    </ul>
                                </details>
                            </div>
                        `).join('')
            }
                </div>
            </div>
        `;

        document.body.appendChild(ordersModal);

        // Close modal events
        const closeBtn = ordersModal.querySelector('.close-orders');
        const overlay = ordersModal.querySelector('.orders-overlay');

        const closeModal = () => {
            document.body.removeChild(ordersModal);
        };

        closeBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

    } catch (err) {
        showToast('Error loading orders');
        console.error(err);
    }
}

// ─── Address Management ───
let userAddresses = [];
let selectedAddressId = null;

async function fetchAddresses() {
    if (!currentUser) return;
    try {
        const res = await fetch("/api/addresses", {
            headers: { 'Authorization': 'Bearer ' + authToken }
        });
        if (!res.ok) return;
        const data = await res.json();
        userAddresses = data.addresses || [];
        renderSavedAddresses();
    } catch (err) {
        console.error("Error fetching addresses:", err);
    }
}

function renderSavedAddresses() {
    const container = document.getElementById("saved-addresses");
    if (!container) return;

    if (!userAddresses.length) {
        container.innerHTML = '<p class="address-empty">No saved addresses yet. Click <strong>+ Add New Address</strong> below.</p>';
        selectedAddressId = null;
        const hiddenInput = document.getElementById("checkout-address-id");
        if (hiddenInput) hiddenInput.value = "";
        return;
    }

    // Auto-select default or first address
    const defaultAddr = userAddresses.find(a => a.is_default) || userAddresses[0];
    if (!selectedAddressId) {
        selectedAddressId = defaultAddr.id;
    }

    container.innerHTML = userAddresses.map(addr => `
        <div class="address-card ${addr.id === selectedAddressId ? 'selected' : ''}" data-addr-id="${addr.id}">
            <div class="address-card-top">
                <span class="address-label-tag">${addr.label || 'Home'}</span>
                ${addr.is_default ? '<span class="address-default-badge">Default</span>' : ''}
                <div class="address-card-actions">
                    <button type="button" class="address-edit-btn" data-addr-id="${addr.id}" title="Edit">&#9998;</button>
                    <button type="button" class="address-delete-btn" data-addr-id="${addr.id}" title="Delete">&times;</button>
                </div>
            </div>
            <p class="address-card-name">${addr.full_name}</p>
            <p class="address-card-detail">${addr.address_line1}${addr.address_line2 ? ', ' + addr.address_line2 : ''}</p>
            <p class="address-card-detail">${addr.city}, ${addr.state} - ${addr.pincode}</p>
            ${addr.landmark ? `<p class="address-card-detail">Near: ${addr.landmark}</p>` : ''}
            <p class="address-card-phone">Phone: ${addr.phone}</p>
            ${addr.lat && addr.lng && addr.lat !== 0 && addr.lng !== 0 ? `<a class="address-map-link" href="https://www.google.com/maps?q=${addr.lat},${addr.lng}" target="_blank" rel="noopener">&#128506; View on Map</a>` : ''}
        </div>
    `).join("");

    // Set hidden input
    const hiddenInput = document.getElementById("checkout-address-id");
    if (hiddenInput) hiddenInput.value = selectedAddressId || "";

    // Selection event
    container.querySelectorAll(".address-card").forEach(card => {
        card.addEventListener("click", (e) => {
            if (e.target.closest(".address-edit-btn") || e.target.closest(".address-delete-btn")) return;
            selectedAddressId = Number(card.dataset.addrId);
            if (hiddenInput) hiddenInput.value = selectedAddressId;
            container.querySelectorAll(".address-card").forEach(c => c.classList.remove("selected"));
            card.classList.add("selected");
            showToast("Address selected");
        });
    });

    // Edit buttons
    container.querySelectorAll(".address-edit-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const addr = userAddresses.find(a => a.id === Number(btn.dataset.addrId));
            if (addr) showAddressModal(addr);
        });
    });

    // Delete buttons
    container.querySelectorAll(".address-delete-btn").forEach(btn => {
        btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm("Delete this address?")) return;
            try {
                const res = await fetch(`/api/addresses/${btn.dataset.addrId}`, {
                    method: "DELETE",
                    headers: { 'Authorization': 'Bearer ' + authToken }
                });
                if (res.ok) {
                    if (selectedAddressId === Number(btn.dataset.addrId)) selectedAddressId = null;
                    showToast("Address deleted");
                    await fetchAddresses();
                } else {
                    showToast("Failed to delete address");
                }
            } catch (err) {
                showToast("Error deleting address");
                console.error(err);
            }
        });
    });
}

// ─── Address Form Modal ───
function showAddressModal(editAddr = null, autoDetectLocation = false) {
    const existing = document.querySelector('.address-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'address-modal-overlay';
    overlay.innerHTML = `
        <div class="address-modal" role="dialog" aria-modal="true">
            <div class="address-modal-header">
                <h3>${editAddr ? 'Edit Address' : 'Add New Address'}</h3>
                <button type="button" class="address-modal-close" aria-label="Close">&times;</button>
            </div>
            <form id="address-form" class="address-form" novalidate>
                <div class="address-form-row">
                    <label>
                        Label
                        <select id="addr-label">
                            <option value="Home" ${editAddr?.label === 'Home' ? 'selected' : ''}>&#127968; Home</option>
                            <option value="Office" ${editAddr?.label === 'Office' ? 'selected' : ''}>&#127970; Office</option>
                            <option value="Other" ${editAddr?.label === 'Other' ? 'selected' : ''}>&#128205; Other</option>
                        </select>
                    </label>
                    <label class="addr-default-check">
                        <input type="checkbox" id="addr-is-default" ${editAddr?.is_default ? 'checked' : ''} />
                        Set as default
                    </label>
                </div>
                <div class="address-form-row">
                    <label>
                        Full Name <span class="required">*</span>
                        <input type="text" id="addr-fullname" placeholder="Full name" value="${editAddr?.full_name || ''}" required />
                    </label>
                    <label>
                        Phone <span class="required">*</span>
                        <input type="tel" id="addr-phone" placeholder="+91-98765-43210" value="${editAddr?.phone || ''}" required />
                    </label>
                </div>
                <label>
                    Address Line 1 <span class="required">*</span>
                    <input type="text" id="addr-line1" placeholder="Flat, house no., building, street" value="${editAddr?.address_line1 || ''}" required />
                </label>
                <label>
                    Address Line 2
                    <input type="text" id="addr-line2" placeholder="Area, colony (optional)" value="${editAddr?.address_line2 || ''}" />
                </label>
                <div class="address-form-row address-form-row-3">
                    <label>
                        City <span class="required">*</span>
                        <input type="text" id="addr-city" placeholder="City" value="${editAddr?.city || ''}" required />
                    </label>
                    <label>
                        State <span class="required">*</span>
                        <input type="text" id="addr-state" placeholder="State" value="${editAddr?.state || ''}" required />
                    </label>
                    <label>
                        Pincode <span class="required">*</span>
                        <input type="text" id="addr-pincode" placeholder="6-digit PIN" value="${editAddr?.pincode || ''}" required />
                    </label>
                </div>
                <label>
                    Landmark
                    <input type="text" id="addr-landmark" placeholder="Near landmark (optional)" value="${editAddr?.landmark || ''}" />
                </label>
                <input type="hidden" id="addr-lat" value="${editAddr?.lat || 0}" />
                <input type="hidden" id="addr-lng" value="${editAddr?.lng || 0}" />

                <div class="address-location-section">
                    <button type="button" id="addr-detect-location" class="ghost location-btn">
                        &#127759; Detect My Location
                    </button>
                    <div id="addr-map-preview" class="addr-map-preview" style="display:none;"></div>
                    <p id="addr-location-status" class="addr-location-status"></p>
                </div>

                <div class="address-form-actions">
                    <button type="button" id="addr-save-btn" class="primary addr-save-btn">${editAddr ? 'Update Address' : 'Save Address'}</button>
                    <button type="button" class="ghost address-cancel-btn">Cancel</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const closeModal = () => {
        _locationDetectionAborted = true;
        overlay.remove();
        document.body.style.overflow = '';
    };

    overlay.querySelector('.address-modal-close').addEventListener('click', closeModal);
    overlay.querySelector('.address-cancel-btn').addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    // Detect location button inside modal
    overlay.querySelector('#addr-detect-location').addEventListener('click', () => {
        detectLiveLocation(overlay);
    });

    // If editing with existing coords, show map preview (skip 0,0 — it's the default/empty value)
    if (editAddr?.lat && editAddr?.lng && editAddr.lat !== 0 && editAddr.lng !== 0) {
        showMapPreview(overlay, editAddr.lat, editAddr.lng);
    }

    // Save address handler (using button click, NOT form submit — avoids browser validation quirks)
    overlay.querySelector('#addr-save-btn').addEventListener('click', async () => {
        const fullname = overlay.querySelector('#addr-fullname').value.trim();
        const phone = overlay.querySelector('#addr-phone').value.trim();
        const line1 = overlay.querySelector('#addr-line1').value.trim();
        const city = overlay.querySelector('#addr-city').value.trim();
        const state = overlay.querySelector('#addr-state').value.trim();
        const pincode = overlay.querySelector('#addr-pincode').value.trim();

        // Manual validation
        if (!fullname || !phone || !line1 || !city || !state || !pincode) {
            showToast('Please fill all required fields (Name, Phone, Address, City, State, Pincode)');
            // Highlight empty fields
            ['#addr-fullname', '#addr-phone', '#addr-line1', '#addr-city', '#addr-state', '#addr-pincode'].forEach(sel => {
                const inp = overlay.querySelector(sel);
                if (inp && !inp.value.trim()) inp.style.borderColor = '#ef4444';
                else if (inp) inp.style.borderColor = '';
            });
            return;
        }

        if (pincode.length !== 6 || !/^\d{6}$/.test(pincode)) {
            showToast('Pincode must be exactly 6 digits');
            overlay.querySelector('#addr-pincode').style.borderColor = '#ef4444';
            return;
        }

        const saveBtn = overlay.querySelector('#addr-save-btn');
        const originalText = saveBtn.textContent;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        const payload = {
            label: overlay.querySelector('#addr-label').value,
            full_name: fullname,
            phone: phone,
            address_line1: line1,
            address_line2: overlay.querySelector('#addr-line2').value.trim(),
            city: city,
            state: state,
            pincode: pincode,
            landmark: overlay.querySelector('#addr-landmark').value.trim(),
            lat: parseFloat(overlay.querySelector('#addr-lat').value) || 0,
            lng: parseFloat(overlay.querySelector('#addr-lng').value) || 0,
            is_default: overlay.querySelector('#addr-is-default').checked ? 1 : 0,
        };

        try {
            const url = editAddr ? `/api/addresses/${editAddr.id}` : '/api/addresses';
            const method = editAddr ? 'PUT' : 'POST';
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || 'Address saved successfully!');
                if (!editAddr && data.address) {
                    selectedAddressId = data.address.id;
                }
                await fetchAddresses();
                closeModal();
            } else {
                showToast(data.message || 'Error saving address. Please try again.');
                saveBtn.disabled = false;
                saveBtn.textContent = originalText;
            }
        } catch (err) {
            showToast('Network error. Please check your connection and try again.');
            console.error('Address save error:', err);
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    });

    // Also support Enter key in form fields
    overlay.querySelector('#address-form').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
            e.preventDefault();
            overlay.querySelector('#addr-save-btn').click();
        }
    });

    // Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);

    // Auto-detect location if requested
    if (autoDetectLocation) {
        setTimeout(() => detectLiveLocation(overlay), 300);
    }
}

// ─── Live Location Detection ───
let _locationDetectionAborted = false;

function detectLiveLocation(container) {
    const statusEl = container.querySelector('#addr-location-status');
    const detectBtn = container.querySelector('#addr-detect-location');

    if (!statusEl || !detectBtn) return;

    _locationDetectionAborted = false;

    // Check if geolocation is available
    if (!navigator.geolocation) {
        statusEl.textContent = 'Geolocation is not supported by your browser. Please enter your address manually.';
        statusEl.className = 'addr-location-status error';
        return;
    }

    // Check if secure context is available (modern browsers require it for geolocation)
    if (window.isSecureContext === false) {
        statusEl.innerHTML = 'Location detection requires a secure connection (HTTPS). You can still enter your address manually below.';
        statusEl.className = 'addr-location-status warning';
        return;
    }

    statusEl.textContent = 'Detecting your location... Please allow location access if prompted.';
    statusEl.className = 'addr-location-status loading';
    detectBtn.disabled = true;
    detectBtn.innerHTML = '&#8987; Detecting...';

    // Helper: handle successful position
    async function onPositionSuccess(position) {
        // Check if modal was closed / container removed during async operation
        if (_locationDetectionAborted || !document.body.contains(container)) {
            return;
        }

        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = Math.round(position.coords.accuracy);

        const latInput = container.querySelector('#addr-lat');
        const lngInput = container.querySelector('#addr-lng');
        if (latInput) latInput.value = lat;
        if (lngInput) lngInput.value = lng;

        showMapPreview(container, lat, lng);

        // Reverse geocode using free Nominatim API (OpenStreetMap)
        try {
            if (statusEl) {
                statusEl.textContent = `Location found (±${accuracy}m)! Fetching address details...`;
                statusEl.className = 'addr-location-status loading';
            }

            const geoRes = await fetch(
                `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
                {
                    headers: { 'Accept-Language': 'en', 'User-Agent': 'StationeryHub/1.0' },
                    signal: AbortSignal.timeout(10000)
                }
            );

            if (!geoRes.ok) throw new Error(`Geocode API returned ${geoRes.status}`);
            const geoData = await geoRes.json();

            // Check container still exists after async fetch
            if (!document.body.contains(container)) return;

            if (geoData && geoData.address) {
                const a = geoData.address;

                const line1 = container.querySelector('#addr-line1');
                const line2 = container.querySelector('#addr-line2');
                const city = container.querySelector('#addr-city');
                const state = container.querySelector('#addr-state');
                const pincode = container.querySelector('#addr-pincode');
                const landmark = container.querySelector('#addr-landmark');

                // Build smart address components (handles Indian address formats)
                const houseRoad = [a.house_number, a.road, a.street].filter(Boolean).join(' ');
                const area = [a.neighbourhood, a.suburb, a.quarter, a.residential].filter(Boolean).join(', ');

                // Fill address fields with robust fallbacks
                if (line1) line1.value = houseRoad || a.display_name?.split(',').slice(0, 2).join(', ').trim() || '';
                if (line2) line2.value = area || [a.hamlet, a.locality].filter(Boolean).join(', ') || '';
                if (city) city.value = a.city || a.town || a.village || a.state_district || a.county || '';
                if (state) state.value = a.state || '';
                if (pincode) pincode.value = a.postcode || '';
                if (landmark) {
                    const lm = a.amenity || a.building || a.shop || a.office || '';
                    if (lm) landmark.value = lm;
                }

                // Clear any error styling
                [line1, line2, city, state, pincode, landmark].forEach(inp => {
                    if (inp) inp.style.borderColor = '';
                });

                if (statusEl) {
                    statusEl.innerHTML = `&#10003; Location detected (±${accuracy}m) and address auto-filled! Please verify the details.`;
                    statusEl.className = 'addr-location-status success';
                }
            } else {
                if (statusEl) {
                    statusEl.textContent = 'Location coordinates saved. Address could not be resolved — please fill in manually.';
                    statusEl.className = 'addr-location-status warning';
                }
            }
        } catch (geoErr) {
            console.error('Reverse geocode error:', geoErr);
            if (document.body.contains(container) && statusEl) {
                statusEl.textContent = 'Location saved on map. Could not auto-fill address — please type it manually.';
                statusEl.className = 'addr-location-status warning';
            }
        }

        if (document.body.contains(container) && detectBtn) {
            detectBtn.disabled = false;
            detectBtn.innerHTML = '&#127759; Re-detect Location';
        }
    }

    // Helper: handle geolocation error with fallback
    function onPositionError(error, wasHighAccuracy) {
        // If high accuracy failed, retry with low accuracy as fallback
        if (wasHighAccuracy && error.code !== 1) {
            // code 1 = PERMISSION_DENIED → no point retrying
            if (statusEl && document.body.contains(container)) {
                statusEl.textContent = 'Trying with lower accuracy...';
                statusEl.className = 'addr-location-status loading';
            }
            navigator.geolocation.getCurrentPosition(
                onPositionSuccess,
                (err) => onPositionError(err, false),
                { enableHighAccuracy: false, timeout: 15000, maximumAge: 60000 }
            );
            return;
        }

        if (!document.body.contains(container)) return;

        const messages = {
            1: 'Location access was denied. Please go to your browser\'s Settings → Privacy → Location and allow access for this site, then click "Detect My Location" again.',
            2: 'Your location could not be determined. Please make sure Location/GPS is enabled on your device, then try again.',
            3: 'Location request timed out. Please check your internet connection and try again.'
        };
        if (statusEl) {
            statusEl.textContent = messages[error.code] || 'Could not detect location. Please enter your address manually.';
            statusEl.className = 'addr-location-status error';
        }
        if (detectBtn) {
            detectBtn.disabled = false;
            detectBtn.innerHTML = '&#127759; Detect My Location';
        }
    }

    // First try with high accuracy, falls back automatically
    navigator.geolocation.getCurrentPosition(
        onPositionSuccess,
        (err) => onPositionError(err, true),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
}

function showMapPreview(container, lat, lng) {
    const mapDiv = container.querySelector('#addr-map-preview');
    if (!mapDiv) return;
    if (!lat || !lng || (lat === 0 && lng === 0)) {
        mapDiv.style.display = 'none';
        return;
    }
    mapDiv.style.display = 'block';
    mapDiv.innerHTML = `
        <iframe
            width="100%" height="200" style="border:0; border-radius:10px;"
            loading="lazy"
            referrerpolicy="no-referrer-when-downgrade"
            src="https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.005},${lat - 0.003},${lng + 0.005},${lat + 0.003}&layer=mapnik&marker=${lat},${lng}"
            allowfullscreen>
        </iframe>
        <a class="address-map-fulllink" href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener">
            &#128506; Open in Google Maps
        </a>
    `;
}

// ─── Attach address UI events ───
function initAddressUI() {
    const addBtn = document.getElementById("add-address-btn");
    const locationBtn = document.getElementById("use-location-btn");

    if (addBtn) {
        addBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!currentUser) { showToast("Please login to add address"); window.location.href = '/login'; return; }
            showAddressModal(null, false);
        });
    }

    if (locationBtn) {
        locationBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!currentUser) { showToast("Please login first"); window.location.href = '/login'; return; }
            showAddressModal(null, true);
        });
    }
}

// ─── Payment Gateway Logic (Amazon/Flipkart style) ───
let selectedPaymentMethod = 'upi';
let selectedBank = 'SBI';
let selectedWallet = '';

function initPaymentUI() {
    const methodsContainer = document.getElementById('payment-methods');
    if (!methodsContainer) return;

    const methods = methodsContainer.querySelectorAll('.payment-method');
    const details = {
        upi: document.getElementById('detail-upi'),
        card: document.getElementById('detail-card'),
        netbanking: document.getElementById('detail-netbanking'),
        wallet: document.getElementById('detail-wallet'),
        cod: document.getElementById('detail-cod')
    };

    // Payment method selection
    methods.forEach(method => {
        method.addEventListener('click', () => {
            const methodKey = method.dataset.method;
            selectedPaymentMethod = methodKey;

            // Update radio buttons
            methods.forEach(m => m.classList.remove('selected'));
            method.classList.add('selected');

            // Show/hide detail panels
            Object.entries(details).forEach(([key, panel]) => {
                if (panel) panel.style.display = key === methodKey ? 'block' : 'none';
            });

            // Update hidden field
            const payInput = document.getElementById('checkout-payment-method');
            if (payInput) payInput.value = methodKey;

            // Update place order button text
            updatePlaceOrderBtn();
        });
    });

    // Card number formatting (add spaces every 4 digits)
    const cardNumInput = document.getElementById('pay-card-number');
    if (cardNumInput) {
        cardNumInput.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '').substring(0, 16);
            val = val.replace(/(.{4})/g, '$1 ').trim();
            e.target.value = val;
        });
    }

    // Card expiry formatting (MM/YY)
    const cardExpiry = document.getElementById('pay-card-expiry');
    if (cardExpiry) {
        cardExpiry.addEventListener('input', (e) => {
            let val = e.target.value.replace(/\D/g, '').substring(0, 4);
            if (val.length >= 2) val = val.substring(0, 2) + '/' + val.substring(2);
            e.target.value = val;
        });
    }

    // Bank selection grid
    const bankBtns = methodsContainer.querySelectorAll('.bank-option');
    const bankSelect = document.getElementById('pay-bank-select');
    bankBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            bankBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedBank = btn.dataset.bank;
            if (bankSelect) bankSelect.value = selectedBank;
        });
    });
    if (bankSelect) {
        bankSelect.addEventListener('change', () => {
            selectedBank = bankSelect.value;
            bankBtns.forEach(b => {
                b.classList.toggle('selected', b.dataset.bank === selectedBank);
            });
        });
    }

    // Wallet selection
    const walletBtns = methodsContainer.querySelectorAll('.wallet-option');
    walletBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            walletBtns.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedWallet = btn.dataset.wallet;
        });
    });
}

function updatePlaceOrderBtn() {
    const btn = document.getElementById('place-order-btn');
    if (!btn) return;
    const labels = {
        upi: 'Pay with UPI',
        card: 'Pay with Card',
        netbanking: 'Pay via Net Banking',
        wallet: 'Pay via Wallet',
        cod: 'Place Order (COD)'
    };
    btn.innerHTML = `<span class="place-order-lock">&#128274;</span> ${labels[selectedPaymentMethod] || 'Place Order & Pay'}`;
}

function updateCheckoutSummary() {
    const summaryDiv = document.getElementById('checkout-order-summary');
    if (!summaryDiv) return;

    const totalQty = cartState.items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = cartState.total || cartState.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const deliveryFee = subtotal >= 500 ? 0 : 49;
    const total = subtotal + deliveryFee;

    summaryDiv.innerHTML = `
        <div class="summary-row">
            <span>Items (${totalQty})</span>
            <span>${formatPrice(subtotal)}</span>
        </div>
        <div class="summary-row">
            <span>Delivery</span>
            <span>${deliveryFee === 0 ? '<span class="savings">FREE</span>' : formatPrice(deliveryFee)}</span>
        </div>
        ${deliveryFee === 0 ? `<div class="summary-row"><span></span><span class="savings">You save &#8377;49 on delivery!</span></div>` : ''}
        <div class="summary-row total">
            <span>Order Total</span>
            <span>${formatPrice(total)}</span>
        </div>
    `;
}

function getPaymentDetail() {
    const method = selectedPaymentMethod;
    if (method === 'upi') {
        const upiId = document.getElementById('pay-upi-id')?.value.trim() || '';
        return upiId ? `UPI: ${upiId}` : 'UPI';
    }
    if (method === 'card') {
        const last4 = (document.getElementById('pay-card-number')?.value || '').replace(/\s/g, '').slice(-4);
        return last4 ? `Card ending ${last4}` : 'Card';
    }
    if (method === 'netbanking') {
        return `Net Banking: ${selectedBank || 'Not selected'}`;
    }
    if (method === 'wallet') {
        return `Wallet: ${selectedWallet || 'Not selected'}`;
    }
    if (method === 'cod') {
        return 'Cash on Delivery';
    }
    return method;
}

function validatePayment() {
    const method = selectedPaymentMethod;

    if (method === 'upi') {
        const upiId = document.getElementById('pay-upi-id')?.value.trim();
        if (!upiId || !upiId.includes('@')) {
            showToast('Please enter a valid UPI ID (e.g. name@upi)');
            document.getElementById('pay-upi-id')?.focus();
            return false;
        }
    }

    if (method === 'card') {
        const cardNum = (document.getElementById('pay-card-number')?.value || '').replace(/\s/g, '');
        const expiry = document.getElementById('pay-card-expiry')?.value || '';
        const cvv = document.getElementById('pay-card-cvv')?.value || '';
        const cardName = document.getElementById('pay-card-name')?.value.trim() || '';

        if (cardNum.length < 13 || cardNum.length > 19) {
            showToast('Please enter a valid card number');
            document.getElementById('pay-card-number')?.focus();
            return false;
        }
        if (!/^\d{2}\/\d{2}$/.test(expiry)) {
            showToast('Please enter card expiry (MM/YY)');
            document.getElementById('pay-card-expiry')?.focus();
            return false;
        }
        // Check expiry is not past
        const [mm, yy] = expiry.split('/').map(Number);
        const now = new Date();
        const expDate = new Date(2000 + yy, mm);
        if (expDate < now) {
            showToast('Card has expired. Please use a different card.');
            document.getElementById('pay-card-expiry')?.focus();
            return false;
        }
        if (cvv.length < 3) {
            showToast('Please enter a valid CVV');
            document.getElementById('pay-card-cvv')?.focus();
            return false;
        }
        if (!cardName) {
            showToast('Please enter the name on card');
            document.getElementById('pay-card-name')?.focus();
            return false;
        }
    }

    if (method === 'netbanking') {
        if (!selectedBank) {
            showToast('Please select a bank for Net Banking');
            return false;
        }
    }

    if (method === 'wallet') {
        if (!selectedWallet) {
            showToast('Please select a wallet');
            return false;
        }
    }

    return true;
}

// initialize
(async () => {
    initScrollToTop();
    initCartOverlay();
    initTopbarScroll();
    initScrollReveal();
    initSmoothScroll();
    initAddressUI();
    initPaymentUI();
    initBundleSorting();
    syncBundleCount();
    await checkAuth();
    if (productsGrid) {
        await fetchProducts();
    }
    await fetchCart();
})();
