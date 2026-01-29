function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function formatCpf(digits) {
  // 000.000.000-00
  const d = digits.slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d{1,2})$/, '$1.$2.$3-$4');
}

function formatCnpj(digits) {
  // 00.000.000/0000-00
  const d = digits.slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, '$1.$2.$3/$4')
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})\/(\d{4})(\d{1,2})$/, '$1.$2.$3/$4-$5');
}

function formatCpfCnpj(digits) {
  if (digits.length <= 11) return formatCpf(digits);
  return formatCnpj(digits);
}

function isAllSameDigits(digits) {
  return /^([0-9])\1+$/.test(digits);
}

function calcCpfCheckDigit(digits, length) {
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

function isValidCpf(digits) {
  if (digits.length !== 11) return false;
  if (isAllSameDigits(digits)) return false;
  const d1 = calcCpfCheckDigit(digits, 9);
  const d2 = calcCpfCheckDigit(digits, 10);
  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

function calcCnpjCheckDigit(digits, weights) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) {
    sum += Number(digits[i]) * weights[i];
  }
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

function isValidCnpj(digits) {
  if (digits.length !== 14) return false;
  if (isAllSameDigits(digits)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calcCnpjCheckDigit(digits, w1);
  const d2 = calcCnpjCheckDigit(digits, w2);
  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

function isValidCpfOrCnpj(value) {
  const digits = onlyDigits(value);
  if (!digits) return true; // allow empty; server decides if required
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}

function isPaidPlanSelected() {
  const planSelect = document.querySelector('select[name="planId"]');
  if (!planSelect) return false;
  const opt = planSelect.options[planSelect.selectedIndex];
  if (!opt) return false;
  // data-is-free is injected by server
  return String(opt.getAttribute('data-is-free') ?? '') !== '1';
}

function initCpfCnpjMask() {
  const input = document.querySelector('input[name="cpfCnpj"]');
  if (!input) return;

  const planSelect = document.querySelector('select[name="planId"]');

  const syncRequired = () => {
    const required = isPaidPlanSelected();
    input.required = required;
    input.setAttribute('aria-required', required ? 'true' : 'false');
    input.placeholder = required ? 'Obrigatório para planos pagos' : 'Opcional (plano START)';
  };

  const validate = () => {
    const digits = onlyDigits(input.value);
    const required = Boolean(input.required);
    const ok = (required ? digits.length > 0 : true) && isValidCpfOrCnpj(input.value);
    input.classList.toggle('is-invalid', !ok);
    input.classList.toggle('is-valid', ok && onlyDigits(input.value).length > 0);
  };

  const onInput = () => {
    const digits = onlyDigits(input.value);
    input.value = formatCpfCnpj(digits);
    validate();
  };

  input.addEventListener('input', onInput);
  input.addEventListener('blur', validate);

  if (planSelect) {
    planSelect.addEventListener('change', () => {
      syncRequired();
      validate();
    });
  }

  // initial
  syncRequired();
  input.value = formatCpfCnpj(onlyDigits(input.value));
  validate();
}

document.addEventListener('DOMContentLoaded', () => {
  initCpfCnpjMask();
});
