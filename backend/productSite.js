const express = require('express');
const path = require('path');
const productPlansStore = require('./services/productPlansStore');

const { getDefaultPlans } = require('./services/defaultProductPlans');

async function getPlansForRender() {
	const fallbackPlans = getDefaultPlans();
	const result = await productPlansStore.loadPlans({ fallbackPlans });
	let plans = Array.isArray(result.plans) ? result.plans : fallbackPlans;
	// Keep inactive plans out of marketing render
	plans = plans.filter((p) => p && p.is_active !== false);
	// Sort
	plans.sort((a, b) => {
		const ao = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 1000;
		const bo = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 1000;
		if (ao !== bo) return ao - bo;
		return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR');
	});
	return plans;
}

function createProductSite({ productRoot, getCsrfToken }) {
	if (!productRoot) throw new Error('productRoot is required');
	const viewsDir = path.join(productRoot, 'src', 'views');
	const publicDir = path.join(productRoot, 'public');

	const app = express();
	app.set('view engine', 'ejs');
	app.set('views', viewsDir);

	app.disable('x-powered-by');

	// Product site static assets (CSS/JS/images)
	app.use('/public', express.static(publicDir, {
		etag: false,
		lastModified: false,
		maxAge: 0,
	}));

	// Inject globals into views
	app.use((req, res, next) => {
		res.locals.productName = process.env.PRODUCT_NAME || 'SimuladosBrasil';
		res.locals.supportEmail = process.env.SUPPORT_EMAIL || 'suporte@exemplo.com';
		// Base URL for the app (used by the "Acesso" button in the marketing site)
		res.locals.appBaseUrl = process.env.APP_PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'http://app.localhost:3000';
		// Legacy name kept for compatibility with older templates
		res.locals.baseUrl = res.locals.appBaseUrl;
		return next();
	});

	app.get(['/index.html'], (req, res) => res.redirect('/'));

	app.get('/', async (req, res) => {
		const plans = await getPlansForRender();
		const planFromQuery = (typeof req.query.plan === 'string') ? req.query.plan : null;
		const focusSection = (typeof req.query.focus === 'string') ? req.query.focus : null;
		const csrfToken = (typeof getCsrfToken === 'function') ? (getCsrfToken(req, res) || '') : '';

		return res.render('pages/home', {
			title: 'SimuladosBrasil — Simulados inteligentes para PMP',
			plans,
			csrfToken,
			form: {
				firstName: '',
				lastName: '',
				email: '',
				cpfCnpj: '',
				planId: planFromQuery || 'start',
				paymentMethod: 'pix',
			},
			error: null,
			focusSection,
		});
	});

	// Legacy marketing routes: keep URLs working, but use one-page Home sections.
	app.get('/produto', (req, res) => res.redirect('/#produto'));
	app.get('/diferenciais', (req, res) => res.redirect('/#diferenciais'));
	app.get('/planos', (req, res) => res.redirect('/#planos'));
	app.get('/faq', (req, res) => res.redirect('/#faq'));

	// Legacy checkout landing: keep query plan and jump to section.
	app.get('/checkout', (req, res) => {
		const plan = (typeof req.query.plan === 'string') ? req.query.plan : null;
		const q = plan ? `?plan=${encodeURIComponent(plan)}&focus=checkout` : '?focus=checkout';
		return res.redirect(`/${q}#checkout`);
	});

	// Stub: checkout is not wired here yet (the real implementation lives in simuladospmpbr).
	app.post('/checkout', async (req, res) => {
		const plans = await getPlansForRender();
		const csrfToken = (typeof getCsrfToken === 'function') ? (getCsrfToken(req, res) || '') : '';

		return res.status(503).render('pages/home', {
			title: 'SimuladosBrasil — Simulados inteligentes para PMP',
			plans,
			csrfToken,
			form: {
				firstName: req.body?.firstName ?? '',
				lastName: req.body?.lastName ?? '',
				email: req.body?.email ?? '',
				cpfCnpj: req.body?.cpfCnpj ?? '',
				planId: req.body?.planId ?? 'start',
				paymentMethod: req.body?.paymentMethod ?? 'pix',
			},
			error: 'Checkout ainda não está configurado neste servidor.',
			focusSection: 'checkout',
		});
	});

	app.get('/checkout/sucesso', (req, res) => {
		return res.render('pages/checkout_sucesso', {
			title: 'Acesso liberado',
			order: null,
			freeEmail: String(req.query.email ?? ''),
		});
	});

	app.get('/health', (req, res) => {
		return res.json({ ok: true, service: 'product-home' });
	});

	// 404 for product site
	app.use((req, res) => {
		if (req.accepts('html')) {
			return res.status(404).render('pages/404', { title: 'Página não encontrada' });
		}
		return res.status(404).json({ error: 'not_found' });
	});

	return app;
}

module.exports = { createProductSite };
