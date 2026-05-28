const supplierState = {
    token: localStorage.getItem("supplierToken") || "",
    products: [],
    orders: [],
    selectedProductIds: new Set(),
    returns: [],
    tickets: [],
    analytics: null,
    analyticsSchedule: null,
    orderExportColumns: [
        'id',
        'status',
        'total',
        'total_quantity',
        'customer_name',
        'customer_phone',
        'placed_at',
        'items'
    ]
};
let productPagination = { page: 1, size: 12 };
let inlineEditId = '';
let productImagesList = [];
let supplierVisibilityAllowed = false;
let setProductsView = null;
let loadingTimer = null;
let productSearchQuery = '';
let selectedProductCategory = 'all';
let selectedOrderCategory = 'all';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char] || char));
}

function normalizeCurrencyNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function getProductPricing(product = {}) {
    const sellingPrice = Math.max(0, normalizeCurrencyNumber(product.price, 0));
    const mrpRaw = normalizeCurrencyNumber(product.mrp, sellingPrice || 0);
    const mrp = Math.max(sellingPrice, mrpRaw);
    const discountPercent = mrp > 0 && sellingPrice > 0 && sellingPrice < mrp
        ? Math.round(((mrp - sellingPrice) / mrp) * 100)
        : 0;

    return {
        sellingPrice,
        mrp,
        discountPercent,
        hasDiscount: discountPercent > 0
    };
}

function formatDiscountLabel(product = {}) {
    const pricing = getProductPricing(product);
    if (!pricing.hasDiscount) {
        return `Selling price: ₹${pricing.sellingPrice.toFixed(2)} | No discount`;
    }

    return `MRP ₹${pricing.mrp.toFixed(2)} → Selling price ₹${pricing.sellingPrice.toFixed(2)} | ${pricing.discountPercent}% off`;
}

function updateProductDiscountPreview() {
    const preview = document.getElementById('product-discount-preview');
    if (!preview) return;

    const mrp = normalizeCurrencyNumber(document.getElementById('product-mrp')?.value, 0);
    const sellingPrice = normalizeCurrencyNumber(document.getElementById('product-price')?.value, 0);
    const pricing = getProductPricing({ mrp, price: sellingPrice });

    if (!mrp || !sellingPrice) {
        preview.textContent = 'Enter MRP and selling price to calculate discount.';
        return;
    }

    if (pricing.discountPercent <= 0) {
        preview.textContent = `No discount. Customer price is ₹${pricing.sellingPrice.toFixed(2)}.`;
        return;
    }

    preview.textContent = `${pricing.discountPercent}% discount | Save ₹${(pricing.mrp - pricing.sellingPrice).toFixed(2)} per unit`;
}

function normalizeCategory(value) {
    const normalized = String(value || '').trim();
    return normalized || 'Uncategorized';
}

function getProductCategories(products = []) {
    return Array.from(new Set(products.map((p) => normalizeCategory(p.category)))).sort((a, b) => a.localeCompare(b));
}

function getOrderCategories(orders = []) {
    const categories = new Set();
    orders.forEach((order) => {
        (order.items || []).forEach((item) => {
            categories.add(normalizeCategory(item.category));
        });
    });
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
}

function buildCategoryOptions(categories, selected = 'all') {
    const options = ['<option value="all">Categories</option>'];
    categories.forEach((category) => {
        const value = escapeAttr(category);
        const isSelected = selected === category ? ' selected' : '';
        options.push(`<option value="${value}"${isSelected}>${escapeHtml(category)}</option>`);
    });
    return options.join('');
}

function populateProductCategoryFilter() {
    const select = document.getElementById('products-category-filter');
    if (!select) return;
    const categories = getProductCategories(supplierState.products || []);
    if (selectedProductCategory !== 'all' && !categories.includes(selectedProductCategory)) {
        selectedProductCategory = 'all';
    }
    select.innerHTML = buildCategoryOptions(categories, selectedProductCategory);
}

function populateOrdersCategoryFilter() {
    const select = document.getElementById('orders-category-filter');
    if (!select) return;
    const categories = getOrderCategories(supplierState.orders || []);
    if (selectedOrderCategory !== 'all' && !categories.includes(selectedOrderCategory)) {
        selectedOrderCategory = 'all';
    }
    select.innerHTML = buildCategoryOptions(categories, selectedOrderCategory);
}

function getFilteredProducts() {
    const q = productSearchQuery;
    return (supplierState.products || []).filter((product) => {
        const category = normalizeCategory(product.category);
        const matchesCategory = selectedProductCategory === 'all' || category === selectedProductCategory;
        const matchesQuery = !q || (product.name || '').toLowerCase().includes(q) || category.toLowerCase().includes(q);
        return matchesCategory && matchesQuery;
    });
}

function getFilteredOrders() {
    if (selectedOrderCategory === 'all') return supplierState.orders || [];
    return (supplierState.orders || []).filter((order) => {
        return (order.items || []).some((item) => normalizeCategory(item.category) === selectedOrderCategory);
    });
}


// Support both embedded console (id="supplier-console") and standalone page (.supplier-wrap)
const supplierSection = document.getElementById("supplier-console") || document.querySelector('.supplier-wrap') || null;
const loginCard = document.getElementById("supplier-login-card");
const loadingCard = document.getElementById("supplier-loading");
const dashboard = document.getElementById("supplier-dashboard");
const loginForm = document.getElementById("supplier-login-form");
const loginMessage = document.getElementById("supplier-login-message");
const logoutBtn = document.getElementById("supplier-logout");
const backBtn = document.getElementById("supplier-back");
const productForm = document.getElementById("supplier-product-form");
const productFormMessage = document.getElementById("product-form-message");
const productList = document.getElementById("supplier-product-list");
const pricingList = document.getElementById("supplier-pricing-list");
const inlineEditError = document.getElementById("inline-edit-error");
const ordersList = document.getElementById("supplier-orders");
const ordersQueueList = document.getElementById("supplier-orders-queue");
const resetBtn = document.getElementById("product-reset");
const returnsList = document.getElementById("supplier-returns-list");

function authHeaders() {
    return supplierState.token ? { Authorization: `Bearer ${supplierState.token}` } : {};
}

function setStatusMessage(el, message, isError = false) {
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", isError);
}

function setInlineError(message) {
    if (!inlineEditError) return;
    inlineEditError.textContent = message || '';
    inlineEditError.hidden = !message;
}

async function apiRequest(path, options = {}) {
    const headers = {
        "Content-Type": "application/json",
        ...authHeaders(),
        ...(options.headers || {})
    };

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        const message = data.message || "Request failed.";
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }
    return data;
}

function showDashboard() {
    supplierSection.hidden = false;
    if (loadingCard) loadingCard.hidden = true;
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    loginCard.hidden = true;
    dashboard.hidden = false;
}

function showLogin() {
    supplierSection.hidden = false;
    if (loadingCard) loadingCard.hidden = true;
    if (loadingTimer) { clearTimeout(loadingTimer); loadingTimer = null; }
    loginCard.hidden = false;
    dashboard.hidden = true;
}

function showLoading() {
    supplierSection.hidden = false;
    if (loadingCard) loadingCard.hidden = false;
    if (loginCard) loginCard.hidden = true;
    if (dashboard) dashboard.hidden = true;
}

function resetProductForm() {
    if (productForm) productForm.reset();
    const idEl = document.getElementById("product-id");
    if (idEl) idEl.value = "";
    productImagesList = [];
    renderImagesPreview();
    updateProductDiscountPreview();
    setStatusMessage(productFormMessage, "");
}

function toBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

function renderImagesPreview() {
    const previewContainer = document.getElementById("product-images-preview");
    if (!previewContainer) return;

    if (productImagesList.length === 0) {
        previewContainer.innerHTML = "<p class='muted small-text' style='margin: 0; color: #94a3b8; font-size: 0.82rem;'>No images selected yet.</p>";
        return;
    }

    previewContainer.innerHTML = productImagesList.map((img, index) => {
        return `
            <div class="image-preview-thumbnail" style="position: relative; width: 80px; height: 80px; border-radius: 8px; overflow: hidden; border: 1.5px solid #e2e8f0; box-shadow: 0 2px 6px rgba(0,0,0,0.06); background: white;">
                <img src="${img}" style="width: 100%; height: 100%; object-fit: cover;" />
                <button type="button" class="btn-delete-preview" data-index="${index}" style="position: absolute; top: 4px; right: 4px; background: #ef4444; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 11px; cursor: pointer; padding: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.2); font-weight: bold; line-height: 1;">&times;</button>
            </div>
        `;
    }).join("");

    // Wire up delete buttons
    previewContainer.querySelectorAll(".btn-delete-preview").forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const index = parseInt(btn.getAttribute("data-index"));
            productImagesList.splice(index, 1);
            renderImagesPreview();
        };
    });
}

function escapeAttr(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function getUserToken() {
    return localStorage.getItem("token") || "";
}

function isJwtLikeToken(token) {
    return typeof token === "string" && token.split(".").length === 3;
}

async function validateSupplierToken(token) {
    if (!token || !isJwtLikeToken(token)) return false;
    try {
        const res = await fetch('/api/supplier/me', {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) return true;
        if (res.status === 401 || res.status === 403) return false;
        return true;
    } catch (_err) {
        return false;
    }
}

function buildProductRowMarkup(product) {
    const featuredBadge = product.featured ? "<span class=\"pill\">Featured</span>" : "";
    const isEditing = inlineEditId === product.id;
    const selectedAttr = supplierState.selectedProductIds.has(product.id) ? 'checked' : '';
    const pricing = getProductPricing(product);
    const priceMarkup = pricing.hasDiscount
        ? `<div class="muted"><span style="text-decoration: line-through; color: #94a3b8;">₹${escapeHtml(pricing.mrp.toFixed(2))}</span> <strong style="color: #0f172a;">₹${escapeHtml(pricing.sellingPrice.toFixed(2))}</strong> <span class="pill" style="margin-left: 6px;">${pricing.discountPercent}% off</span></div>`
        : `<div class="muted">₹${escapeHtml(pricing.sellingPrice.toFixed(2))}</div>`;
    return `
        <div class="supplier-row" data-product-id="${product.id}" tabindex="0">
            <div style="width:28px"><input aria-label="Select ${escapeAttr(product.name)}" type="checkbox" class="bulk-select" data-id="${product.id}" ${selectedAttr} /></div>
            <div>
                <strong>${escapeHtml(product.name)}</strong>
                <div class="muted">${escapeHtml(product.category || '')} ${featuredBadge}</div>
                ${priceMarkup}
                <div class="muted">Stock ${escapeHtml(product.stock)}</div>
            </div>
            <div class="row-actions">
                <button class="ghost btn-icon" data-action="edit" data-id="${product.id}" aria-label="Edit ${escapeAttr(product.name)}"><svg class="icon" aria-hidden="true"><use href="#icon-edit"></use></svg>Edit</button>
                <button class="ghost danger btn-icon" data-action="delete" data-id="${product.id}" aria-label="Delete ${escapeAttr(product.name)}"><svg class="icon" aria-hidden="true"><use href="#icon-close"></use></svg>Delete</button>
            </div>
        </div>
        ${isEditing ? renderInlineEditor(product) : ''}
    `;
}

function renderProducts() {
    if (!productList) {
        if (pricingList) renderPricing();
        return;
    }
    if (!supplierState.products.length) {
        productList.innerHTML = "<p class=\"muted\">No products yet. Add your first product.</p>";
        return;
    }

    const sorted = getFilteredProducts();
    if (!sorted.length) {
        productList.innerHTML = "<p class=\"muted\">No products found for selected category/search.</p>";
        const pageInfoEmpty = document.getElementById('product-page-info');
        if (pageInfoEmpty) pageInfoEmpty.textContent = 'Page 1 of 1';
        return;
    }

    const page = productPagination.page || 1;
    const size = productPagination.size || 12;
    const totalPages = Math.max(1, Math.ceil(sorted.length / size));
    if (productPagination.page > totalPages) {
        productPagination.page = totalPages;
    }
    const currentPage = productPagination.page || 1;
    const start = (currentPage - 1) * size;
    const pageItems = sorted.slice(start, start + size);

    productList.innerHTML = pageItems
        .map((product) => buildProductRowMarkup(product))
        .join("");

    // update page info
    const pageInfo = document.getElementById('product-page-info');
    if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    const prev = document.getElementById('product-prev');
    const next = document.getElementById('product-next');
    if (prev) prev.disabled = currentPage <= 1;
    if (next) next.disabled = currentPage >= totalPages;
    syncBulkSelectionUI();
}

async function loadReturns() {
    try {
        const data = await apiRequest("/api/supplier/returns");
        supplierState.returns = data.returns || [];
        renderReturns();
        updateReturnsStats();
    } catch (err) {
        console.warn("Error loading returns:", err);
    }
}

function updateReturnsStats() {
    const totalEl = document.getElementById("returns-strip-total");
    const pendingEl = document.getElementById("returns-strip-pending");
    if (!totalEl && !pendingEl) return;

    const list = supplierState.returns || [];
    const total = list.length;
    const pending = list.filter(r => r.status === "Pending").length;

    if (totalEl) totalEl.textContent = String(total);
    if (pendingEl) pendingEl.textContent = String(pending);
}

function renderReturns() {
    if (!returnsList) return;
    const list = supplierState.returns || [];
    
    if (list.length === 0) {
        returnsList.innerHTML = "<p class='muted' style='text-align: center; padding: 24px;'>No returns requests found.</p>";
        return;
    }

    const searchVal = String(document.getElementById("returns-search-input")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("returns-status-filter")?.value || "all";

    const filtered = list.filter((item) => {
        const matchesSearch = !searchVal || 
            String(item.customer_name || "").toLowerCase().includes(searchVal) || 
            String(item.product_name || "").toLowerCase().includes(searchVal) || 
            String(item.order_id || "").toLowerCase().includes(searchVal);
            
        const matchesStatus = statusFilter === "all" || item.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        returnsList.innerHTML = "<p class='muted' style='text-align: center; padding: 24px;'>No returns requests match the search/filter criteria.</p>";
        return;
    }

    returnsList.innerHTML = filtered.map(item => {
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
        
        let actionButtonsHtml = '';
        if (item.status === "Pending") {
            actionButtonsHtml = `
                <div class="row-actions" style="margin-top: 10px; display: flex; gap: 8px;">
                    <button class="primary btn-icon btn-small btn-return-accept" data-id="${item.id}" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2) !important; border: none !important; color: white !important;">Accept</button>
                    <button class="ghost btn-icon btn-small btn-return-deny" data-id="${item.id}" style="color: #ef4444 !important; border: 1px solid #fee2e2 !important; background: #fffefe !important;">Deny</button>
                </div>
            `;
        } else {
            let badgeStyle = "font-weight: 700; padding: 4px 12px; border-radius: 99px; font-size: 0.8rem; display: inline-block;";
            if (item.status === "Accepted") {
                badgeStyle += " background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;";
            } else if (item.status === "Denied") {
                badgeStyle += " background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;";
            } else {
                badgeStyle += " background: #fef3c7; color: #d97706; border: 1px solid #fde68a;";
            }
            actionButtonsHtml = `
                <div style="margin-top: 10px;">
                    <span class="pill inline-status status-${item.status.toLowerCase()}" style="${badgeStyle}">${item.status}</span>
                </div>
            `;
        }

        return `
            <div class="supplier-row" style="flex-direction: column; align-items: flex-start; gap: 8px; padding: 18px 24px;">
                <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; border-bottom: 1.5px dashed #f1f5f9; padding-bottom: 8px; margin-bottom: 4px;">
                    <div>
                        <strong style="font-size: 1.02rem; color: #1e293b;">Request #${item.id}</strong>
                        <span class="muted small-text" style="margin-left: 8px;">Order Ref: #${item.order_id} • Requested on: ${dateStr}</span>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1.2fr; width: 100%; gap: 16px; margin: 4px 0;">
                    <div>
                        <span class="muted small-text" style="display:block; text-transform:uppercase; font-size:10px; font-weight:700; color:#94a3b8; letter-spacing:0.02em;">Product Details</span>
                        <strong style="color: #0f172a; font-size: 0.94rem;">${escapeHtml(item.product_name)}</strong>
                        <div class="muted small-text" style="margin-top: 2px;">Product ID: ${item.product_id}</div>
                    </div>
                    <div>
                        <span class="muted small-text" style="display:block; text-transform:uppercase; font-size:10px; font-weight:700; color:#94a3b8; letter-spacing:0.02em;">Customer Details</span>
                        <strong style="color: #0f172a; font-size: 0.94rem;">${escapeHtml(item.customer_name)}</strong>
                        <div class="muted small-text" style="margin-top: 2px;">Email: ${escapeHtml(item.customer_email)}</div>
                    </div>
                </div>
                
                <div class="return-reason-box" style="background-color: #fffbeb; border-left: 3.5px solid #f59e0b; padding: 10px 14px; border-radius: 6px; width: 100%; margin: 6px 0 2px;">
                    <span class="muted small-text" style="display:block; text-transform:uppercase; font-size:9px; font-weight:800; color:#b45309; letter-spacing:0.02em; margin-bottom:2px;">Reason for Return</span>
                    <p style="margin: 0; font-size: 0.88rem; color: #78350f; font-weight: 600; line-height: 1.45;">"${escapeHtml(item.reason)}"</p>
                </div>
                
                ${actionButtonsHtml}
            </div>
        `;
    }).join("");
}

async function loadTickets() {
    try {
        const data = await apiRequest("/api/supplier/tickets");
        supplierState.tickets = data.tickets || [];
        renderTickets();
        updateTicketsStats();
    } catch (err) {
        console.warn("Error loading support tickets:", err);
    }
}

function updateTicketsStats() {
    const totalEl = document.getElementById("tickets-strip-total");
    const openEl = document.getElementById("tickets-strip-open");
    if (!totalEl && !openEl) return;

    const list = supplierState.tickets || [];
    const total = list.length;
    const open = list.filter(t => t.status === "open").length;

    if (totalEl) totalEl.textContent = String(total);
    if (openEl) openEl.textContent = String(open);
}

function renderTickets() {
    const ticketsList = document.getElementById("supplier-tickets-list");
    if (!ticketsList) return;
    const list = supplierState.tickets || [];

    if (list.length === 0) {
        ticketsList.innerHTML = "<p class='muted' style='text-align: center; padding: 24px;'>No support tickets found.</p>";
        return;
    }

    const searchVal = String(document.getElementById("tickets-search-input")?.value || "").trim().toLowerCase();
    const statusFilter = document.getElementById("tickets-status-filter")?.value || "all";

    const filtered = list.filter((item) => {
        const matchesSearch = !searchVal || 
            String(item.name || "").toLowerCase().includes(searchVal) || 
            String(item.email || "").toLowerCase().includes(searchVal) || 
            String(item.subject || "").toLowerCase().includes(searchVal) || 
            String(item.message || "").toLowerCase().includes(searchVal) || 
            String(item.order_id || "").toLowerCase().includes(searchVal);
            
        const matchesStatus = statusFilter === "all" || item.status === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        ticketsList.innerHTML = "<p class='muted' style='text-align: center; padding: 24px;'>No support tickets match the search/filter criteria.</p>";
        return;
    }

    ticketsList.innerHTML = filtered.map(item => {
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        
        let actionButtonsHtml = '';
        if (item.status === "open") {
            actionButtonsHtml = `
                <div class="row-actions" style="margin-top: 10px; display: flex; gap: 8px;">
                    <button class="primary btn-icon btn-small btn-ticket-resolve" data-id="${item.id}" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important; box-shadow: 0 4px 10px rgba(16, 185, 129, 0.2) !important; border: none !important; color: white !important;">Mark Resolved</button>
                    <button class="ghost btn-icon btn-small btn-ticket-close" data-id="${item.id}" style="color: #ef4444 !important; border: 1px solid #fee2e2 !important; background: #fffefe !important;">Close Ticket</button>
                </div>
            `;
        } else {
            let badgeStyle = "font-weight: 700; padding: 4px 12px; border-radius: 99px; font-size: 0.8rem; display: inline-block;";
            if (item.status === "resolved") {
                badgeStyle += " background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;";
            } else if (item.status === "closed") {
                badgeStyle += " background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;";
            } else {
                badgeStyle += " background: #fef3c7; color: #d97706; border: 1px solid #fde68a;";
            }
            actionButtonsHtml = `
                <div style="margin-top: 10px; display: flex; align-items: center; gap: 12px;">
                    <span class="pill inline-status status-${item.status}" style="${badgeStyle}">${item.status.toUpperCase()}</span>
                    <button class="ghost btn-icon btn-small btn-ticket-reopen" data-id="${item.id}" style="color: #3b82f6 !important; border: 1px solid #dbeafe !important; background: #eff6ff !important; padding: 3px 10px; font-size: 0.76rem;">Reopen</button>
                </div>
            `;
        }

        const orderIdHtml = item.order_id ? `<span class="muted small-text" style="margin-left: 8px;">Order Ref: #${escapeHtml(item.order_id)}</span>` : '';

        return `
            <div class="supplier-row" style="flex-direction: column; align-items: flex-start; gap: 8px; padding: 18px 24px;">
                <div style="display: flex; justify-content: space-between; width: 100%; align-items: center; border-bottom: 1.5px dashed #f1f5f9; padding-bottom: 8px; margin-bottom: 4px;">
                    <div>
                        <strong style="font-size: 1.02rem; color: #1e293b;">Ticket #${item.id} • ${escapeHtml(item.subject || 'No Subject')}</strong>
                        ${orderIdHtml}
                        <span class="muted small-text" style="margin-left: 8px;">Submitted: ${dateStr}</span>
                    </div>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr; width: 100%; gap: 8px; margin: 4px 0;">
                    <div>
                        <span class="muted small-text" style="display:block; text-transform:uppercase; font-size:10px; font-weight:700; color:#94a3b8; letter-spacing:0.02em;">Customer Details</span>
                        <strong style="color: #0f172a; font-size: 0.94rem;">${escapeHtml(item.name)}</strong>
                        <span class="muted small-text" style="margin-left: 8px;">Email: ${escapeHtml(item.email)}</span>
                    </div>
                </div>
                
                <div class="return-reason-box" style="background-color: #f8fafc; border-left: 3.5px solid #64748b; padding: 10px 14px; border-radius: 6px; width: 100%; margin: 6px 0 2px;">
                    <span class="muted small-text" style="display:block; text-transform:uppercase; font-size:9px; font-weight:800; color:#475569; letter-spacing:0.02em; margin-bottom:4px;">Customer Message</span>
                    <p style="margin: 0; font-size: 0.88rem; color: #334155; line-height: 1.45; white-space: pre-wrap;">${escapeHtml(item.message)}</p>
                </div>
                
                ${actionButtonsHtml}
            </div>
        `;
    }).join("");
}

function renderPricing() {
    if (!pricingList) return;
    if (!supplierState.products.length) {
        pricingList.innerHTML = "<tr><td colspan='6' class='muted' style='text-align:center;'>No products yet. Add your first product.</td></tr>";
        return;
    }

    const sorted = getFilteredProducts();
    if (!sorted.length) {
        pricingList.innerHTML = "<tr><td colspan='6' class='muted' style='text-align:center;'>No products found for selected category/search.</td></tr>";
        const pageInfoEmpty = document.getElementById('product-page-info');
        if (pageInfoEmpty) pageInfoEmpty.textContent = 'Page 1 of 1';
        return;
    }

    const page = productPagination.page || 1;
    const size = productPagination.size || 12;
    const totalPages = Math.max(1, Math.ceil(sorted.length / size));
    if (productPagination.page > totalPages) {
        productPagination.page = totalPages;
    }
    const currentPage = productPagination.page || 1;
    const start = (currentPage - 1) * size;
    const pageItems = sorted.slice(start, start + size);

    pricingList.innerHTML = pageItems
        .map((product) => {
            const stockStatus = product.stock > 0 
                ? `<span class="stock-badge in-stock">${product.stock} in stock</span>`
                : `<span class="stock-badge out-of-stock">Out of stock</span>`;
            const pricing = getProductPricing(product);
            const priceCell = `
                <div class="price-input-wrapper" style="display:grid; gap:8px; min-width: 180px;">
                    <label class="muted small-text" style="display:grid; gap:4px; margin:0;">MRP
                        <input type="number" class="mrp-edit-input" data-id="${product.id}" value="${escapeAttr(pricing.mrp)}" min="1" step="0.01" />
                    </label>
                    <label class="muted small-text" style="display:grid; gap:4px; margin:0;">Selling Price
                        <input type="number" class="price-edit-input" data-id="${product.id}" value="${escapeAttr(pricing.sellingPrice)}" min="1" step="0.01" />
                    </label>
                    <div class="muted small-text">
                        <span style="text-decoration: line-through;">MRP ₹${escapeHtml(pricing.mrp.toFixed(2))}</span> · ₹${escapeHtml(pricing.sellingPrice.toFixed(2))}${pricing.hasDiscount ? ` · ${pricing.discountPercent}% off` : ''}
                    </div>
                </div>`;
                
            const selectedAttr = supplierState.selectedProductIds.has(product.id) ? 'checked' : '';
            
            return `
                <tr data-product-id="${product.id}">
                    <td><input aria-label="Select ${escapeAttr(product.name)}" type="checkbox" class="bulk-select" data-id="${product.id}" ${selectedAttr} /></td>
                    <td>
                        <div class="product-info-cell">
                            <strong>${escapeHtml(product.name)}</strong>
                            <div class="muted small-text">ID: ${product.id.slice(0, 8)}...</div>
                        </div>
                    </td>
                    <td><span class="category-tag">${escapeHtml(product.category || 'General')}</span></td>
                    <td>${stockStatus}</td>
                    <td>${priceCell}</td>
                    <td style="text-align: right;">
                        <button class="primary btn-icon btn-small btn-pricing-save" data-id="${product.id}">
                            <svg class="icon icon-save" aria-hidden="true" style="margin: 0;"><use href="#icon-save"></use></svg> Save
                        </button>
                    </td>
                </tr>
            `;
        })
        .join("");

    // update page info
    const pageInfo = document.getElementById('product-page-info');
    if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    const prev = document.getElementById('product-prev');
    const next = document.getElementById('product-next');
    if (next) next.disabled = currentPage >= totalPages;
    syncBulkSelectionUI();
}

function renderPayments() {
    const upcomingContainer = document.getElementById("upcoming-payments-container");
    if (!upcomingContainer) return;

    const upcomingEmpty = document.getElementById("upcoming-empty-view");
    const upcomingList = document.getElementById("upcoming-list-view");
    const completedEmpty = document.getElementById("completed-empty-view");
    const completedList = document.getElementById("completed-list-view");
    const upcomingSumPill = document.getElementById("upcoming-sum-pill");
    const completedSumPill = document.getElementById("completed-sum-pill");
    const unscheduledSumBanner = document.getElementById("unscheduled-banner-sum");
    const unscheduledList = document.getElementById("unscheduled-list-view");
    const chartPaid = document.getElementById("chart-sum-paid");
    const chartOutstanding = document.getElementById("chart-sum-outstanding");
    const chartContainer = document.getElementById("payments-trends-chart");

    const orders = supplierState.orders || [];
    
    let upcomingSum = 0;
    let completedSum = 0;
    let unscheduledSum = 0;

    const upcomingRows = [];
    const completedRows = [];
    const unscheduledRows = [];

    const now = new Date();
    const searchVal = String(document.getElementById("payments-search-input")?.value || "").trim().toLowerCase();

    orders.forEach((order) => {
        if (searchVal && !String(order.id).toLowerCase().includes(searchVal)) {
            return;
        }

        const totalAmt = Number(order.total || 0);
        const placedDate = order.placed_at ? new Date(order.placed_at) : new Date();
        const diffTime = Math.abs(now - placedDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (order.status === "Delivered") {
            if (diffDays <= 7) {
                upcomingSum += totalAmt;
                upcomingRows.push({
                    id: order.id,
                    amount: totalAmt,
                    date: placedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
                    payoutDate: new Date(placedDate.getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                });
            } else {
                completedSum += totalAmt;
                completedRows.push({
                    id: order.id,
                    amount: totalAmt,
                    date: placedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
                    clearedDate: new Date(placedDate.getTime() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                });
            }
        } else {
            unscheduledSum += totalAmt;
            unscheduledRows.push({
                id: order.id,
                amount: totalAmt,
                status: order.status,
                date: placedDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            });
        }
    });

    if (upcomingSumPill) upcomingSumPill.textContent = `₹${upcomingSum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (completedSumPill) completedSumPill.textContent = `₹${completedSum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (unscheduledSumBanner) unscheduledSumBanner.textContent = `₹${unscheduledSum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    if (upcomingRows.length > 0) {
        if (upcomingEmpty) upcomingEmpty.hidden = true;
        if (upcomingList) {
            upcomingList.hidden = false;
            upcomingList.innerHTML = upcomingRows.map(row => `
                <div class="payment-row">
                    <div class="payment-details">
                        <strong>Order #${row.id.slice(0, 12)}</strong>
                        <div class="muted small-text">Delivered on: ${row.date}</div>
                        <div class="payout-badge upcoming">Estimated Payout: ${row.payoutDate}</div>
                    </div>
                    <div class="payment-amount upcoming">₹${row.amount.toFixed(2)}</div>
                </div>
            `).join("");
        }
    } else {
        if (upcomingEmpty) upcomingEmpty.hidden = false;
        if (upcomingList) upcomingList.hidden = true;
    }

    if (completedRows.length > 0) {
        if (completedEmpty) completedEmpty.hidden = true;
        if (completedList) {
            completedList.hidden = false;
            completedList.innerHTML = completedRows.map(row => `
                <div class="payment-row">
                    <div class="payment-details">
                        <strong>Order #${row.id.slice(0, 12)}</strong>
                        <div class="muted small-text">Cleared on: ${row.clearedDate}</div>
                        <div class="payout-badge cleared">Status: Cleared</div>
                    </div>
                    <div class="payment-amount cleared">+ ₹${row.amount.toFixed(2)}</div>
                </div>
            `).join("");
        }
    } else {
        if (completedEmpty) completedEmpty.hidden = false;
        if (completedList) completedList.hidden = true;
    }

    if (unscheduledList) {
        if (unscheduledRows.length > 0) {
            unscheduledList.innerHTML = unscheduledRows.map(row => `
                <div class="payment-row">
                    <div class="payment-details">
                        <strong>Order #${row.id.slice(0, 12)}</strong>
                        <div class="muted small-text">Placed on: ${row.date}</div>
                        <span class="pill inline-status status-${row.status.toLowerCase()}">${row.status}</span>
                    </div>
                    <div class="payment-amount pending">₹${row.amount.toFixed(2)}</div>
                </div>
            `).join("");
        } else {
            unscheduledList.innerHTML = "<p class='muted' style='padding: 20px; text-align: center;'>No pending shipped orders.</p>";
        }
    }

    if (chartPaid) chartPaid.textContent = `₹${completedSum.toLocaleString('en-IN')}`;
    if (chartOutstanding) chartOutstanding.textContent = `₹${(upcomingSum + unscheduledSum).toLocaleString('en-IN')}`;

    if (chartContainer) {
        const monthlyData = {};
        orders.forEach(order => {
            const date = order.placed_at ? new Date(order.placed_at) : new Date();
            const monthName = date.toLocaleDateString('en-IN', { month: 'short' });
            if (!monthlyData[monthName]) monthlyData[monthName] = { paid: 0, outstanding: 0 };
            
            const totalAmt = Number(order.total || 0);
            if (order.status === "Delivered" && Math.abs(now - date) / (1000 * 60 * 60 * 24) > 7) {
                monthlyData[monthName].paid += totalAmt;
            } else {
                monthlyData[monthName].outstanding += totalAmt;
            }
        });

        const months = Object.keys(monthlyData).slice(-6);
        if (months.length === 0) {
            chartContainer.innerHTML = "<p class='muted' style='grid-column: 1/-1; text-align: center; padding: 30px 0;'>No payments over time to represent yet.</p>";
            return;
        }

        const maxMonthVal = Math.max(...months.map(m => monthlyData[m].paid + monthlyData[m].outstanding), 1);

        chartContainer.innerHTML = months.map(month => {
            const paid = monthlyData[month].paid;
            const outstanding = monthlyData[month].outstanding;
            const paidHeight = Math.max(0, Math.round((paid / maxMonthVal) * 120));
            const outstandingHeight = Math.max(0, Math.round((outstanding / maxMonthVal) * 120));

            return `
                <div class="chart-column">
                    <div class="bar-tracks-wrapper">
                        <div class="bar-column-group">
                            <div class="bar-track">
                                <div class="bar-fill paid" style="height: ${paidHeight}px;" title="Paid: ₹${paid.toFixed(2)}"></div>
                            </div>
                            <div class="bar-track">
                                <div class="bar-fill outstanding" style="height: ${outstandingHeight}px;" title="Outstanding: ₹${outstanding.toFixed(2)}"></div>
                            </div>
                        </div>
                    </div>
                    <div class="chart-column-label">${month}</div>
                </div>
            `;
        }).join("");
    }
}

function updateProductInState(id, patch) {
    const idx = supplierState.products.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const previous = { ...supplierState.products[idx] };
    supplierState.products[idx] = { ...supplierState.products[idx], ...patch };
    return previous;
}

function renderInlineEditor(product) {
    const pricing = getProductPricing(product);
    return `
        <div class="inline-editor" data-inline-editor="${product.id}">
            <div class="inline-grid">
                <label>Category<input type="text" data-field="category" value="${escapeAttr(product.category || '')}" /></label>
                <label>MRP<input type="number" min="1" step="0.01" data-field="mrp" value="${escapeAttr(pricing.mrp || 0)}" /></label>
                <label>Selling Price<input type="number" min="1" step="0.01" data-field="price" value="${escapeAttr(pricing.sellingPrice || 0)}" /></label>
                <label>Stock<input type="number" min="0" step="1" data-field="stock" value="${escapeAttr(product.stock || 0)}" /></label>
                <label>Image URL<input type="url" data-field="image" value="${escapeAttr(product.image || '')}" /></label>
                <label class="inline-check"><input type="checkbox" data-field="featured" ${product.featured ? 'checked' : ''} /> Featured</label>
            </div>
            <div class="muted small-text" style="margin-bottom: 10px;">${escapeHtml(formatDiscountLabel(product))}</div>
            <label>Description<textarea rows="2" data-field="description">${escapeHtml(product.description || '')}</textarea></label>
            <div class="row-actions inline-actions">
                <button class="primary" data-action="inline-save" data-id="${product.id}">Save</button>
                <button class="ghost" data-action="inline-cancel" data-id="${product.id}">Cancel</button>
            </div>
        </div>
    `;
}

// Update header stats and counts
function updateStats() {
    try {
        const pCount = supplierState.products.length || 0;
        const oCount = supplierState.orders.length || 0;
        const pendingCount = supplierState.orders.filter((o) => o.status !== 'Delivered').length;
        const pEl = document.getElementById('supplier-count-products');
        const oEl = document.getElementById('supplier-count-orders');
        const pStrip = document.getElementById('products-strip-count');
        const oStrip = document.getElementById('orders-strip-total');
        const pendingStrip = document.getElementById('orders-strip-pending');
        if (pEl) pEl.textContent = String(pCount);
        if (oEl) oEl.textContent = String(oCount);
        if (pStrip) pStrip.textContent = String(pCount);
        if (oStrip) oStrip.textContent = String(oCount);
        if (pendingStrip) pendingStrip.textContent = String(pendingCount);
    } catch (e) { /* ignore */ }
}

// Simple search/filter for product list (by name or category)
function applyProductFilter(query) {
    productSearchQuery = String(query || '').trim().toLowerCase();
    productPagination.page = 1;
    renderProducts();
}

function updatePaginationControls() {
    const prev = document.getElementById('product-prev');
    const next = document.getElementById('product-next');
    const sizeSelect = document.getElementById('product-page-size');
    if (prev) prev.onclick = () => { if (productPagination.page>1) { productPagination.page--; renderProducts(); } };
    if (next) next.onclick = () => {
        const totalPages = Math.max(1, Math.ceil(getFilteredProducts().length / (productPagination.size || 12)));
        if (productPagination.page < totalPages) {
            productPagination.page++;
            renderProducts();
        }
    };
    if (sizeSelect) sizeSelect.onchange = (e) => { productPagination.size = Number(e.target.value); productPagination.page = 1; renderProducts(); };
}

function getSelectedProductIds() {
    return Array.from(supplierState.selectedProductIds);
}

function syncBulkSelectionUI() {
    const countEl = document.getElementById('bulk-selected-count');
    const selectAll = document.getElementById('bulk-select-all');
    const applyBtn = document.getElementById('bulk-action-apply');
    const visibleCheckboxes = Array.from(document.querySelectorAll('.bulk-select'));
    const selectedCount = supplierState.selectedProductIds.size;
    if (countEl) countEl.textContent = `${selectedCount} selected`;
    if (applyBtn) applyBtn.disabled = selectedCount === 0;

    if (selectAll && visibleCheckboxes.length) {
        const allChecked = visibleCheckboxes.every((cb) => cb.checked);
        selectAll.checked = allChecked;
        selectAll.indeterminate = !allChecked && visibleCheckboxes.some((cb) => cb.checked);
    }
}

function exportProductsCsv() {
    const rows = supplierState.products || [];
    if (!rows.length) {
        alert('No products to export.');
        return;
    }

    const headers = ['name', 'category', 'price', 'stock', 'image', 'description', 'featured'];
    const escapeCell = (value) => {
        const text = String(value ?? '');
        if (/[",\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };

    const csv = [
        headers.join(','),
        ...rows.map((row) => headers.map((key) => escapeCell(row[key])).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `supplier-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function filterOrdersByDate(orders, startDate, endDate) {
    if (!startDate && !endDate) return orders;
    return orders.filter((o) => {
        const t = o.placed_at ? new Date(o.placed_at) : null;
        if (!t) return true;
        if (startDate && t < new Date(startDate)) return false;
        if (endDate && t > new Date(endDate + 'T23:59:59')) return false;
        return true;
    });
}

function exportOrdersCsv(orders, filename, columns = supplierState.orderExportColumns) {
    if (!orders.length) {
        alert('No orders to export.');
        return;
    }

    const headers = columns.length ? columns : ['id', 'status', 'total', 'total_quantity', 'customer_name', 'customer_phone', 'placed_at', 'items'];
    const escapeCell = (value) => {
        const text = String(value ?? '');
        if (/[",\n]/.test(text)) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };

    const rows = orders.map((order) => {
        const items = Array.isArray(order.items)
            ? order.items.map((item) => `${item.name} x${item.quantity}`).join(' | ')
            : '';
        const rowMap = {
            id: order.id,
            status: order.status,
            total: order.total,
            total_quantity: order.total_quantity,
            customer_name: order.customer_name,
            customer_phone: order.customer_phone,
            placed_at: order.placed_at,
            items
        };
        return headers.map((key) => rowMap[key]);
    });

    const csv = [
        headers.join(','),
        ...rows.map((row) => row.map((cell) => escapeCell(cell)).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function exportAnalyticsCsv() {
    const data = supplierState.analytics;
    if (!data) {
        alert('No analytics data to export.');
        return;
    }

    const summary = data.summary || {};
    const series = Array.isArray(data.series) ? data.series : [];
    const header = ['bucket', 'revenue', 'orders'];
    const rows = series.map((row) => [row.label, row.revenue, row.orders]);

    const summaryLines = [
        ['total_orders', summary.totalOrders ?? 0],
        ['total_revenue', summary.totalRevenue ?? 0],
        ['avg_order_value', summary.avgOrderValue ?? 0],
        ['pending_orders', summary.pendingOrders ?? 0]
    ];

    const csv = [
        'summary',
        'metric,value',
        ...summaryLines.map((row) => row.join(',')),
        '',
        'series',
        header.join(','),
        ...rows.map((row) => row.join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `supplier-analytics-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function loadAnalyticsSchedule() {
    try {
        const data = await apiRequest('/api/supplier/analytics/schedule');
        supplierState.analyticsSchedule = data.schedule || null;
        const frequency = document.getElementById('analytics-schedule-frequency');
        const email = document.getElementById('analytics-schedule-email');
        if (frequency && supplierState.analyticsSchedule?.frequency) {
            frequency.value = supplierState.analyticsSchedule.frequency;
        }
        if (email && supplierState.analyticsSchedule?.email) {
            email.value = supplierState.analyticsSchedule.email;
        }
    } catch (err) {
        console.warn('Analytics schedule load failed', err);
    }
}

function openOrdersExportModal() {
    const modal = document.getElementById('orders-export-modal');
    const picker = document.getElementById('orders-column-picker');
    if (!modal || !picker) return;
    const columns = [
        { key: 'id', label: 'Order ID' },
        { key: 'status', label: 'Status' },
        { key: 'total', label: 'Total' },
        { key: 'total_quantity', label: 'Quantity' },
        { key: 'customer_name', label: 'Customer Name' },
        { key: 'customer_phone', label: 'Customer Phone' },
        { key: 'placed_at', label: 'Placed At' },
        { key: 'items', label: 'Items' }
    ];
    picker.innerHTML = columns.map((col) => {
        const checked = supplierState.orderExportColumns.includes(col.key) ? 'checked' : '';
        return `<label><input type="checkbox" data-col="${col.key}" ${checked} /> ${col.label}</label>`;
    }).join('');
    modal.hidden = false;
    picker.querySelector('input')?.focus();
}

function closeOrdersExportModal() {
    const modal = document.getElementById('orders-export-modal');
    if (modal) modal.hidden = true;
}

async function applyBulkAction() {
    const action = document.getElementById('bulk-action-select').value;
    const value = document.getElementById('bulk-action-value').value;
    const selected = getSelectedProductIds();
    if (!action || !selected.length) { alert('Select products and an action'); return; }

    if (['set-price', 'add-stock', 'set-stock'].includes(action)) {
        const numeric = Number(value);
        if (Number.isNaN(numeric)) { alert('Enter a numeric value.'); return; }
    }
    if (action === 'set-featured' && !String(value || '').trim()) {
        alert('Enter 1 (featured) or 0 (not featured).');
        return;
    }

    const ok = window.confirm(`Apply ${action} to ${selected.length} products?`);
    if (!ok) return;

    try {
        const data = await apiRequest('/api/supplier/products/bulk-update', {
            method: 'POST',
            body: JSON.stringify({ ids: selected, action, value })
        });

        const updated = Number(data.updated || 0);
        const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
        alert(`Bulk update complete. Updated: ${updated}, Skipped: ${skipped}`);
    } catch (err) {
        alert(`Bulk update failed: ${err.message}`);
    }
    await loadProducts();
    supplierState.selectedProductIds.clear();
    syncBulkSelectionUI();
}

function computeAnalytics(startDate, endDate) {
    const orders = supplierState.orders || [];
    let filtered = orders;
    if (startDate || endDate) {
        filtered = orders.filter(o => {
            const t = o.placed_at ? new Date(o.placed_at) : new Date();
            if (startDate && t < new Date(startDate)) return false;
            if (endDate && t > new Date(endDate + 'T23:59:59')) return false;
            return true;
        });
    }
    const revenue = filtered.reduce((s,o)=> s + Number(o.total || 0), 0);
    const pending = filtered.filter(o => o.status !== 'Delivered').length;
    const aov = filtered.length ? Math.round((revenue/filtered.length) * 100)/100 : 0;
    const revEl = document.getElementById('supplier-revenue'); if (revEl) revEl.textContent = `₹${revenue}`;
    const pendEl = document.getElementById('supplier-pending'); if (pendEl) pendEl.textContent = String(pending);
    const aovEl = document.getElementById('supplier-aov'); if (aovEl) aovEl.textContent = `₹${aov}`;
}

function renderAnalyticsChart(series, metric = 'revenue') {
    const chart = document.getElementById('supplier-analytics-chart');
    if (!chart) return;

    if (!Array.isArray(series) || !series.length) {
        chart.innerHTML = `<p class="muted">No ${metric === 'orders' ? 'orders' : 'sales'} data for the selected period.</p>`;
        return;
    }

    const values = series.map((item) => Number(item[metric] || 0));
    const maxVal = Math.max(...values, 1);
    chart.innerHTML = series
        .map((item, idx) => {
            const val = Number(item[metric] || 0);
            const height = Math.max(4, Math.round((val / maxVal) * 140));
            const display = metric === 'orders' ? String(val) : `₹${val}`;
            return `
                <div class="analytics-bar">
                    <div class="analytics-bar-track">
                        <div class="analytics-bar-fill" style="height:${height}px"></div>
                    </div>
                    <div class="analytics-bar-value">${escapeHtml(display)}</div>
                    <div class="analytics-bar-label">${escapeHtml(item.label || '')}</div>
                </div>
            `;
        })
        .join('');
}

function renderAnalyticsSummary(summary) {
    const el = document.getElementById('analytics-summary');
    if (!el || !summary) return;
    const total = Number(summary.totalRevenue || 0);
    const orders = Number(summary.totalOrders || 0);
    const aov = Number(summary.avgOrderValue || 0).toFixed(2);
    const pending = Number(summary.pendingOrders || 0);
    el.innerHTML = [
        `<div class="summary-chip"><span>Total Revenue</span><strong>₹${total}</strong></div>`,
        `<div class="summary-chip"><span>Orders</span><strong>${orders}</strong></div>`,
        `<div class="summary-chip"><span>Avg Order</span><strong>₹${aov}</strong></div>`,
        `<div class="summary-chip"><span>Pending</span><strong>${pending}</strong></div>`
    ].join('');
}

async function loadAnalytics(startDate, endDate) {
    try {
        const params = new URLSearchParams();
        if (startDate) params.set('start', startDate);
        if (endDate) params.set('end', endDate);
        const group = document.getElementById('analytics-group')?.value;
        if (group) params.set('group', group);
        const data = await apiRequest(`/api/supplier/analytics${params.toString() ? `?${params.toString()}` : ''}`);

        if (data.summary) {
            const revEl = document.getElementById('supplier-revenue');
            const pendEl = document.getElementById('supplier-pending');
            const aovEl = document.getElementById('supplier-aov');
            const oEl = document.getElementById('supplier-count-orders');

            if (revEl) revEl.textContent = `₹${Number(data.summary.totalRevenue || 0)}`;
            if (pendEl) pendEl.textContent = String(Number(data.summary.pendingOrders || 0));
            if (aovEl) aovEl.textContent = `₹${Number(data.summary.avgOrderValue || 0).toFixed(2)}`;
            if (oEl) oEl.textContent = String(Number(data.summary.totalOrders || 0));
        }

        supplierState.analytics = { summary: data.summary || null, series: data.series || [] };
        const metric = document.querySelector('.metric-toggle .metric.active')?.dataset.metric || 'revenue';
        renderAnalyticsChart(data.series || [], metric === 'orders' ? 'orders' : 'revenue');
        renderAnalyticsSummary(data.summary || null);
    } catch (err) {
        const chart = document.getElementById('supplier-analytics-chart');
        if (chart) chart.innerHTML = `<p class="muted">Unable to load analytics: ${escapeHtml(err.message)}</p>`;
    }
}

function renderOrders() {
    if (!ordersList && !ordersQueueList) return;
    const filteredOrders = getFilteredOrders();

    const renderOrderRow = (order, options = {}) => {
        const { showQueueChip = false } = options;
        const items = order.items
            .map((item) => `${item.name} x${item.quantity}`)
            .join(", ");

        const queueChip = showQueueChip
            ? (order.status === 'Placed'
                ? '<span class="queue-chip queue-chip--placed">Placed</span>'
                : order.status === 'Packed'
                    ? '<span class="queue-chip queue-chip--packed">Packed</span>'
                    : '')
            : '';

        return `
            <div class="supplier-row">
                <div>
                    <strong>${order.id}</strong>
                    <div class="muted">${items}</div>
                    <div class="order-meta">${queueChip}</div>
                    <div class="muted">&#8377;${order.total} | Qty ${order.total_quantity}</div>
                    <div class="muted">${order.customer_name || ""} ${order.customer_phone || ""}</div>
                </div>
                <div class="row-actions">
                    <select data-action="status" data-id="${order.id}" aria-label="Update status for order ${escapeAttr(order.id)}">
                        <option value="Placed" ${order.status === "Placed" ? "selected" : ""}>Placed</option>
                        <option value="Packed" ${order.status === "Packed" ? "selected" : ""}>Packed</option>
                        <option value="Delivered" ${order.status === "Delivered" ? "selected" : ""}>Delivered</option>
                    </select>
                </div>
            </div>
        `;
    };

    if (!supplierState.orders.length) {
        if (ordersList) ordersList.innerHTML = "<p class=\"muted\">No orders yet.</p>";
        if (ordersQueueList) ordersQueueList.innerHTML = "<p class=\"muted\">No queued orders.</p>";
        return;
    }

    if (!filteredOrders.length) {
        if (ordersList) ordersList.innerHTML = "<p class=\"muted\">No orders found for selected category.</p>";
        if (ordersQueueList) ordersQueueList.innerHTML = "<p class=\"muted\">No queued orders for selected category.</p>";
        return;
    }

    if (ordersList) {
        ordersList.innerHTML = filteredOrders.map((order) => renderOrderRow(order)).join("");
    }

    if (ordersQueueList) {
        const queued = filteredOrders.filter((order) => order.status !== 'Delivered');
        if (!queued.length) {
            ordersQueueList.innerHTML = "<p class=\"muted\">No queued orders.</p>";
            return;
        }

        const placedOrders = queued.filter((order) => order.status === 'Placed');
        const packedOrders = queued.filter((order) => order.status === 'Packed');
        const otherOrders = queued.filter((order) => order.status !== 'Placed' && order.status !== 'Packed');

        const renderGroup = (label, cssClass, ordersInGroup) => {
            if (!ordersInGroup.length) return '';
            return `
                <section class="queue-group ${cssClass}">
                    <h4 class="queue-group-title">${label} (${ordersInGroup.length})</h4>
                    <div class="queue-group-list">
                        ${ordersInGroup.map((order) => renderOrderRow(order, { showQueueChip: true })).join('')}
                    </div>
                </section>
            `;
        };

        ordersQueueList.innerHTML = [
            renderGroup('Placed', 'queue-group--placed', placedOrders),
            renderGroup('Packed', 'queue-group--packed', packedOrders),
            renderGroup('Other', 'queue-group--other', otherOrders)
        ].join('');
    }
}

async function loadProducts() {
    const data = await apiRequest("/api/supplier/products");
    supplierState.products = data.products || [];
    populateProductCategoryFilter();
    renderProducts();
    renderPricing();
    updateStats();
}

async function loadOrders() {
    const data = await apiRequest("/api/supplier/orders");
    supplierState.orders = data.orders || [];
    populateOrdersCategoryFilter();
    renderOrders();
    renderPayments();
    updateStats();
    computeAnalytics();
}

async function loadDashboard() {
    showDashboard();
    await Promise.all([loadProducts(), loadOrders(), loadReturns(), loadTickets()]);
    const start = document.getElementById('orders-start')?.value;
    const end = document.getElementById('orders-end')?.value;
    await loadAnalytics(start, end);
    await loadAnalyticsSchedule();
}

async function tryIssueSupplierTokenFromUserToken() {
    const userToken = getUserToken();
    if (!userToken || !isJwtLikeToken(userToken)) {
        return false;
    }

    try {
        const res = await fetch('/api/supplier/issue-token', {
            method: 'POST',
            headers: { Authorization: `Bearer ${userToken}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) {
            return false;
        }

        supplierState.token = data.token;
        localStorage.setItem('supplierToken', data.token);
        return true;
    } catch (_err) {
        return false;
    }
}

async function handleLogin(evt) {
    evt.preventDefault();
    setStatusMessage(loginMessage, "");

    const email = document.getElementById("supplier-email").value.trim();
    const password = document.getElementById("supplier-password").value.trim();

    try {
        const data = await apiRequest("/api/supplier/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });
        supplierState.token = data.token;
        localStorage.setItem("supplierToken", data.token);
        await loadDashboard();
    } catch (err) {
        setStatusMessage(loginMessage, err.message, true);
    }
}

async function handleLogout() {
    supplierState.token = "";
    localStorage.removeItem("supplierToken");
    showLogin();
}

async function handleProductSubmit(evt) {
    evt.preventDefault();
    setStatusMessage(productFormMessage, "");

    const name = document.getElementById("product-name").value.trim();
    const category = document.getElementById("product-category").value.trim();
    const mrp = Number(document.getElementById("product-mrp").value);
    const price = Number(document.getElementById("product-price").value);
    const stock = Number(document.getElementById("product-stock").value || 0);
    const description = document.getElementById("product-description").value.trim();
    const featured = document.getElementById("product-featured").checked;

    if (productImagesList.length === 0) {
        setStatusMessage(productFormMessage, "At least one product image is required.", true);
        return;
    }

    const productId = document.getElementById("product-id").value;
    const isEdit = Boolean(productId);
    const pricing = getProductPricing({ mrp, price });

    if (!pricing.mrp || !pricing.sellingPrice) {
        setStatusMessage(productFormMessage, "MRP and selling price are required.", true);
        return;
    }

    try {
        setStatusMessage(productFormMessage, "Uploading selected images...");

        // Separate base64 files and existing URL strings
        const newImages = productImagesList.filter(img => img.startsWith("data:image/"));
        const existingImages = productImagesList.filter(img => !img.startsWith("data:image/"));

        let uploadedUrls = [];
        if (newImages.length > 0) {
            const uploadRes = await apiRequest("/api/supplier/upload", {
                method: "POST",
                body: JSON.stringify({ images: newImages })
            });
            if (uploadRes.success && Array.isArray(uploadRes.urls)) {
                uploadedUrls = uploadRes.urls;
            } else {
                throw new Error(uploadRes.message || "Failed to upload some images.");
            }
        }

        const finalImages = [...existingImages, ...uploadedUrls].join(",");

        const payload = {
            name,
            category,
            price: pricing.sellingPrice,
            mrp: pricing.mrp,
            discount_percent: pricing.discountPercent,
            stock,
            image: finalImages,
            description,
            featured
        };

        setStatusMessage(productFormMessage, "Saving product details...");

        if (isEdit) {
            await apiRequest(`/api/supplier/products/${productId}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            setStatusMessage(productFormMessage, "Product updated.");
        } else {
            await apiRequest("/api/supplier/products", {
                method: "POST",
                body: JSON.stringify(payload)
            });
            setStatusMessage(productFormMessage, "Product added.");
        }

        resetProductForm();
        await loadProducts();
        showToast('Product saved');
        if (typeof setProductsView === 'function') setProductsView('list');
    } catch (err) {
        setStatusMessage(productFormMessage, err.message, true);
    }
}

// small toast helper for inline feedback
function showToast(message, ms = 1800) {
    let el = document.getElementById('toast-save');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast-save';
        el.className = 'toast-save';
        document.body.appendChild(el);
    }
    el.textContent = '';
    const text = document.createElement('div');
    text.textContent = message;
    el.appendChild(text);
    el.classList.add('show');

    const timer = setTimeout(() => el.classList.remove('show'), ms);
    el.dataset.timer = String(timer);
}

function showUndoToast(message, onUndo, ms = 4000) {
    let el = document.getElementById('toast-save');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast-save';
        el.className = 'toast-save';
        document.body.appendChild(el);
    }

    const prevTimer = Number(el.dataset.timer || 0);
    if (prevTimer) clearTimeout(prevTimer);

    el.textContent = '';
    const text = document.createElement('div');
    text.textContent = message;
    el.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'toast-actions';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Undo';
    btn.addEventListener('click', async () => {
        try {
            await onUndo();
            showToast('Undo applied');
        } catch (err) {
            setInlineError(`Undo failed: ${err.message || err}`);
        }
    });
    actions.appendChild(btn);
    el.appendChild(actions);
    el.classList.add('show');

    const timer = setTimeout(() => el.classList.remove('show'), ms);
    el.dataset.timer = String(timer);
}

async function handleProductAction(evt) {
    const button = evt.target.closest("button");
    if (!button) return;

    const action = button.dataset.action;
    const id = button.dataset.id;
    if (!action || !id) return;

    const product = supplierState.products.find((item) => item.id === id);
    if (!product) return;

    if (action === 'inline-edit') {
        setInlineError('');
        inlineEditId = id;
        renderProducts();
        return;
    }

    if (action === 'inline-cancel') {
        setInlineError('');
        inlineEditId = '';
        renderProducts();
        return;
    }

    if (action === 'inline-save') {
        const editor = productList.querySelector(`[data-inline-editor="${CSS.escape(id)}"]`);
        if (!editor) return;

        const pricing = getProductPricing({
            mrp: editor.querySelector('[data-field="mrp"]')?.value,
            price: editor.querySelector('[data-field="price"]')?.value
        });

        const payload = {
            name: product.name,
            category: editor.querySelector('[data-field="category"]')?.value.trim() || product.category || 'General',
            price: pricing.sellingPrice,
            mrp: pricing.mrp,
            discount_percent: pricing.discountPercent,
            stock: Number(editor.querySelector('[data-field="stock"]')?.value || 0),
            image: editor.querySelector('[data-field="image"]')?.value.trim() || product.image || '',
            description: editor.querySelector('[data-field="description"]')?.value.trim() || '',
            featured: Boolean(editor.querySelector('[data-field="featured"]')?.checked)
        };

        setInlineError('');
        const previous = updateProductInState(id, payload);
        inlineEditId = '';
        renderProducts();

        try {
            await apiRequest(`/api/supplier/products/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            // visual confirmation
            const rowEl = document.querySelector(`.supplier-row[data-product-id="${CSS.escape(id)}"]`);
            if (rowEl) {
                rowEl.classList.add('save-pulse');
                setTimeout(() => rowEl.classList.remove('save-pulse'), 900);
            }
            showUndoToast('Saved', async () => {
                if (!previous) return;
                updateProductInState(id, previous);
                renderProducts();
                await apiRequest(`/api/supplier/products/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        name: previous.name,
                        category: previous.category,
                        price: previous.price,
                        mrp: previous.mrp,
                        discount_percent: previous.discount_percent,
                        stock: previous.stock,
                        image: previous.image,
                        description: previous.description,
                        featured: previous.featured
                    })
                });
            });
        } catch (err) {
            if (previous) updateProductInState(id, previous);
            renderProducts();
            setInlineError(`Save failed: ${err.message || err}`);
        }
        return;
    }

    if (action === "edit") {
        if (typeof setProductsView === 'function') setProductsView('form');
        document.getElementById("product-id").value = product.id;
        document.getElementById("product-name").value = product.name || "";
        document.getElementById("product-category").value = product.category || "";
        const pricing = getProductPricing(product);
        document.getElementById("product-mrp").value = pricing.mrp || 0;
        document.getElementById("product-price").value = pricing.sellingPrice || 0;
        document.getElementById("product-stock").value = product.stock || 0;
        productImagesList = product.image ? product.image.split(",").filter(Boolean) : [];
        renderImagesPreview();
        document.getElementById("product-description").value = product.description || "";
        document.getElementById("product-featured").checked = Boolean(product.featured);
        setStatusMessage(productFormMessage, "Editing product. Update fields and save.");
        updateProductDiscountPreview();
        return;
    }

    if (action === "delete") {
        const ok = window.confirm("Delete this product? This cannot be undone.");
        if (!ok) return;
        try {
            await apiRequest(`/api/supplier/products/${id}`, { method: "DELETE" });
            await loadProducts();
        } catch (err) {
            setStatusMessage(productFormMessage, err.message, true);
        }
    }
}

async function handleOrderStatusChange(evt) {
    const select = evt.target.closest("select");
    if (!select) return;

    const orderId = select.dataset.id;
    const status = select.value;

    try {
        await apiRequest(`/api/supplier/orders/${orderId}/status`, {
            method: "PUT",
            body: JSON.stringify({ status })
        });
        setStatusMessage(loginMessage, "Order status updated.", false);
        await loadOrders();
    } catch (err) {
        window.alert(err.message);
    }
}

async function initSupplier() {
    if (!supplierSection) return;
    // Show loading placeholder immediately
    showLoading();

    loginForm?.addEventListener("submit", handleLogin);
    logoutBtn?.addEventListener("click", handleLogout);
    backBtn?.addEventListener("click", () => { window.location.href = '/'; });
    productForm?.addEventListener("submit", handleProductSubmit);
    resetBtn?.addEventListener("click", resetProductForm);
    document.getElementById('product-mrp')?.addEventListener('input', updateProductDiscountPreview);
    document.getElementById('product-price')?.addEventListener('input', updateProductDiscountPreview);

    const productImagesInput = document.getElementById("product-images");
    if (productImagesInput) {
        productImagesInput.addEventListener("change", async (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;
            
            try {
                const base64Promises = Array.from(files).map(file => toBase64(file));
                const base64s = await Promise.all(base64Promises);
                productImagesList = [...productImagesList, ...base64s];
                renderImagesPreview();
            } catch (err) {
                console.error("Error reading selected files:", err);
                alert("Failed to read some images.");
            }
            // Clear input selection so same files can be re-selected if deleted
            productImagesInput.value = "";
        });
    }
    productList?.addEventListener("click", handleProductAction);
    productList?.addEventListener('change', (e) => {
        const checkbox = e.target.closest('.bulk-select');
        if (!checkbox) return;
        const id = checkbox.dataset.id;
        if (!id) return;
        if (checkbox.checked) supplierState.selectedProductIds.add(id);
        else supplierState.selectedProductIds.delete(id);
        syncBulkSelectionUI();
    });
    pricingList?.addEventListener('change', (e) => {
        const checkbox = e.target.closest('.bulk-select');
        if (!checkbox) return;
        const id = checkbox.dataset.id;
        if (!id) return;
        if (checkbox.checked) supplierState.selectedProductIds.add(id);
        else supplierState.selectedProductIds.delete(id);
        syncBulkSelectionUI();
    });
    pricingList?.addEventListener("click", async (e) => {
        const button = e.target.closest(".btn-pricing-save");
        if (!button) return;
        const id = button.dataset.id;
        if (!id) return;
        const row = pricingList.querySelector(`tr[data-product-id="${CSS.escape(id)}"]`);
        if (!row) return;
        const mrpInput = row.querySelector(".mrp-edit-input");
        const priceInput = row.querySelector(".price-edit-input");
        if (!mrpInput || !priceInput) return;
        const pricing = getProductPricing({ mrp: mrpInput.value, price: priceInput.value });
        if (!pricing.mrp || !pricing.sellingPrice) {
            alert("Please enter valid MRP and selling price greater than 0");
            return;
        }

        const product = supplierState.products.find((p) => p.id === id);
        if (!product) return;

        const payload = {
            name: product.name,
            category: product.category || 'General',
            price: pricing.sellingPrice,
            mrp: pricing.mrp,
            discount_percent: pricing.discountPercent,
            stock: Number(product.stock || 0),
            image: product.image || '',
            description: product.description || '',
            featured: Boolean(product.featured)
        };

        try {
            button.disabled = true;
            button.innerHTML = "Saving...";
            await apiRequest(`/api/supplier/products/${id}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            product.price = pricing.sellingPrice;
            product.mrp = pricing.mrp;
            product.discount_percent = pricing.discountPercent;
            showToast("Price updated successfully");
            renderPricing();
        } catch (err) {
            alert("Failed to update price: " + err.message);
        } finally {
            button.disabled = false;
            button.innerHTML = `<svg class="icon icon-save" aria-hidden="true" style="margin: 0;"><use href="#icon-save"></use></svg> Save`;
        }
    });
    // Keyboard accessibility for inline editor: Enter to save, Escape to cancel
    productList?.addEventListener('keydown', (e) => {
        const editor = e.target.closest && e.target.closest('.inline-editor');
        if (!editor) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            const saveBtn = editor.querySelector('[data-action="inline-save"]');
            if (saveBtn) saveBtn.click();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            const cancelBtn = editor.querySelector('[data-action="inline-cancel"]');
            if (cancelBtn) cancelBtn.click();
        }
    });
    ordersList?.addEventListener("change", handleOrderStatusChange);
    ordersQueueList?.addEventListener("change", handleOrderStatusChange);
    document.getElementById('supplier-export-csv')?.addEventListener('click', exportProductsCsv);
    document.getElementById('orders-export-csv')?.addEventListener('click', () => {
        const s = document.getElementById('orders-start')?.value;
        const e = document.getElementById('orders-end')?.value;
        const filtered = filterOrdersByDate(supplierState.orders || [], s, e);
        exportOrdersCsv(filtered, `supplier-orders-${new Date().toISOString().slice(0, 10)}.csv`);
        const summary = document.getElementById('orders-export-summary');
        if (summary) summary.textContent = `Exported ${filtered.length} orders.`;
    });
    document.getElementById('orders-export-queue')?.addEventListener('click', () => {
        const s = document.getElementById('orders-start')?.value;
        const e = document.getElementById('orders-end')?.value;
        const filtered = filterOrdersByDate(supplierState.orders || [], s, e)
            .filter((order) => order.status !== 'Delivered');
        exportOrdersCsv(filtered, `supplier-queue-${new Date().toISOString().slice(0, 10)}.csv`);
        const summary = document.getElementById('orders-queue-export-summary');
        if (summary) summary.textContent = `Exported ${filtered.length} queued orders.`;
    });
    document.getElementById('orders-export-columns')?.addEventListener('click', openOrdersExportModal);
    document.getElementById('orders-export-cancel')?.addEventListener('click', closeOrdersExportModal);
    document.getElementById('orders-export-confirm')?.addEventListener('click', () => {
        const picker = document.getElementById('orders-column-picker');
        if (!picker) return;
        const selected = Array.from(picker.querySelectorAll('input[type="checkbox"]'))
            .filter((cb) => cb.checked)
            .map((cb) => cb.dataset.col)
            .filter(Boolean);
        supplierState.orderExportColumns = selected.length ? selected : supplierState.orderExportColumns;
        closeOrdersExportModal();
    });

    // Check whether the currently logged-in user (regular auth token) is the configured supplier
    async function checkUserVisibility() {
        try {
            const userToken = getUserToken();
            if (!userToken || !isJwtLikeToken(userToken)) return false;
            const res = await fetch("/api/supplier/visibility", {
                headers: { Authorization: `Bearer ${userToken}` }
            });
            const data = await res.json().catch(() => ({}));
            return Boolean(data?.allowed);
        } catch (_err) {
            return false;
        }
    }

    // Initial visibility check (do NOT auto-open dashboard).
    supplierVisibilityAllowed = await checkUserVisibility();

    // Supplier header controls (toggle + nav). Reveal and attach handlers.
    const supplierToggle = document.getElementById('supplier-toggle');
    const supplierNav = document.getElementById('supplier-nav');
    const revealSupplierControls = (isAllowed = supplierVisibilityAllowed) => {
        const hasSupplierToken = Boolean(supplierState.token || localStorage.getItem('supplierToken'));
        // Always reveal controls in embedded view; mark when login is required so clicks can prompt login
        if (supplierToggle) {
            supplierToggle.hidden = false;
            if (!isAllowed && !hasSupplierToken) supplierToggle.classList.add('requires-login');
            else supplierToggle.classList.remove('requires-login');
        }
        if (supplierNav) {
            supplierNav.hidden = false;
            if (!isAllowed && !hasSupplierToken) supplierNav.classList.add('requires-login');
            else supplierNav.classList.remove('requires-login');
        }
    };

    revealSupplierControls();

    // Shared handler to open supplier dashboard (when embedded on same page)
    async function openSupplierDashboard() {
        if (!supplierSection) return;
        if (supplierState.token) {
            try {
                await apiRequest('/api/supplier/me');
                await loadDashboard();
                return;
            } catch (_) {
                supplierState.token = '';
                localStorage.removeItem('supplierToken');
            }
        }

        try {
            const res = await fetch('/api/supplier/issue-token', {
                method: 'POST',
                headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && data.token) {
                supplierState.token = data.token;
                localStorage.setItem('supplierToken', data.token);
                await loadDashboard();
                return;
            }
        } catch (err) {
            console.warn('Issue-token error', err);
        }

        showLogin();
    }

    // Header click behavior: always attach so header works even when embedded supplier section is not present
    async function headerSupplierClick(e) {
        e?.preventDefault();
        // If we already have a valid supplier token, try validate and navigate
        const existing = localStorage.getItem('supplierToken');
        if (existing) {
            try {
                const res = await fetch('/api/supplier/me', { headers: { Authorization: 'Bearer ' + existing } });
                if (res.ok) {
                    window.location.href = '/supplier.html';
                    return;
                }
            } catch (_) {}
            localStorage.removeItem('supplierToken');
        }

        // If user is logged in as the supplier customer, request an issued supplier token, then navigate
        const userToken = localStorage.getItem('token') || '';
        if (userToken) {
            try {
                const res = await fetch('/api/supplier/issue-token', { method: 'POST', headers: { Authorization: 'Bearer ' + userToken } });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.token) {
                    localStorage.setItem('supplierToken', data.token);
                    window.location.href = '/supplier.html';
                    return;
                }
            } catch (_) {}
        }

        // Fallback: open standalone supplier page (will show login there)
        window.location.href = '/supplier.html';
    }

    if (supplierToggle) supplierToggle.addEventListener('click', (e) => { e.preventDefault(); headerSupplierClick(); });
    if (supplierNav) supplierNav.addEventListener('click', (e) => { e.preventDefault(); headerSupplierClick(); });

    // Wire search box
    const searchInput = document.getElementById('supplier-search-input');
    const searchClear = document.getElementById('supplier-search-clear');
    if (searchInput) {
        let searchTimer = null;
        searchInput.addEventListener('input', (e) => {
            if (searchTimer) clearTimeout(searchTimer);
            const value = e.target.value;
            searchTimer = setTimeout(() => applyProductFilter(value), 180);
        });
    }
    if (searchClear) searchClear.addEventListener('click', () => { const s = document.getElementById('supplier-search-input'); if (s) { s.value=''; applyProductFilter(''); } });

    // pagination controls & bulk actions wiring
    updatePaginationControls();
    const bulkApplyBtn = document.getElementById('bulk-action-apply');
    if (bulkApplyBtn) bulkApplyBtn.addEventListener('click', applyBulkAction);
    const bulkSelectAll = document.getElementById('bulk-select-all');
    if (bulkSelectAll) {
        bulkSelectAll.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.bulk-select').forEach((cb) => {
                cb.checked = checked;
                const id = cb.dataset.id;
                if (!id) return;
                if (checked) supplierState.selectedProductIds.add(id);
                else supplierState.selectedProductIds.delete(id);
            });
            syncBulkSelectionUI();
        });
    }

    const ordersFilterApply = document.getElementById('orders-filter-apply');
    if (ordersFilterApply) ordersFilterApply.addEventListener('click', () => {
        const s = document.getElementById('orders-start')?.value;
        const e = document.getElementById('orders-end')?.value;
        computeAnalytics(s, e);
        loadAnalytics(s, e);
    });

    const analyticsRefresh = document.getElementById('analytics-refresh');
    if (analyticsRefresh) {
        analyticsRefresh.addEventListener('click', () => {
            const s = document.getElementById('orders-start')?.value;
            const e = document.getElementById('orders-end')?.value;
            loadAnalytics(s, e);
        });
    }
    const analyticsExport = document.getElementById('analytics-export');
    if (analyticsExport) analyticsExport.addEventListener('click', exportAnalyticsCsv);
    // Business overview quick range buttons
    const rangeYesterday = document.getElementById('range-yesterday');
    const range7 = document.getElementById('range-7days');
    const range30 = document.getElementById('range-30days');
    const rangeCustom = document.getElementById('range-custom');
    const metricButtons = Array.from(document.querySelectorAll('.metric-toggle .metric'));

    function setActiveRange(button) {
        [rangeYesterday, range7, range30, rangeCustom].forEach((b) => b?.classList.remove('active'));
        if (button) button.classList.add('active');
    }

    function applyRange(start, end) {
        document.getElementById('orders-start').value = start || '';
        document.getElementById('orders-end').value = end || '';
        loadAnalytics(start, end);
    }

    function daysAgoDate(days) {
        const d = new Date();
        d.setDate(d.getDate() - days);
        return d.toISOString().slice(0, 10);
    }

    rangeYesterday?.addEventListener('click', () => { setActiveRange(rangeYesterday); const day = daysAgoDate(1); applyRange(day, day); });
    range7?.addEventListener('click', () => { setActiveRange(range7); applyRange(daysAgoDate(6), daysAgoDate(0)); });
    range30?.addEventListener('click', () => { setActiveRange(range30); applyRange(daysAgoDate(29), daysAgoDate(0)); });
    rangeCustom?.addEventListener('click', () => { setActiveRange(rangeCustom); document.getElementById('orders-start')?.focus(); });

    metricButtons.forEach((btn) => btn.addEventListener('click', (e) => {
        metricButtons.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const s = document.getElementById('orders-start')?.value;
        const eDate = document.getElementById('orders-end')?.value;
        loadAnalytics(s, eDate);
    }));
    const analyticsSchedule = document.getElementById('analytics-schedule');
    const analyticsScheduleModal = document.getElementById('analytics-schedule-modal');
    const analyticsScheduleCancel = document.getElementById('analytics-schedule-cancel');
    const analyticsScheduleSave = document.getElementById('analytics-schedule-save');
    if (analyticsSchedule && analyticsScheduleModal) {
        analyticsSchedule.addEventListener('click', () => {
            analyticsScheduleModal.hidden = false;
            document.getElementById('analytics-schedule-frequency')?.focus();
        });
    }
    if (analyticsScheduleCancel) analyticsScheduleCancel.addEventListener('click', () => {
        if (analyticsScheduleModal) analyticsScheduleModal.hidden = true;
    });
    if (analyticsScheduleSave) analyticsScheduleSave.addEventListener('click', () => {
        const frequency = document.getElementById('analytics-schedule-frequency')?.value || 'daily';
        const email = document.getElementById('analytics-schedule-email')?.value || '';
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            alert('Enter a valid email address.');
            return;
        }
        apiRequest('/api/supplier/analytics/schedule', {
            method: 'POST',
            body: JSON.stringify({ frequency, email, active: true })
        })
            .then(() => {
                if (analyticsScheduleModal) analyticsScheduleModal.hidden = true;
                showToast('Schedule saved');
                loadAnalyticsSchedule();
            })
            .catch((err) => {
                alert(err.message || 'Failed to save schedule');
            });
    });

    // Orders page split toggle (All Orders / Status Queue)
    const ordersViewButtons = Array.from(document.querySelectorAll('#orders-view-toggle [data-order-view]'));
    const orderViewPanels = Array.from(document.querySelectorAll('[data-order-view-panel]'));
    if (ordersViewButtons.length && orderViewPanels.length) {
        const setOrdersView = (view) => {
            ordersViewButtons.forEach((btn) => {
                const active = btn.dataset.orderView === view;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });

            orderViewPanels.forEach((panel) => {
                panel.hidden = panel.dataset.orderViewPanel !== view;
            });
        };

        ordersViewButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const next = btn.dataset.orderView;
                if (next) setOrdersView(next);
            });
        });

        setOrdersView('all');
    }

    // Products page split toggle (List / Add Product)
    const productsViewToggle = document.getElementById('products-view-toggle');
    const productViewButtons = Array.from(document.querySelectorAll('#products-view-toggle [data-product-view]'));
    const productViewPanels = Array.from(document.querySelectorAll('[data-product-view-panel]'));

    setProductsView = null;
    if (productsViewToggle && productViewButtons.length && productViewPanels.length) {
        setProductsView = (view) => {
            productViewButtons.forEach((btn) => {
                const active = btn.dataset.productView === view;
                btn.classList.toggle('active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            productViewPanels.forEach((panel) => {
                panel.hidden = panel.dataset.productViewPanel !== view;
            });
        };

        productViewButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const nextView = btn.dataset.productView;
                if (nextView && setProductsView) setProductsView(nextView);
            });
        });

        setProductsView('list');
    }

    // Sidebar section switching (used on single-page dashboard variant)
    const sectionLinks = Array.from(document.querySelectorAll('.supplier-nav-links a[data-section]'));
    const sectionBlocks = Array.from(document.querySelectorAll('[data-section-group]'));
    function setActiveSection(sectionKey) {
        sectionLinks.forEach((link) => {
            const active = link.dataset.section === sectionKey;
            link.classList.toggle('active', active);
            if (active) {
                link.setAttribute('aria-current', 'page');
            } else {
                link.removeAttribute('aria-current');
            }
        });

        sectionBlocks.forEach((block) => {
            const shouldShow = block.dataset.sectionGroup === sectionKey;
            block.hidden = !shouldShow;
        });
    }

    sectionLinks.forEach((link) => {
        link.addEventListener('click', (evt) => {
            evt.preventDefault();
            const sectionKey = link.dataset.section;
            if (sectionKey) setActiveSection(sectionKey);
        });
    });

    if (sectionLinks.length && sectionBlocks.length) {
        setActiveSection('overview');
    }

    // Payments page bindings:
    const paymentsDownloadTrigger = document.getElementById("payments-download-trigger");
    const paymentsDownloadMenu = document.getElementById("payments-download-menu");
    if (paymentsDownloadTrigger && paymentsDownloadMenu) {
        paymentsDownloadTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            paymentsDownloadMenu.hidden = !paymentsDownloadMenu.hidden;
        });
        document.addEventListener("click", () => {
            if (paymentsDownloadMenu) paymentsDownloadMenu.hidden = true;
        });
    }

    const btnViewUnscheduled = document.getElementById("btn-view-unscheduled");
    const unscheduledDetailsPanel = document.getElementById("unscheduled-details-panel");
    if (btnViewUnscheduled && unscheduledDetailsPanel) {
        btnViewUnscheduled.addEventListener("click", () => {
            const hidden = unscheduledDetailsPanel.hidden;
            unscheduledDetailsPanel.hidden = !hidden;
            btnViewUnscheduled.textContent = hidden ? "Hide Details" : "View Details";
        });
    }

    const paymentsSearchInput = document.getElementById("payments-search-input");
    if (paymentsSearchInput) {
        paymentsSearchInput.addEventListener("input", () => {
            renderPayments();
        });
    }

    document.getElementById("export-payments-csv")?.addEventListener("click", (e) => {
        e.preventDefault();
        const orders = supplierState.orders || [];
        if (!orders.length) { alert("No payments to export."); return; }
        const headers = ["Order ID", "Status", "Amount (₹)", "Date Placed", "Payment Method"];
        const rows = orders.map(o => [o.id, o.status, o.total, o.placed_at, o.payment_method || "cod"]);
        const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `supplier-payments-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    });

    document.getElementById("export-payments-pdf")?.addEventListener("click", (e) => {
        e.preventDefault();
        window.print();
    });

    // Returns Search and Filter
    const returnsSearchInput = document.getElementById("returns-search-input");
    const returnsStatusFilter = document.getElementById("returns-status-filter");
    const returnsSearchClear = document.getElementById("returns-search-clear");
    
    if (returnsSearchInput) {
        returnsSearchInput.addEventListener("input", () => {
            renderReturns();
        });
    }
    if (returnsStatusFilter) {
        returnsStatusFilter.addEventListener("change", () => {
            renderReturns();
        });
    }
    if (returnsSearchClear) {
        returnsSearchClear.addEventListener("click", () => {
            if (returnsSearchInput) returnsSearchInput.value = "";
            if (returnsStatusFilter) returnsStatusFilter.value = "Pending";
            renderReturns();
        });
    }

    // Returns Actions (Accept/Deny)
    if (returnsList) {
        returnsList.addEventListener("click", async (e) => {
            const btnAccept = e.target.closest(".btn-return-accept");
            const btnDeny = e.target.closest(".btn-return-deny");
            
            if (!btnAccept && !btnDeny) return;
            
            const btn = btnAccept || btnDeny;
            const id = btn.getAttribute("data-id");
            const newStatus = btnAccept ? "Accepted" : "Denied";
            
            try {
                btn.disabled = true;
                const data = await apiRequest(`/api/supplier/returns/${id}/status`, {
                    method: "PUT",
                    body: JSON.stringify({ status: newStatus })
                });
                
                if (data.success) {
                    // Update in local state
                    const itemIndex = supplierState.returns.findIndex(r => String(r.id) === String(id));
                    if (itemIndex !== -1) {
                        supplierState.returns[itemIndex].status = newStatus;
                    }
                    
                    // Show message
                    showToast(`Return request #${id} ${newStatus.toLowerCase()} successfully.`);
                    
                    // Re-render and update stats
                    renderReturns();
                    updateReturnsStats();
                } else {
                    alert(data.message || `Failed to update return status to ${newStatus}`);
                }
            } catch (err) {
                console.error("Error updating return status:", err);
                alert(`Error: ${err.message || err}`);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // Support Tickets Search and Filter
    const ticketsSearchInput = document.getElementById("tickets-search-input");
    const ticketsStatusFilter = document.getElementById("tickets-status-filter");
    const ticketsSearchClear = document.getElementById("tickets-search-clear");
    const ticketsList = document.getElementById("supplier-tickets-list");
    
    if (ticketsSearchInput) {
        ticketsSearchInput.addEventListener("input", () => {
            renderTickets();
        });
    }
    if (ticketsStatusFilter) {
        ticketsStatusFilter.addEventListener("change", () => {
            renderTickets();
        });
    }
    if (ticketsSearchClear) {
        ticketsSearchClear.addEventListener("click", () => {
            if (ticketsSearchInput) ticketsSearchInput.value = "";
            if (ticketsStatusFilter) ticketsStatusFilter.value = "open";
            renderTickets();
        });
    }

    // Support Tickets Actions (Resolve/Reopen/Close)
    if (ticketsList) {
        ticketsList.addEventListener("click", async (e) => {
            const btnResolve = e.target.closest(".btn-ticket-resolve");
            const btnClose = e.target.closest(".btn-ticket-close");
            const btnReopen = e.target.closest(".btn-ticket-reopen");
            
            if (!btnResolve && !btnClose && !btnReopen) return;
            
            const btn = btnResolve || btnClose || btnReopen;
            const id = btn.getAttribute("data-id");
            let newStatus = "open";
            if (btnResolve) newStatus = "resolved";
            if (btnClose) newStatus = "closed";
            if (btnReopen) newStatus = "open";
            
            try {
                btn.disabled = true;
                const data = await apiRequest(`/api/supplier/tickets/${id}/status`, {
                    method: "PUT",
                    body: JSON.stringify({ status: newStatus })
                });
                
                if (data.success) {
                    // Update in local state
                    const itemIndex = supplierState.tickets.findIndex(t => String(t.id) === String(id));
                    if (itemIndex !== -1) {
                        supplierState.tickets[itemIndex].status = newStatus;
                    }
                    
                    // Show message
                    showToast(`Support ticket #${id} updated to ${newStatus} successfully.`);
                    
                    // Re-render and update stats
                    renderTickets();
                    updateTicketsStats();
                } else {
                    alert(data.message || `Failed to update ticket status to ${newStatus}`);
                }
            } catch (err) {
                console.error("Error updating support ticket status:", err);
                alert(`Error: ${err.message || err}`);
            } finally {
                btn.disabled = false;
            }
        });
    }

    // CSV preview + import handlers
    const csvInput = document.getElementById('supplier-csv-input');
    const csvPreviewBtn = document.getElementById('supplier-import-preview');
    if (csvPreviewBtn && csvInput) {
            // Use PapaParse to parse file and open mapping modal
            csvPreviewBtn.addEventListener('click', async () => {
                const file = csvInput.files && csvInput.files[0];
                if (!file) { alert('Choose a CSV file first.'); return; }
                const importErrors = document.getElementById('supplier-import-errors');
                if (importErrors) importErrors.textContent = '';

                try {
                    Papa.parse(file, {
                        header: true,
                        skipEmptyLines: true,
                        complete: function(results) {
                            const rows = results.data || [];
                            const headers = results.meta && results.meta.fields ? results.meta.fields : (rows[0] ? Object.keys(rows[0]) : []);
                            renderCsvPreview(headers, rows, file.name);
                            openMappingModal(headers, rows);
                        },
                        error: function(err) {
                            if (importErrors) importErrors.textContent = 'Failed to parse CSV: ' + err.message;
                            else alert('Failed to parse CSV: ' + err.message);
                        }
                    });
                } catch (err) {
                    if (importErrors) importErrors.textContent = 'Failed to parse CSV: ' + err.message;
                    else alert('Failed to parse CSV: ' + err.message);
                }
            });

            // Mapping modal events
            const modal = document.getElementById('supplier-mapping-modal');
            const mappingRows = document.getElementById('mapping-rows');
            const mappingErrors = document.getElementById('mapping-errors');
            const importErrors = document.getElementById('supplier-import-errors');

            document.getElementById('supplier-close-map')?.addEventListener('click', () => closeMappingModal());
            document.getElementById('supplier-auto-map')?.addEventListener('click', () => autoMap());
            document.getElementById('supplier-validate-map')?.addEventListener('click', () => validateMapping());
            document.getElementById('supplier-import-mapped')?.addEventListener('click', async () => {
                try {
                    const mapped = buildMappedProducts();
                    const validation = validateMappedRows(mapped);
                    if (validation.errors.length) {
                        showMappingErrors(validation.errors);
                        return;
                    }
                    // Proceed to import mapped products
                    await importMappedProducts(mapped.products, importErrors);
                    closeMappingModal();
                    await loadProducts();
                } catch (err) {
                    showMappingErrors([String(err.message || err)]);
                }
            });

    }

    const existingToken = supplierState.token || localStorage.getItem('supplierToken') || '';
    if (existingToken) {
        supplierState.token = existingToken;
        if (loginCard) loginCard.hidden = true;
        const valid = await validateSupplierToken(existingToken);
        if (valid) {
            try {
                await loadDashboard();
                return;
            } catch (err) {
                if (err && (err.status === 401 || err.status === 403)) {
                    console.warn('Supplier dashboard auth failed with valid token.', err);
                } else {
                    console.warn('Supplier dashboard load failed with valid token.', err);
                    return;
                }
            }
        }
    }

    const issued = await tryIssueSupplierTokenFromUserToken();
    if (issued) {
        try {
            await loadDashboard();
            return;
        } catch (err) {
            if (err && (err.status === 401 || err.status === 403)) {
                console.warn('Supplier dashboard auth failed after token issue.', err);
                supplierState.token = '';
                localStorage.removeItem('supplierToken');
            } else {
                console.warn('Supplier dashboard load failed after token issue.', err);
                return;
            }
        }
    }

    showLogin();

    // Focus the first input in inline editor when opened
    const mo = new MutationObserver(() => {
        if (!inlineEditId) return;
        const editor = document.querySelector(`.inline-editor[data-inline-editor="${CSS.escape(inlineEditId)}"]`);
        if (editor) {
            const firstInput = editor.querySelector('input, textarea, select');
            if (firstInput) firstInput.focus();
        }
    });
    mo.observe(document.getElementById('supplier-product-list') || document.body, { childList: true, subtree: true });

    // CSV helpers
    function parseCSV(text) {
        const lines = text.split(/\r?\n/).filter(Boolean);
        if (!lines.length) return [];
        const headers = lines[0].split(/,|\t/).map(h => h.trim());
        const rows = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(/,|\t/);
            if (cols.length === 1 && cols[0].trim() === '') continue;
            const obj = {};
            for (let j = 0; j < headers.length; j++) {
                obj[headers[j]] = (cols[j] || '').trim();
            }
            rows.push(obj);
        }
        return rows;
    }

    // Mapping modal helpers (PapaParse-based flow uses these)
    let currentCsvHeaders = [];
    let currentCsvRows = [];

    function openMappingModal(headers, rows) {
        currentCsvHeaders = headers || [];
        currentCsvRows = rows || [];
        const mappingContainer = document.getElementById('mapping-rows');
        const modal = document.getElementById('supplier-mapping-modal');
        const errorsDiv = document.getElementById('mapping-errors');
        if (!mappingContainer || !modal) return;
        mappingContainer.innerHTML = '';
        if (errorsDiv) errorsDiv.innerHTML = '';

        const targetFields = [
            { key: 'name', label: 'Product Name', required: true },
            { key: 'category', label: 'Category', required: false },
            { key: 'price', label: 'Price', required: true },
            { key: 'stock', label: 'Stock', required: false },
            { key: 'image', label: 'Image URL', required: false },
            { key: 'description', label: 'Description', required: false },
            { key: 'sku', label: 'SKU', required: false },
            { key: 'featured', label: 'Featured', required: false }
        ];

        const options = ['-- ignore --', ...currentCsvHeaders];
        targetFields.forEach((tf) => {
            const div = document.createElement('div');
            div.className = 'mapping-row';
            const label = document.createElement('label');
            label.textContent = tf.label + (tf.required ? ' *' : '');
            const select = document.createElement('select');
            select.dataset.target = tf.key;
            options.forEach(opt => {
                const o = document.createElement('option'); o.value = opt; o.textContent = opt; select.appendChild(o);
            });
            div.appendChild(label);
            div.appendChild(select);
            mappingContainer.appendChild(div);
        });

        modal.hidden = false;
        const firstSelect = mappingContainer.querySelector('select');
        if (firstSelect) firstSelect.focus();
        if (!modal.dataset.bound) {
            modal.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') closeMappingModal();
            });
            modal.dataset.bound = 'true';
        }
    }

    function renderCsvPreview(headers, rows, filename) {
        const panel = document.getElementById('csv-preview-panel');
        const status = document.getElementById('csv-preview-status');
        const summary = document.getElementById('csv-summary');
        const head = document.getElementById('csv-preview-head');
        const body = document.getElementById('csv-preview-body');
        if (!panel || !head || !body || !summary) return;

        panel.hidden = false;
        if (status) status.textContent = `${filename || 'CSV'} • ${rows.length} rows`;

        const previewHeaders = (headers || []).slice(0, 10);
        head.innerHTML = '<tr>' + previewHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('') + '</tr>';

        const previewRows = rows.slice(0, 6);
        body.innerHTML = previewRows.map((row) => {
            return '<tr>' + previewHeaders.map((h) => {
                const value = row[h] ?? '';
                const text = String(value);
                return `<td class="cell-truncate" title="${escapeAttr(text)}">${escapeHtml(text)}</td>`;
            }).join('') + '</tr>';
        }).join('');

        const columnCount = headers.length;
        const hasRows = rows.length > 0;
        const requiredHints = ['name', 'price'];
        const lowerHeaders = headers.map((h) => h.toLowerCase());
        const missingRequired = requiredHints.filter((req) => !lowerHeaders.some((h) => h.includes(req)));

        summary.innerHTML = [
            `<div class="summary-chip"><span>Columns</span><strong>${columnCount}</strong></div>`,
            `<div class="summary-chip"><span>Rows</span><strong>${rows.length}</strong></div>`,
            hasRows ? `<div class="summary-chip good"><span>Preview</span><strong>Ready</strong></div>` : `<div class="summary-chip warn"><span>Preview</span><strong>Empty</strong></div>`,
            missingRequired.length ? `<div class="summary-chip warn"><span>Missing</span><strong>${escapeHtml(missingRequired.join(', '))}</strong></div>` : `<div class="summary-chip good"><span>Required</span><strong>OK</strong></div>`
        ].join('');
    }

    function closeMappingModal() {
        const modal = document.getElementById('supplier-mapping-modal');
        if (modal) modal.hidden = true;
    }

    function autoMap() {
        const selects = Array.from(document.querySelectorAll('#mapping-rows select'));
        const h = currentCsvHeaders.map(h=>h.toLowerCase());
        selects.forEach(s => {
            const target = s.dataset.target;
            let pick = '-- ignore --';
            if (target === 'name') {
                const idx = h.findIndex(x => ['name','title','product','product name'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            if (target === 'category') {
                const idx = h.findIndex(x => ['category','cat','type'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            if (target === 'price') {
                const idx = h.findIndex(x => ['price','mrp','cost'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            if (target === 'stock') {
                const idx = h.findIndex(x => ['stock','qty','quantity'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            if (target === 'image') {
                const idx = h.findIndex(x => ['image','image_url','imageurl','photo','img'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            if (target === 'description') {
                const idx = h.findIndex(x => ['description','desc','details'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            if (target === 'sku') {
                const idx = h.findIndex(x => ['sku','id','product_code','productid'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            if (target === 'featured') {
                const idx = h.findIndex(x => ['featured','is_featured','highlight'].includes(x)); if (idx>=0) pick = currentCsvHeaders[idx];
            }
            s.value = pick;
        });
    }

    function buildMappedProducts() {
        const selects = Array.from(document.querySelectorAll('#mapping-rows select'));
        const mapping = {};
        selects.forEach(s => { const key = s.dataset.target; if (s.value && s.value !== '-- ignore --') mapping[key] = s.value; });

        const products = currentCsvRows.map((r, idx) => {
            const p = {};
            if (mapping.name) p.name = (r[mapping.name] || '').trim();
            if (mapping.category) p.category = (r[mapping.category] || '').trim() || 'General';
            if (mapping.price) p.price = Number((r[mapping.price] || '0').toString().replace(/[^0-9.\-]/g, '')) || 0;
            if (mapping.stock) p.stock = Number((r[mapping.stock] || '0')) || 0;
            if (mapping.image) p.image = (r[mapping.image] || '').trim();
            if (mapping.description) p.description = (r[mapping.description] || '').trim();
            if (mapping.sku) p.sku = (r[mapping.sku] || '').trim();
            if (mapping.featured) {
                const v = (r[mapping.featured] || '').toString().toLowerCase();
                p.featured = (v === '1' || v === 'true' || v === 'yes');
            }
            p._row = idx + 1;
            return p;
        });

        return { mapping, products };
    }

    function validateMappedRows(mapped) {
        const errors = [];
        const products = mapped.products || [];
        products.forEach((p) => {
            const row = p._row || '?';
            if (!p.name || String(p.name).trim() === '') errors.push(`Row ${row}: missing product name`);
            if (p.price === undefined || Number.isNaN(Number(p.price)) || Number(p.price) <= 0) errors.push(`Row ${row}: invalid price (${p.price})`);
        });
        return { valid: errors.length === 0, errors, products };
    }

    function showMappingErrors(list) {
        const errorsDiv = document.getElementById('mapping-errors');
        if (!errorsDiv) return;
        errorsDiv.innerHTML = '<strong>Validation errors:</strong><ul>' + list.map(e => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
    }

    async function importMappedProducts(products, outEl) {
        // chunk and POST to bulk endpoint
        const batchSize = 200;
        let totalImported = 0;
        const failures = [];
        for (let i = 0; i < products.length; i += batchSize) {
            const chunk = products.slice(i, i + batchSize);
            try {
                const res = await fetch('/api/supplier/products/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (supplierState.token || '') },
                    body: JSON.stringify({ products: chunk })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    failures.push({ batch: i / batchSize, message: data.message || 'Server error' });
                } else {
                    totalImported += Number(data.imported || 0);
                    if (data.failures && data.failures.length) failures.push(...data.failures);
                }
            } catch (err) {
                failures.push({ batch: i / batchSize, message: String(err.message) });
            }
        }

        if (outEl) {
            outEl.innerHTML = `Imported: ${totalImported}. Failures: ${failures.length}`;
            if (failures.length) outEl.innerHTML += '<pre>' + escapeHtml(JSON.stringify(failures, null, 2)) + '</pre>';
        } else {
            alert(`Import complete. Imported: ${totalImported}. Failures: ${failures.length}`);
        }
    }

    function validateMapping() {
        try {
            const mapped = buildMappedProducts();
            const result = validateMappedRows(mapped);
            if (result.errors.length) {
                showMappingErrors(result.errors.slice(0, 25));
            } else {
                const errorsDiv = document.getElementById('mapping-errors');
                if (errorsDiv) errorsDiv.innerHTML = '<span style="color:green">Validation passed. Ready to import.</span>';
            }
        } catch (err) {
            showMappingErrors([String(err.message || err)]);
        }
    }

    function escapeHtml(s) { return String(s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

    // If user logs in on the same tab (sets localStorage.token), re-check visibility so supplier toggle appears
    window.addEventListener('storage', async (e) => {
        if (e.key === 'token') {
            const nowSupplier = await checkUserVisibility();
            if (supplierToggle) supplierToggle.hidden = !nowSupplier && !localStorage.getItem('supplierToken');
            if (supplierNav) supplierNav.hidden = !nowSupplier && !localStorage.getItem('supplierToken');
        }
        if (e.key === 'supplierToken') {
            // Update in-memory token, but do NOT auto-open dashboard — user must tap the toggle
            supplierState.token = localStorage.getItem('supplierToken') || '';
            if (supplierToggle && supplierState.token) supplierToggle.hidden = false;
            if (supplierNav && supplierState.token) supplierNav.hidden = false;
        }
    });
}

// Initialize after DOM is ready to ensure elements inserted by other scripts are present
document.addEventListener('DOMContentLoaded', () => {
    initSupplier();

    // One-time refresh for late-mounted supplier controls without broad DOM observation.
    const refreshSupplierControls = () => {
        const supplierNav = document.getElementById('supplier-nav');
        const supplierToggle = document.getElementById('supplier-toggle');
        const hasSupplierToken = Boolean(localStorage.getItem('supplierToken'));
        const allowed = supplierVisibilityAllowed;

        if (supplierNav && (hasSupplierToken || allowed)) supplierNav.hidden = false;
        if (supplierToggle && (hasSupplierToken || allowed)) supplierToggle.hidden = false;
    };

    refreshSupplierControls();
    window.addEventListener('load', refreshSupplierControls);
});
