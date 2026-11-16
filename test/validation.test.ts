import test from 'node:test';
import assert from 'node:assert/strict';

import { parseClientMessage, validateClientMessage, sortProducts } from '../src/validation.js';
import { SharedList } from '../src/store.js';
import type { ProductView } from '../src/types.js';

test('parseClientMessage rechaza texto que no es JSON', () => {
  const result = parseClientMessage('esto no es json');
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'INVALID_JSON');
});

test('rechaza mensajes sin type o con type desconocido', () => {
  const noType = validateClientMessage({ name: 'Ana' });
  assert.equal(noType.ok, false);
  if (!noType.ok) assert.equal(noType.code, 'INVALID_MESSAGE');

  const unknown = validateClientMessage({ type: 'borrarTodo' });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.code, 'UNKNOWN_TYPE');
});

test('valida el nombre: vacío, largo y tipo', () => {
  assert.equal(validateClientMessage({ type: 'join', name: '   ' }).ok, false);
  assert.equal(validateClientMessage({ type: 'join', name: 42 }).ok, false);
  assert.equal(validateClientMessage({ type: 'join', name: 'x'.repeat(21) }).ok, false);

  const ok = validateClientMessage({ type: 'join', name: '  Ana  ' });
  assert.equal(ok.ok, true);
  if (ok.ok && ok.value.type === 'join') assert.equal(ok.value.name, 'Ana');
});

test('valida propose: cantidad y tipo de ids', () => {
  assert.equal(validateClientMessage({ type: 'propose', productIds: [] }).ok, false);
  assert.equal(validateClientMessage({ type: 'propose', productIds: Array.from({ length: 11 }, (_, i) => i + 1) }).ok, false);
  assert.equal(validateClientMessage({ type: 'propose', productIds: [1, '2'] }).ok, false);
  assert.equal(validateClientMessage({ type: 'propose', productIds: [1, 1.5] }).ok, false);
  assert.equal(validateClientMessage({ type: 'propose', productIds: [0] }).ok, false);
  assert.equal(validateClientMessage({ type: 'propose', productIds: [1, 3, 7] }).ok, true);
});

test('valida productId en vote, unvote y remove', () => {
  for (const type of ['vote', 'unvote', 'remove']) {
    assert.equal(validateClientMessage({ type, productId: -1 }).ok, false);
    assert.equal(validateClientMessage({ type, productId: '1' }).ok, false);
    assert.equal(validateClientMessage({ type }).ok, false);
    assert.equal(validateClientMessage({ type, productId: 5 }).ok, true);
  }
});

test('sortProducts ordena por votos y desempata por id', () => {
  const base = (id: number, votes: number): ProductView => ({
    id,
    votes,
    title: `p${id}`,
    price: 1,
    image: '',
    proposedBy: { id: 'a', name: 'A' },
    voters: [],
  });
  assert.deepEqual(sortProducts([base(3, 1), base(2, 3), base(1, 1)]).map((p) => p.id), [2, 1, 3]);
});

test('el estado evita duplicados y respeta la regla de quitar', () => {
  const list = new SharedList();
  const ana = list.join('Ana');
  const bob = list.join('Bob');

  assert.equal(list.addProduct({ id: 1, title: 'A', price: 10, image: '' }, ana), true);
  assert.equal(list.addProduct({ id: 1, title: 'A', price: 10, image: '' }, bob), false);

  assert.equal(list.vote(1, bob.id), 'ok');
  assert.equal(list.vote(1, bob.id), 'already_voted');
  // Bob tiene un voto y no propuso → no puede quitar.
  assert.equal(list.remove(1, bob.id), 'forbidden');
  assert.equal(list.unvote(1, bob.id), 'ok');
  // Sin votos, cualquiera puede quitar.
  assert.equal(list.remove(1, bob.id), 'ok');

  list.addProduct({ id: 2, title: 'B', price: 5, image: '' }, ana);
  assert.equal(list.remove(2, bob.id), 'ok'); // sin votos
  list.addProduct({ id: 3, title: 'C', price: 5, image: '' }, ana);
  list.vote(3, bob.id);
  assert.equal(list.remove(3, ana.id), 'ok'); // quien propuso puede quitar siempre
});

test('al salir un participante se liberan sus votos', () => {
  const list = new SharedList();
  const ana = list.join('Ana');
  const bob = list.join('Bob');
  list.addProduct({ id: 9, title: 'X', price: 1, image: '' }, ana);
  list.vote(9, bob.id);
  assert.equal(list.view()[0]?.votes, 1);
  list.leave(bob.id);
  assert.equal(list.view()[0]?.votes, 0);
  assert.equal(list.getParticipants().length, 1);
});
