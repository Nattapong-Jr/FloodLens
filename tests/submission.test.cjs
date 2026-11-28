const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;

test('lost response retries frozen request with the same key and body', async () => {
  const calls = [];
  const fetch = async (path, options) => {
    calls.push({path, key: options.headers['Idempotency-Key'], body: options.body});
    if (calls.length === 1) throw Error('Connection dropped after saving');
    return {ok: true, json: async () => ({id: 'receipt'})};
  };
  const ctx = vm.createContext({fetch, crypto, setTimeout, clearTimeout, AbortController});
  const source = fs.readFileSync('web/submission.js', 'utf8');
  const sender = vm.runInContext(source + "; new PendingSubmission('/api/help')", ctx);
  await assert.rejects(sender.send(() => ({people: 2, landmark: 'Dorm gate'})));
  const receipt = await sender.send(() => assert.fail('Retry must reuse the first payload'));
  assert.equal(receipt.id, 'receipt');
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(sender.pending, null);
});
