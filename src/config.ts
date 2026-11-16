import { config as loadDotenv } from 'dotenv';

loadDotenv();

function positiveInt(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Variable ${name} inválida: se esperaba un entero >= 0, se recibió "${value}".`);
  }
  return parsed;
}

const catalogUrl = (process.env.CATALOG_URL ?? 'https://dummyjson.com/products').replace(/\/+$/, '');

export const config = {
  port: positiveInt(process.env.PORT, 3000, 'PORT') || 3000,
  catalogUrl,
  catalogTimeoutMs: positiveInt(process.env.CATALOG_TIMEOUT_MS, 5000, 'CATALOG_TIMEOUT_MS') || 5000,
  /** 0 desactiva el delay. >0 se envía como ?delay=N para simular catálogo lento. */
  catalogDelayMs: positiveInt(process.env.CATALOG_DELAY_MS, 0, 'CATALOG_DELAY_MS'),
} as const;
