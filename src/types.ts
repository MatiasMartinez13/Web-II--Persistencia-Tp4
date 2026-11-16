/**
 * Contrato de mensajes tipado del TP4.
 *
 * Todos los mensajes (WebSocket en ambos sentidos y eventos SSE) son JSON con
 * un campo discriminante `type`. La documentación completa está en el README.
 */

export const LIMITS = {
  nameMinLength: 1,
  nameMaxLength: 20,
  minProductsPerProposal: 1,
  maxProductsPerProposal: 10,
  minProductId: 1,
  maxProductId: 1_000_000,
  maxPayloadBytes: 16 * 1024,
  joinTimeoutMs: 15_000,
} as const;

/** Identidad pública de un participante. */
export interface Participant {
  id: string;
  name: string;
}

/** Producto tal como se expone a los clientes (ya ordenado por votos). */
export interface ProductView {
  id: number;
  title: string;
  price: number;
  image: string;
  votes: number;
  proposedBy: Participant;
  voters: Participant[];
}

export type ProposalFailureReason =
  | 'not_found'
  | 'timeout'
  | 'catalog_error'
  | 'duplicate'
  | 'invalid';

export interface ProposalFailure {
  productId: number;
  reason: ProposalFailureReason;
  message: string;
}

export type ErrorCode =
  | 'INVALID_JSON'
  | 'UNKNOWN_TYPE'
  | 'INVALID_MESSAGE'
  | 'INVALID_NAME'
  | 'INVALID_PRODUCT_IDS'
  | 'INVALID_PRODUCT_ID'
  | 'NOT_JOINED'
  | 'ALREADY_JOINED'
  | 'PRODUCT_NOT_FOUND'
  | 'ALREADY_VOTED'
  | 'NOT_VOTED'
  | 'FORBIDDEN'
  | 'INTERNAL';

/* ------------------------------------------------------------------ */
/* Cliente -> Servidor (WebSocket)                                      */
/* ------------------------------------------------------------------ */

export type ClientMessage =
  | { type: 'join'; name: string }
  | { type: 'propose'; productIds: number[] }
  | { type: 'vote'; productId: number }
  | { type: 'unvote'; productId: number }
  | { type: 'remove'; productId: number };

export type ClientMessageType = ClientMessage['type'];

/* ------------------------------------------------------------------ */
/* Servidor -> Cliente (WebSocket)                                      */
/* ------------------------------------------------------------------ */

/** Estado completo. Se envía al entrar y ante cada cambio. */
export interface StateMessage {
  type: 'state';
  you: Participant;
  participants: Participant[];
  products: ProductView[];
}

/** Resultado de una propuesta: SOLO a quien la hizo. */
export interface ProposeResultMessage {
  type: 'proposeResult';
  added: number[];
  failures: ProposalFailure[];
}

/** Error puntual: SOLO a quien envió el mensaje inválido. */
export interface ErrorMessage {
  type: 'error';
  code: ErrorCode;
  message: string;
}

export type ServerMessage = StateMessage | ProposeResultMessage | ErrorMessage;

/* ------------------------------------------------------------------ */
/* Servidor -> Pantalla (SSE)                                           */
/* ------------------------------------------------------------------ */

/** Único evento SSE (`event: state`). */
export interface ScreenStateEvent {
  type: 'state';
  participantCount: number;
  participants: Participant[];
  products: ProductView[];
  serverTime: string;
}
