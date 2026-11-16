/**
 * Cliente del catálogo externo (DummyJSON).
 * - Un timeout por consulta mediante AbortController.
 * - Las consultas de una propuesta se lanzan en paralelo desde el servidor
 *   (ver server.ts con Promise.allSettled).
 */
import { config } from './config.js';
import type { ProposalFailureReason } from './types.js';

export interface CatalogProduct {
  id: number;
  title: string;
  price: number;
  image: string;
}

export type CatalogResult =
  | { ok: true; product: CatalogProduct }
  | { ok: false; reason: ProposalFailureReason; message: string };

function buildUrl(id: number): string {
  const url = new URL(`${config.catalogUrl}/${id}`);
  if (config.catalogDelayMs > 0) {
    url.searchParams.set('delay', String(config.catalogDelayMs));
  }
  return url.toString();
}

export async function fetchProduct(id: number): Promise<CatalogResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.catalogTimeoutMs);

  try {
    const response = await fetch(buildUrl(id), {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (response.status === 404) {
      return { ok: false, reason: 'not_found', message: `El producto ${id} no existe en el catálogo.` };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: 'catalog_error',
        message: `El catálogo respondió HTTP ${response.status} para el producto ${id}.`,
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    // DummyJSON usó `image` en versiones anteriores; hoy expone `thumbnail`
    // y `images[]`. Se aceptan las tres formas para no depender de una versión.
    const firstImage = Array.isArray(data.images) ? data.images[0] : undefined;
    const image =
      typeof data.image === 'string' && data.image
        ? data.image
        : typeof data.thumbnail === 'string' && data.thumbnail
          ? data.thumbnail
          : typeof firstImage === 'string'
            ? firstImage
            : undefined;

    if (typeof data.title !== 'string' || typeof data.price !== 'number' || !image) {
      return {
        ok: false,
        reason: 'catalog_error',
        message: `El catálogo devolvió datos incompletos para el producto ${id}.`,
      };
    }

    return {
      ok: true,
      product: {
        id,
        title: data.title,
        price: data.price,
        image,
      },
    };
  } catch (error) {
    const aborted =
      (error instanceof Error && error.name === 'AbortError') || controller.signal.aborted;
    if (aborted) {
      return {
        ok: false,
        reason: 'timeout',
        message: `El catálogo no respondió a tiempo (${config.catalogTimeoutMs} ms) para el producto ${id}.`,
      };
    }
    return {
      ok: false,
      reason: 'catalog_error',
      message: `No se pudo contactar al catálogo por el producto ${id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    clearTimeout(timer);
  }
}
