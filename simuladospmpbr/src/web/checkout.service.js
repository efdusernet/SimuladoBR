import {
  createCustomer,
  createPixPayment,
  createBoletoPayment,
  createCreditCardInstallmentPaymentLink
} from '../integrations/asaas/asaas.client.js';

export async function createPaymentIntent({ order, buyer, plan }) {
  const customer = await createCustomer({
    name: `${buyer.firstName} ${buyer.lastName}`.trim(),
    email: buyer.email,
    cpfCnpj: buyer.cpfCnpj ?? null,
    phone: buyer.phone ?? null
  });

  const value = Number((order.amount_cents / 100).toFixed(2));

  const description = `Pedido ${order.id} — ${plan.name}`;

  if (order.payment_method === 'pix') {
    const payment = await createPixPayment({
      customerId: customer.id,
      value,
      description,
      externalReference: order.id,
      dueDate: order.due_date
    });

    return {
      provider: 'asaas',
      reference: payment.id,
      objectType: 'payment',
      paymentUrl: payment.invoiceUrl ?? null,
      raw: payment
    };
  }

  if (order.payment_method === 'boleto') {
    const payment = await createBoletoPayment({
      customerId: customer.id,
      value,
      description,
      externalReference: order.id,
      dueDate: order.due_date
    });

    return {
      provider: 'asaas',
      reference: payment.id,
      objectType: 'payment',
      paymentUrl: payment.invoiceUrl ?? null,
      raw: payment
    };
  }

  // credit_card with installments up to 10x (interest handled by Asaas/card rules)
  if (order.payment_method === 'credit_card') {
    const link = await createCreditCardInstallmentPaymentLink({
      name: `${plan.name} — ${buyer.firstName} ${buyer.lastName}`.trim(),
      description: `${plan.description} (pedido ${order.id})`,
      value,
      maxInstallmentCount: 10
    });

    return {
      provider: 'asaas',
      reference: link.id,
      objectType: 'paymentLink',
      paymentUrl: link.url ?? link.checkoutUrl ?? null,
      raw: link
    };
  }

  const err = new Error('Método de pagamento inválido');
  err.status = 400;
  throw err;
}
