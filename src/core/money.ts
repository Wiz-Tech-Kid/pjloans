import type { DecimalValue } from './models';

function decimalParts(value: DecimalValue): { negative: boolean; integer: string; fraction: string } {
  const normalized = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error('Invalid monetary value.');
  return {
    negative: match[1] === '-',
    integer: match[2],
    fraction: match[3] ?? '',
  };
}

export function compareDecimalValues(left: DecimalValue, right: DecimalValue): number {
  const a = decimalParts(left);
  const b = decimalParts(right);
  const scale = Math.max(a.fraction.length, b.fraction.length);
  const aValue = BigInt(`${a.integer}${a.fraction.padEnd(scale, '0')}`) * (a.negative ? -1n : 1n);
  const bValue = BigInt(`${b.integer}${b.fraction.padEnd(scale, '0')}`) * (b.negative ? -1n : 1n);
  return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
}

export function sumDecimalValues(values: DecimalValue[]): string {
  if (values.length === 0) return '0';
  const parts = values.map(decimalParts);
  const scale = Math.max(...parts.map((part) => part.fraction.length));
  const total = parts.reduce((sum, part) => (
    sum + BigInt(`${part.integer}${part.fraction.padEnd(scale, '0')}`) * (part.negative ? -1n : 1n)
  ), 0n);
  const negative = total < 0n;
  const digits = (negative ? -total : total).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${digits}`;
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

export function multiplyDecimalByRatio(value: DecimalValue, numerator: number, denominator: number): string {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error('Invalid monetary ratio.');
  }
  const amount = decimalParts(value);
  const scale = Math.max(2, amount.fraction.length);
  const digits = BigInt(`${amount.integer}${amount.fraction.padEnd(scale, '0')}`);
  const precisionDivisor = 10n ** BigInt(scale - 2);
  const unsignedMinor = scale === 2
    ? digits
    : (digits + precisionDivisor / 2n) / precisionDivisor;
  const signedMinor = unsignedMinor * (amount.negative ? -1n : 1n);
  const product = signedMinor * BigInt(numerator);
  const divisor = BigInt(denominator);
  const rounded = product < 0n
    ? -((-product + divisor / 2n) / divisor)
    : (product + divisor / 2n) / divisor;
  const negative = rounded < 0n;
  const absolute = (negative ? -rounded : rounded).toString().padStart(3, '0');
  const integer = absolute.slice(0, -2);
  const fraction = absolute.slice(-2);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

export function formatBwp(value: DecimalValue): string {
  const rounded = multiplyDecimalByRatio(value, 1, 1);
  const amount = decimalParts(rounded);
  const fraction = amount.fraction.padEnd(2, '0');
  const formatter = new Intl.NumberFormat('en-BW', {
    style: 'currency',
    currency: 'BWP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const parts = formatter.formatToParts(0);
  const integerIndex = parts.findIndex((part) => part.type === 'integer');
  const fractionIndex = parts.findIndex((part) => part.type === 'fraction');
  const prefix = parts.slice(0, integerIndex).map((part) => part.value).join('');
  const decimalSeparator = parts.find((part) => part.type === 'decimal')?.value ?? '.';
  const suffix = parts.slice(fractionIndex + 1).map((part) => part.value).join('');
  const groupedInteger = new Intl.NumberFormat('en-BW', { maximumFractionDigits: 0 })
    .format(BigInt(amount.integer));
  const minusSign = amount.negative
    ? new Intl.NumberFormat('en-BW').formatToParts(-1).find((part) => part.type === 'minusSign')?.value ?? '-'
    : '';
  return `${minusSign}${prefix}${groupedInteger}${decimalSeparator}${fraction}${suffix}`;
}
