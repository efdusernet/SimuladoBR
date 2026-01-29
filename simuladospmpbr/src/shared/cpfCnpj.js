function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

export function normalizeCpfCnpj(value) {
  const digits = onlyDigits(value);
  return digits || null;
}

function allSameDigits(digits) {
  return /^([0-9])\1+$/.test(digits);
}

function calcCpfCheckDigit(digits, length) {
  // length: 9 for first digit, 10 for second
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += Number(digits[i]) * (length + 1 - i);
  }
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCpf(cpf) {
  const digits = onlyDigits(cpf);
  if (digits.length !== 11) return false;
  if (allSameDigits(digits)) return false;

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

export function isValidCnpj(cnpj) {
  const digits = onlyDigits(cnpj);
  if (digits.length !== 14) return false;
  if (allSameDigits(digits)) return false;

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

  const d1 = calcCnpjCheckDigit(digits, w1);
  const d2 = calcCnpjCheckDigit(digits, w2);

  return d1 === Number(digits[12]) && d2 === Number(digits[13]);
}

export function isValidCpfOrCnpj(value) {
  const digits = onlyDigits(value);
  if (digits.length === 11) return isValidCpf(digits);
  if (digits.length === 14) return isValidCnpj(digits);
  return false;
}
