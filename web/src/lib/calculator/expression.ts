// Calculator-style arithmetic for number fields: "3260-5%" → 3097, "1500*2+10%" → 3300, "(100+50)/3".
// Supports + - * / (also x, ×, ÷), parentheses, a comma or dot as decimal separator and a percent
// suffix that works like a desk calculator: "a + b%" adds b % of a, while "a * b%" multiplies by b / 100.
// Parsed by hand (no eval). Returns null for anything that is not a complete, finite expression.

type Operand = { value: number; pct: boolean };

export function hasOperator(input: string): boolean {
  return /[+*/x×÷%()]/i.test(input) || /\d\s*-/.test(input);
}

export function evaluateExpression(input: string): number | null {
  const src = input.replace(/\s/g, '').replace(/,/g, '.').replace(/[x×]/gi, '*').replace(/÷/g, '/');
  if (!src) return null;
  let pos = 0;
  const peek = () => src[pos];

  const number = (): number | null => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(pos));
    if (!m) return null;
    pos += m[0].length;
    return Number(m[0]);
  };

  const factor = (): Operand | null => {
    let value: number | null;
    if (peek() === '-' || peek() === '+') {
      const sign = src[pos++] === '-' ? -1 : 1;
      const inner = factor();
      return inner && { value: sign * inner.value, pct: inner.pct };
    }
    if (peek() === '(') {
      pos++;
      value = expr();
      if (value === null || peek() !== ')') return null;
      pos++;
    } else {
      value = number();
      if (value === null) return null;
    }
    if (peek() === '%') {
      pos++;
      return { value, pct: true };
    }
    return { value, pct: false };
  };

  const term = (): Operand | null => {
    let left = factor();
    if (!left) return null;
    while (peek() === '*' || peek() === '/') {
      const op = src[pos++];
      const right = factor();
      if (!right) return null;
      const a: number = left.pct ? left.value / 100 : left.value;
      const b: number = right.pct ? right.value / 100 : right.value;
      left = { value: op === '*' ? a * b : a / b, pct: false };
    }
    return left;
  };

  const expr = (): number | null => {
    const first = term();
    if (!first) return null;
    let acc = first.pct ? first.value / 100 : first.value;
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++];
      const right = term();
      if (!right) return null;
      const b = right.pct ? (acc * right.value) / 100 : right.value;
      acc = op === '+' ? acc + b : acc - b;
    }
    return acc;
  };

  const result = expr();
  if (result === null || pos !== src.length || !Number.isFinite(result)) return null;
  return result;
}
