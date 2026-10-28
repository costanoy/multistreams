import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHANNEL_ID, HttpError, LANG_CODES, catKey, getJson, langCode } from './types.js';

test('langCode: subtag primária, aliases e códigos que não são de 2 letras', () => {
  assert.equal(langCode('pt-BR'), 'pt');
  assert.equal(langCode('zh-Hans'), 'zh');
  assert.equal(langCode('en_US'), 'en');
  assert.equal(langCode('PT'), 'pt');
  assert.equal(langCode('fil'), 'tl');
  assert.equal(langCode('fil-PH'), 'tl');
  assert.equal(langCode('iw'), 'he');
  assert.equal(langCode('in'), 'id');
  assert.equal(langCode('ji'), 'yi');
  assert.equal(langCode('nb'), 'no');
  assert.equal(langCode('nn-NO'), 'no');
  // antes viravam 'fi', 'ko', 'zx', 'yu' e 'ot'
  for (const l of ['kok', 'zxx', 'yue', 'other', 'asl', '', 'p', 'constructor', '__proto__']) assert.equal(langCode(l), null, l);
  assert.equal(langCode(null), null);
  assert.equal(langCode(42), null);
});

test('LANG_CODES: as 50 línguas do app, todas de 2 letras', () => {
  assert.equal(LANG_CODES.size, 50);
  for (const l of LANG_CODES) assert.equal(langCode(l), l);
  for (const l of ['pt', 'en', 'tl', 'he', 'no', 'az']) assert.ok(LANG_CODES.has(l), l);
  assert.ok(!LANG_CODES.has('xx'));
});

test('catKey: junta nomes iguais e devolve o mesmo valor do cache', () => {
  assert.equal(catKey('Grand Theft Auto V (GTA)'), 'grand theft auto v');
  assert.equal(catKey('Grand Theft Auto V'), 'grand theft auto v');
  assert.equal(catKey('Pokémon Scarlet and Violet'), 'pokemon scarlet and violet');
  assert.equal(catKey('Just Chatting'), catKey('just  chatting!'));
  // segunda vez: vem do cache, igual
  assert.equal(catKey('Pokémon Scarlet and Violet'), 'pokemon scarlet and violet');
  assert.equal(catKey(''), '');
});

test('CHANNEL_ID: formato do id por plataforma', () => {
  assert.ok(CHANNEL_ID.twitch.test('31239503'));
  assert.ok(!CHANNEL_ID.twitch.test('abc'));
  assert.ok(CHANNEL_ID.youtube.test('UCabcdefghijklmnopqrstuv'));
  assert.ok(!CHANNEL_ID.youtube.test('UCabcdefghijklmnopqrstuv#1'));
  assert.ok(CHANNEL_ID.kick.test('gaules'));
  assert.ok(CHANNEL_ID.kick.test('silent-hill_2'));
  assert.ok(!CHANNEL_ID.kick.test('a'.repeat(26)));
  assert.ok(!CHANNEL_ID.kick.test('Gaules'));
});

test('getJson: entrega a resposta a onRes e guarda o corpo do erro', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response('{"error":{"errors":[{"reason":"quotaExceeded"}]}}', { status: 403, headers: { 'ratelimit-remaining': '5' } })) as typeof fetch;
    let seen = '';
    const err = await getJson('https://example.test/x', undefined, res => (seen = res.headers.get('ratelimit-remaining') ?? '')).catch(e => e);
    assert.equal(seen, '5');
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 403);
    assert.match(err.body, /quotaExceeded/);
  } finally {
    globalThis.fetch = real;
  }
});
