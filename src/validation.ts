/**
 * Validación pura de los mensajes entrantes.
 * No depende del servidor ni del estado, por eso se prueba con node:test.
 */
import { LIMITS } from './types.js';
import type { ClientMessage, Participant, ProductView } from './types.js';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(code: string, message: string): ValidationResult<never> {
  return { ok: false, code, message };
}

/** Parsea el texto recibido por WebSocket y valida la estructura. */
export function parseClientMessage(raw: string): ValidationResult<ClientMessage> {
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    return invalid('INVALID_JSON', 'El mensaje no es JSON válido.');
  }
  return validateClientMessage(data);
}

export function validateClientMessage(data: unknown): ValidationResult<ClientMessage> {
  if (!isRecord(data) || typeof data.type !== 'string') {
    return invalid('INVALID_MESSAGE', 'Falta el campo "type" o no es un string.');
  }

  switch (data.type) {
    case 'join':
      return validateName(data.name);

    case 'propose': {
      const ids = data.productIds;
      if (!Array.isArray(ids)) {
        return invalid('INVALID_PRODUCT_IDS', '"productIds" debe ser un arreglo.');
      }
      if (
        ids.length < LIMITS.minProductsPerProposal ||
        ids.length > LIMITS.maxProductsPerProposal
      ) {
        return invalid(
          'INVALID_PRODUCT_IDS',
          `Enviá entre ${LIMITS.minProductsPerProposal} y ${LIMITS.maxProductsPerProposal} ids por propuesta.`,
        );
      }
      for (const id of ids) {
        if (!isValidProductId(id)) {
          return invalid(
            'INVALID_PRODUCT_IDS',
            `Cada id debe ser un entero entre ${LIMITS.minProductId} y ${LIMITS.maxProductId}.`,
          );
        }
      }
      return { ok: true, value: { type: 'propose', productIds: ids as number[] } };
    }

    case 'vote':
    case 'unvote':
    case 'remove': {
      if (!isValidProductId(data.productId)) {
        return invalid(
          'INVALID_PRODUCT_ID',
          `"productId" debe ser un entero entre ${LIMITS.minProductId} y ${LIMITS.maxProductId}.`,
        );
      }
      return { ok: true, value: { type: data.type, productId: data.productId } };
    }

    default:
      return invalid('UNKNOWN_TYPE', `Tipo de mensaje desconocido: "${data.type}".`);
  }
}

function validateName(name: unknown): ValidationResult<ClientMessage> {
  if (typeof name !== 'string') {
    return invalid('INVALID_NAME', '"name" debe ser un string.');
  }
  const trimmed = name.trim();
  if (trimmed.length < LIMITS.nameMinLength || trimmed.length > LIMITS.nameMaxLength) {
    return invalid(
      'INVALID_NAME',
      `El nombre debe tener entre ${LIMITS.nameMinLength} y ${LIMITS.nameMaxLength} caracteres.`,
    );
  }
  return { ok: true, value: { type: 'join', name: trimmed } };
}

function isValidProductId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= LIMITS.minProductId &&
    value <= LIMITS.maxProductId
  );
}

/** Ordena el ranking: más votos primero, desempate por id para que sea estable. */
export function sortProducts(products: ProductView[]): ProductView[] {
  return [...products].sort((a, b) => b.votes - a.votes || a.id - b.id);
}

export function participantLabel(p: Participant): string {
  return `${p.name}`;
}
