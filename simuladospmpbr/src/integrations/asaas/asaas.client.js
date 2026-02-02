import { config } from '../../shared/config.js';

function inferDefaultApiPath(baseUrl) {
  // Asaas commonly uses either /api/v3 (www.asaas.com, sandbox.asaas.com)
  // or /v3 (api-sandbox.asaas.com style hostnames).
  const lower = baseUrl.toLowerCase();
  if (lower.includes('api-sandbox.asaas.com') || lower.includes('api.asaas.com') || lower.includes('api-')) {
    return '/v3';
  }
  return '/api/v3';
}

function getAsaasBaseUrl() {
  if (config.asaasBaseUrl) {
    let base = String(config.asaasBaseUrl).trim();
    if (base.endsWith('/')) base = base.slice(0, -1);

    // If user provided only the host (or no API path), default to /api/v3
    if (!base.endsWith('/api/v3') && !base.endsWith('/v3')) {
      base = `${base}${inferDefaultApiPath(base)}`;
    }

    return base;
  }

  if (config.asaasEnv === 'production') return 'https://www.asaas.com/api/v3';
  return 'https://sandbox.asaas.com/api/v3';
}

async function asaasFetch(path, { method = 'GET', body = null } = {}) {
  if (!config.asaasApiKey) {
    const err = new Error('ASAAS_API_KEY not configured');
    err.status = 500;
    throw err;
  }

  const url = `${getAsaasBaseUrl()}${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      access_token: config.asaasApiKey
    },
    body: body ? JSON.stringify(body) : null
  });

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const fallback = text ? text.slice(0, 300) : null;
    const err = new Error(
      data?.errors?.[0]?.description || data?.message || fallback || `Asaas error (${res.status})`
    );
    err.status = 502;
    err.details = { url, status: res.status, data, text: fallback };
    throw err;
  }

  // Some endpoints may return empty body on success.
  return data ?? { ok: true };
}

export async function getMyAccount() {
  return asaasFetch('/myAccount');
}

export async function listCustomers({ limit = 1, offset = 0 } = {}) {
  const qs = new URLSearchParams({
    limit: String(limit),
    offset: String(offset)
  });
  return asaasFetch(`/customers?${qs.toString()}`);
}

export async function createCustomer({ name, email, phone, cpfCnpj }) {
  return asaasFetch('/customers', {
    method: 'POST',
    body: {
      name,
      email,
      cpfCnpj: cpfCnpj || undefined,
      mobilePhone: phone || undefined
    }
  });
}

export async function createPayment({ customerId, value, description, externalReference }) {
  return asaasFetch('/payments', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: 'PIX',
      value,
      dueDate: new Date().toISOString().slice(0, 10),
      description,
      externalReference,
      // optional: redirecionamento após pagamento (em alguns fluxos o Asaas usa invoiceUrl)
      // successUrl: `${config.baseUrl}/checkout/sucesso?order=${encodeURIComponent(externalReference)}`
    }
  });
}

export async function createBoletoPayment({ customerId, value, description, externalReference, dueDate }) {
  return asaasFetch('/payments', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: 'BOLETO',
      value,
      dueDate,
      description,
      externalReference
    }
  });
}

export async function createPixPayment({ customerId, value, description, externalReference, dueDate }) {
  return asaasFetch('/payments', {
    method: 'POST',
    body: {
      customer: customerId,
      billingType: 'PIX',
      value,
      dueDate,
      description,
      externalReference
    }
  });
}

export async function createCreditCardInstallmentPaymentLink({ name, description, value, maxInstallmentCount }) {
  return asaasFetch('/paymentLinks', {
    method: 'POST',
    body: {
      billingType: 'CREDIT_CARD',
      chargeType: 'INSTALLMENT',
      name,
      description,
      value,
      maxInstallmentCount,
      notificationEnabled: true
    }
  });
}

export async function getPayment(paymentId) {
  return asaasFetch(`/payments/${encodeURIComponent(String(paymentId))}`);
}
