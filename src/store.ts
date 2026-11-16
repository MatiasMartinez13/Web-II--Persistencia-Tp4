/**
 * Estado compartido en memoria.
 *
 * Node ejecuta este código en un único hilo: cada método es sincrónico y
 * atómico respecto del event loop. Por eso dos propuestas/votos simultáneos no
 * pueden intercalar sus mutaciones y no se generan duplicados.
 */
import { randomUUID } from 'node:crypto';
import { sortProducts } from './validation.js';
import type { CatalogProduct } from './catalog.js';
import type { Participant, ProductView } from './types.js';

interface StoredProduct {
  id: number;
  title: string;
  price: number;
  image: string;
  proposedBy: Participant;
  voters: Set<string>;
}

export type VoteResult = 'ok' | 'not_found' | 'already_voted';
export type UnvoteResult = 'ok' | 'not_found' | 'not_voted';
export type RemoveResult = 'ok' | 'not_found' | 'forbidden';

export class SharedList {
  private readonly participants = new Map<string, Participant>();
  private readonly products = new Map<number, StoredProduct>();

  join(name: string): Participant {
    const participant: Participant = { id: randomUUID(), name };
    this.participants.set(participant.id, participant);
    return participant;
  }

  leave(id: string): void {
    if (!this.participants.delete(id)) return;
    // Los votos de quien se va se liberan: solo votan los conectados.
    for (const product of this.products.values()) {
      product.voters.delete(id);
    }
  }

  getParticipants(): Participant[] {
    return [...this.participants.values()];
  }

  getParticipant(id: string): Participant | undefined {
    return this.participants.get(id);
  }

  hasProduct(id: number): boolean {
    return this.products.has(id);
  }

  /** Devuelve false si el producto ya estaba (no se sobrescribe). */
  addProduct(product: CatalogProduct, proposedBy: Participant): boolean {
    if (this.products.has(product.id)) return false;
    this.products.set(product.id, {
      ...product,
      proposedBy: { ...proposedBy },
      voters: new Set<string>(),
    });
    return true;
  }

  vote(productId: number, participantId: string): VoteResult {
    const product = this.products.get(productId);
    if (!product) return 'not_found';
    if (product.voters.has(participantId)) return 'already_voted';
    product.voters.add(participantId);
    return 'ok';
  }

  unvote(productId: number, participantId: string): UnvoteResult {
    const product = this.products.get(productId);
    if (!product) return 'not_found';
    if (!product.voters.has(participantId)) return 'not_voted';
    product.voters.delete(participantId);
    return 'ok';
  }

  /**
   * Regla aplicada en el servidor: puede quitarlo quien lo propuso,
   * o cualquier participante si el producto no tiene votos.
   */
  remove(productId: number, participantId: string): RemoveResult {
    const product = this.products.get(productId);
    if (!product) return 'not_found';
    if (product.proposedBy.id !== participantId && product.voters.size > 0) {
      return 'forbidden';
    }
    this.products.delete(productId);
    return 'ok';
  }

  /** Vista pública, ordenada por cantidad de votos (desempate por id). */
  view(): ProductView[] {
    const products: ProductView[] = [];
    for (const product of this.products.values()) {
      const voters: Participant[] = [];
      for (const voterId of product.voters) {
        const voter = this.participants.get(voterId);
        if (voter) voters.push({ ...voter });
      }
      products.push({
        id: product.id,
        title: product.title,
        price: product.price,
        image: product.image,
        proposedBy: { ...product.proposedBy },
        voters,
        votes: voters.length,
      });
    }
    return sortProducts(products);
  }

  reset(): void {
    this.participants.clear();
    this.products.clear();
  }
}
