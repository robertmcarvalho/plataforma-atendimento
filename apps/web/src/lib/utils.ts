export type ClassValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Record<string, boolean>
  | ClassValue[];

function flatten(inputs: ClassValue[], out: string[]) {
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
      continue;
    }
    if (Array.isArray(input)) {
      flatten(input, out);
      continue;
    }
    if (typeof input === 'object') {
      for (const [k, v] of Object.entries(input)) {
        if (v) out.push(k);
      }
    }
  }
}

export function cn(...inputs: ClassValue[]) {
  const out: string[] = [];
  flatten(inputs, out);
  return out.join(' ');
}