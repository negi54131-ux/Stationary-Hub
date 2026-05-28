const nodemailer = require('nodemailer');
const db = require('../db/database');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_SECURE = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER || 'no-reply@stationery.local';

const TICK_MS = 5 * 60 * 1000;

function isSmtpConfigured() {
    return Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);
}

function buildTransport() {
    if (!isSmtpConfigured()) return null;
    return nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
}

function computeAnalytics(start, end, group = 'day') {
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
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const summary = db.prepare(`
        SELECT
            COUNT(*) AS total_orders,
            COALESCE(SUM(total), 0) AS total_revenue,
            COALESCE(AVG(total), 0) AS avg_order_value,
            SUM(CASE WHEN status <> 'Delivered' THEN 1 ELSE 0 END) AS pending_orders
        FROM orders
        ${whereSql}
    `).get(...params);

    const bucketExpr = group === 'month' ? "strftime('%Y-%m', placed_at)" : "date(placed_at)";
    const series = db.prepare(`
        SELECT ${bucketExpr} AS bucket, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
        FROM orders
        ${whereSql}
        GROUP BY bucket
        ORDER BY bucket ASC
    `).all(...params);

    return {
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
    };
}

function buildAnalyticsCsv(data) {
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

    return [
        'summary',
        'metric,value',
        ...summaryLines.map((row) => row.join(',')),
        '',
        'series',
        header.join(','),
        ...rows.map((row) => row.join(','))
    ].join('\n');
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function addMonths(date, months) {
    const next = new Date(date);
    next.setMonth(next.getMonth() + months);
    return next;
}

function isDue(schedule) {
    if (!schedule.last_sent_at) return true;
    const last = new Date(schedule.last_sent_at);
    const now = new Date();
    let next = last;
    if (schedule.frequency === 'daily') next = addDays(last, 1);
    if (schedule.frequency === 'weekly') next = addDays(last, 7);
    if (schedule.frequency === 'monthly') next = addMonths(last, 1);
    return now >= next;
}

async function runTick(transport) {
    const schedules = db.prepare(
        "SELECT * FROM export_schedules WHERE active = 1 AND report_type = 'analytics'"
    ).all();

    for (const schedule of schedules) {
        if (!isDue(schedule)) continue;
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);

        const data = computeAnalytics(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), 'day');
        const csv = buildAnalyticsCsv(data);
        const subject = `Supplier analytics report (${schedule.frequency})`;

        try {
            await transport.sendMail({
                from: SMTP_FROM,
                to: schedule.email,
                subject,
                text: 'Attached is your analytics export CSV.',
                attachments: [
                    {
                        filename: `supplier-analytics-${end.toISOString().slice(0, 10)}.csv`,
                        content: csv
                    }
                ]
            });
            db.prepare(
                "UPDATE export_schedules SET last_sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
            ).run(schedule.id);
        } catch (err) {
            console.error('Scheduled export failed:', err.message || err);
        }
    }
}

function startScheduledExports() {
    if (!isSmtpConfigured()) {
        console.warn('[Scheduler] SMTP not configured. Scheduled exports disabled.');
        return;
    }

    const transport = buildTransport();
    if (!transport) return;

    runTick(transport).catch((err) => console.error('Scheduled export tick error:', err));
    setInterval(() => {
        runTick(transport).catch((err) => console.error('Scheduled export tick error:', err));
    }, TICK_MS);
}

module.exports = { startScheduledExports };
