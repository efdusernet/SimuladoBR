import { Router } from 'express';
import csrf from 'csurf';
import { z } from 'zod';

import {
  listActivePlans,
  upsertBuyer,
  createOrder,
  getOrderById,
  getPlanById,
  grantFreeEntitlement
} from '../db/commerce.repo.js';
import { createPaymentIntent } from './checkout.service.js';
import { config } from '../shared/config.js';
import { attachPaymentToOrder } from '../db/orders.repo.js';
import { isValidCpfOrCnpj, normalizeCpfCnpj } from '../shared/cpfCnpj.js';

export const pagesRouter = Router();

const csrfProtection = csrf({ cookie: { key: config.csrfCookieName, sameSite: 'lax' } });

pagesRouter.get('/', csrfProtection, async (req, res, next) => {
  try {
    const plans = await listActivePlans();
    const planFromQuery = typeof req.query.plan === 'string' ? req.query.plan : null;
    const focusSection = typeof req.query.focus === 'string' ? req.query.focus : null;

    res.render('pages/home', {
      title: 'SimuladosBrasil — Simulados inteligentes para PMP',
      plans,
      csrfToken: req.csrfToken(),
      form: { firstName: '', lastName: '', email: '', cpfCnpj: '', planId: planFromQuery ?? 'start', paymentMethod: 'pix' },
      error: null,
      focusSection
    });
  } catch (err) {
    next(err);
  }
});

// Legacy marketing routes: keep URLs working, but use one-page Home sections.
pagesRouter.get('/produto', (req, res) => res.redirect('/#produto'));
pagesRouter.get('/diferenciais', (req, res) => res.redirect('/#diferenciais'));
pagesRouter.get('/planos', (req, res) => res.redirect('/#planos'));
pagesRouter.get('/faq', (req, res) => res.redirect('/#faq'));

// Legacy checkout landing: keep query plan and jump to section.
pagesRouter.get('/checkout', (req, res) => {
  const plan = typeof req.query.plan === 'string' ? req.query.plan : null;
  const q = plan ? `?plan=${encodeURIComponent(plan)}&focus=checkout` : '?focus=checkout';
  res.redirect(`/${q}#checkout`);
});

pagesRouter.post('/checkout', csrfProtection, async (req, res, next) => {
  try {
    const schema = z.object({
      firstName: z.string().trim().min(2),
      lastName: z.string().trim().min(2),
      email: z.string().trim().email(),
      cpfCnpj: z.string().trim().optional(),
      planId: z.string().trim().min(1),
      paymentMethod: z.enum(['pix', 'credit_card', 'boleto']).optional()
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const plans = await listActivePlans();
      return res.status(400).render('pages/home', {
        title: 'SimuladosBrasil — Simulados inteligentes para PMP',
        plans,
        csrfToken: req.csrfToken(),
        form: {
          firstName: req.body?.firstName ?? '',
          lastName: req.body?.lastName ?? '',
          email: req.body?.email ?? '',
          cpfCnpj: req.body?.cpfCnpj ?? '',
          planId: req.body?.planId ?? 'start',
          paymentMethod: req.body?.paymentMethod ?? 'pix'
        },
        error: 'Verifique os campos e tente novamente.',
        focusSection: 'checkout'
      });
    }

    const { firstName, lastName, email, planId } = parsed.data;
    const cpfCnpjRaw = (parsed.data.cpfCnpj ?? '').trim();
    const cpfCnpj = normalizeCpfCnpj(cpfCnpjRaw) ?? '';
    const paymentMethod = parsed.data.paymentMethod ?? 'pix';

    const plan = await getPlanById(planId);
    if (!plan || !plan.is_active) {
      const plans = await listActivePlans();
      return res.status(400).render('pages/home', {
        title: 'SimuladosBrasil — Simulados inteligentes para PMP',
        plans,
        csrfToken: req.csrfToken(),
        form: { firstName, lastName, email, cpfCnpj: cpfCnpjRaw, planId, paymentMethod },
        error: 'Plano inválido.',
        focusSection: 'checkout'
      });
    }

    if (!plan.is_free) {
      // Asaas requires CPF/CNPJ to create charges.
      if (!cpfCnpj) {
        const plans = await listActivePlans();
        return res.status(400).render('pages/home', {
          title: 'SimuladosBrasil — Simulados inteligentes para PMP',
          plans,
          csrfToken: req.csrfToken(),
          form: { firstName, lastName, email, cpfCnpj: cpfCnpjRaw, planId, paymentMethod },
          error: 'Informe seu CPF/CNPJ para gerar a cobrança.',
          focusSection: 'checkout'
        });
      }

      if (!isValidCpfOrCnpj(cpfCnpj)) {
        const plans = await listActivePlans();
        return res.status(400).render('pages/home', {
          title: 'SimuladosBrasil — Simulados inteligentes para PMP',
          plans,
          csrfToken: req.csrfToken(),
          form: { firstName, lastName, email, cpfCnpj: cpfCnpjRaw, planId, paymentMethod },
          error: 'CPF/CNPJ inválido. Verifique e tente novamente.',
          focusSection: 'checkout'
        });
      }
    }

    const buyer = await upsertBuyer({ firstName, lastName, email, cpfCnpj: cpfCnpj || null });

    if (plan.is_free) {
      await grantFreeEntitlement({ buyerId: buyer.id, planId: plan.id });
      return res.redirect(`/checkout/sucesso?free=1&email=${encodeURIComponent(email)}`);
    }

    const order = await createOrder({ buyerId: buyer.id, planId: plan.id, paymentMethod });

    const payment = await createPaymentIntent({
      order,
      buyer: { firstName, lastName, email, cpfCnpj: cpfCnpj || null },
      plan
    });

    await attachPaymentToOrder({
      orderId: order.id,
      provider: payment.provider,
      reference: payment.reference,
      url: payment.paymentUrl,
      status: 'pending_payment',
      metadata: { ...payment.raw, objectType: payment.objectType }
    });

    return res.redirect(`/checkout/pagar?order=${encodeURIComponent(order.id)}`);
  } catch (err) {
    next(err);
  }
});

pagesRouter.get('/checkout/pagar', async (req, res, next) => {
  try {
    const orderId = String(req.query.order ?? '');
    if (!orderId) {
      return res.status(400).render('pages/error', {
        title: 'Erro',
        status: 400,
        message: 'Pedido não informado.',
        requestId: null
      });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Erro',
        status: 404,
        message: 'Pedido não encontrado.',
        requestId: null
      });
    }

    res.render('pages/checkout_pagamento', { title: 'Pagamento', order });
  } catch (err) {
    next(err);
  }
});

pagesRouter.get('/checkout/sucesso', async (req, res, next) => {
  try {
    const isFree = String(req.query.free ?? '') === '1';
    const orderId = String(req.query.order ?? '');

    if (isFree) {
      return res.render('pages/checkout_sucesso', {
        title: 'Acesso liberado',
        order: null,
        freeEmail: String(req.query.email ?? '')
      });
    }

    if (!orderId) {
      return res.status(400).render('pages/error', {
        title: 'Erro',
        status: 400,
        message: 'Pedido não informado.',
        requestId: null
      });
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return res.status(404).render('pages/error', {
        title: 'Erro',
        status: 404,
        message: 'Pedido não encontrado.',
        requestId: null
      });
    }

    res.render('pages/checkout_sucesso', { title: 'Pedido recebido', order, freeEmail: null });
  } catch (err) {
    next(err);
  }
});
