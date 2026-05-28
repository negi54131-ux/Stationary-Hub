const loginCard = document.getElementById('admin-login-card');
const dashboard = document.getElementById('admin-dashboard');
const loginBtn = document.getElementById('admin-login');
const loginMessage = document.getElementById('admin-login-message');
const scheduleList = document.getElementById('admin-schedule-list');
const refreshBtn = document.getElementById('admin-refresh');
const form = document.getElementById('admin-schedule-form');
const formMessage = document.getElementById('admin-form-message');
const formReset = document.getElementById('admin-form-reset');

function getAuthToken() {
    return localStorage.getItem('token') || '';
}

function setMessage(el, message, isError = false) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', isError);
}

async function apiRequest(path, options = {}) {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(path, { ...options, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const message = data.message || 'Request failed.';
        throw new Error(message);
    }
    return data;
}

function showDashboard() {
    loginCard.hidden = true;
    dashboard.hidden = false;
}

function showLogin(message) {
    loginCard.hidden = false;
    dashboard.hidden = true;
    setMessage(loginMessage, message || 'Login required.', true);
}

function renderRow(row) {
    const activeLabel = row.active ? 'Active' : 'Paused';
    return `
        <tr data-id="${row.id}">
            <td>${row.supplier_email}</td>
            <td>${row.report_type}</td>
            <td>
                <select data-field="frequency">
                    <option value="daily" ${row.frequency === 'daily' ? 'selected' : ''}>Daily</option>
                    <option value="weekly" ${row.frequency === 'weekly' ? 'selected' : ''}>Weekly</option>
                    <option value="monthly" ${row.frequency === 'monthly' ? 'selected' : ''}>Monthly</option>
                </select>
            </td>
            <td><input type="email" data-field="email" maxlength="25" value="${row.email}" /></td>
            <td>
                <select data-field="active">
                    <option value="1" ${row.active ? 'selected' : ''}>${activeLabel}</option>
                    <option value="0" ${!row.active ? 'selected' : ''}>Paused</option>
                </select>
            </td>
            <td>${row.last_sent_at || '-'}</td>
            <td>
                <button class="ghost" data-action="save">Save</button>
                <button class="ghost" data-action="delete">Delete</button>
            </td>
        </tr>
    `;
}

async function loadSchedules() {
    const data = await apiRequest('/api/admin/export-schedules');
    const rows = data.schedules || [];
    scheduleList.innerHTML = rows.map(renderRow).join('') || '<tr><td colspan="7">No schedules found.</td></tr>';
}

async function handleRowAction(event) {
    const btn = event.target.closest('button');
    if (!btn) return;
    const row = btn.closest('tr');
    if (!row) return;
    const id = row.dataset.id;
    const action = btn.dataset.action;
    if (!id || !action) return;

    if (action === 'delete') {
        if (!window.confirm('Delete this schedule?')) return;
        await apiRequest(`/api/admin/export-schedules/${id}`, { method: 'DELETE' });
        await loadSchedules();
        return;
    }

    if (action === 'save') {
        const frequency = row.querySelector('[data-field="frequency"]')?.value || 'daily';
        const email = row.querySelector('[data-field="email"]')?.value || '';
        const active = row.querySelector('[data-field="active"]')?.value === '1';
        await apiRequest(`/api/admin/export-schedules/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ frequency, email, active })
        });
        await loadSchedules();
    }
}

async function handleCreateSchedule(event) {
    event.preventDefault();
    setMessage(formMessage, '');
    const supplierEmail = document.getElementById('admin-supplier-email').value.trim();
    const reportType = document.getElementById('admin-report-type').value;
    const frequency = document.getElementById('admin-frequency').value;
    const email = document.getElementById('admin-recipient-email').value.trim();

    try {
        await apiRequest('/api/admin/export-schedules', {
            method: 'POST',
            body: JSON.stringify({ supplierEmail, reportType, frequency, email, active: true })
        });
        setMessage(formMessage, 'Schedule saved.');
        form.reset();
        await loadSchedules();
    } catch (err) {
        setMessage(formMessage, err.message, true);
    }
}

async function initAdmin() {
    if (loginBtn) {
        loginBtn.addEventListener('click', async () => {
            try {
                await loadSchedules();
                showDashboard();
                setMessage(loginMessage, '');
            } catch (err) {
                showLogin(err.message);
            }
        });
    }

    refreshBtn?.addEventListener('click', loadSchedules);
    scheduleList?.addEventListener('click', handleRowAction);
    form?.addEventListener('submit', handleCreateSchedule);
    formReset?.addEventListener('click', () => form?.reset());
}

initAdmin();
