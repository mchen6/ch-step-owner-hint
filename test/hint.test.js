'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {ownerHint} = require('../lib/hint');
const {CountinghouseError} = require('countinghouse/lib/countinghouse-error');
// the handler as the runtime calls it: (input, ctx), ctx.error the runtime's
const ctx = {error: (code, message, details) => CountinghouseError.module(code, message, details)};
const handler = require('../handlers/ownerService/hint');
const hint = Object.assign((input) => handler(input, ctx), handler);

const FIRST = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const C2 = 'b'.repeat(40);
const C3 = 'c'.repeat(40);
const C4 = 'd'.repeat(40);

test('hint lists the first-seen author first and never an email', async () => {
  const out = ownerHint({firstSeen: {commit: FIRST, authorLogin: 'octocat'}, stepCommits: [{commit: C2, authorLogin: 'hubot'}, {commit: C3, authorLogin: 'octocat'}]});
  assert.deepStrictEqual(out, {
    logins: ['octocat', 'hubot'],
    why: [
      'octocat is the author of a1b2c3d, the commit where this failure first appeared',
      'hubot is the author of bbbbbbb, a recent change before this failure'
    ]
  });
  await assert.rejects(hint({firstSeen: {commit: FIRST, authorLogin: 'octo@example.com'}, stepCommits: []}), (err) => err.code === 'INPUT_REJECTED');
  await assert.rejects(hint({firstSeen: {commit: FIRST, authorLogin: null}, stepCommits: [{commit: C2, authorLogin: 'Octo Cat <octo@example.com>'}]}), (err) => err.code === 'INPUT_REJECTED');
});

test('hint returns empty logins with an empty why when nothing is known', () => {
  assert.deepStrictEqual(ownerHint({firstSeen: {commit: FIRST, authorLogin: null}, stepCommits: []}), {logins: [], why: []});
  assert.deepStrictEqual(ownerHint({firstSeen: null, stepCommits: [{commit: C2, authorLogin: null}]}), {logins: [], why: []});
});

test('at most three logins, first-seen first, then recent changes in order, each once', () => {
  const out = ownerHint({firstSeen: {commit: FIRST, authorLogin: null}, stepCommits: [
    {commit: C2, authorLogin: 'a-one'}, {commit: C3, authorLogin: 'dependabot[bot]'}, {commit: C2, authorLogin: 'a-one'}, {commit: C4, authorLogin: 'three'}, {commit: C4, authorLogin: 'four'}
  ]});
  assert.deepStrictEqual(out.logins, ['a-one', 'dependabot[bot]', 'three']);
  assert.strictEqual(out.why.length, 3);
});

test('handler refuses what is not a GitHub login', async () => {
  const invalid = (err) => err.code === 'INPUT_REJECTED';
  for (const login of ['', '-leading', 'has space', 'a'.repeat(40), 'x\ny', 7]) {
    await assert.rejects(hint({firstSeen: {commit: FIRST, authorLogin: login}, stepCommits: []}), invalid, JSON.stringify(login));
  }
  for (const bad of [{}, null, {firstSeen: {commit: FIRST, authorLogin: 'ok'}}, {firstSeen: {authorLogin: 'ok'}, stepCommits: []}, {firstSeen: null, stepCommits: [{commit: 'xyz', authorLogin: 'ok'}]}]) {
    await assert.rejects(hint(bad), invalid, JSON.stringify(bad));
  }
  const {output} = await hint({firstSeen: {commit: FIRST, authorLogin: 'octocat'}, stepCommits: []});
  assert.deepStrictEqual(output.logins, ['octocat']);
});

test('the module is a part: never listed', () => {
  assert.deepStrictEqual(require('../package.json').countinghouse, {role: 'part'});
});

// From /code-review medium on PR #8.
test('logins are compared without case: one person is listed once', () => {
  const out = ownerHint({firstSeen: {commit: FIRST, authorLogin: 'Octocat'}, stepCommits: [{commit: C2, authorLogin: 'octocat'}, {commit: C3, authorLogin: 'hubot'}]});
  assert.deepStrictEqual(out.logins, ['Octocat', 'hubot']);
});

test('legacy logins with a trailing or doubled hyphen are accepted', async () => {
  const {output} = await hint({firstSeen: {commit: FIRST, authorLogin: 'foo-'}, stepCommits: [{commit: C2, authorLogin: 'a--b'}]});
  assert.deepStrictEqual(output.logins, ['foo-', 'a--b']);
});

// The final pass on the packs (A2): an Enterprise Managed User's login holds
// an underscore (shortcode_suffix).
test('an Enterprise Managed User login (with an underscore) is a login', async () => {
  const input = {firstSeen: {commit: FIRST, authorLogin: 'jdoe_acme'}, stepCommits: [{commit: C2, authorLogin: 'build_bot[bot]'}]};
  const out = await hint(input);
  assert.deepStrictEqual(out.output.logins, ['jdoe_acme', 'build_bot[bot]']);
  const schema = require('../schema.json').ownerService.hint;
  const login = new RegExp(schema.output.properties.logins.items.pattern);
  assert.ok(login.test('jdoe_acme'));
  assert.ok(new RegExp(schema.input.properties.firstSeen.anyOf[0].properties.authorLogin.anyOf[0].pattern).test('jdoe_acme'));
  assert.ok(new RegExp(schema.input.properties.stepCommits.items.properties.authorLogin.anyOf[0].pattern).test('jdoe_acme'));
  for (const bad of ['_lead', 'a_b_c', 'sk_live_abcdefghijklmnop', 'jdoe_', `${'a'.repeat(35)}_acme`]) {
    await assert.rejects(hint({firstSeen: {commit: FIRST, authorLogin: bad}, stepCommits: []}), (err) => err.code === 'INPUT_REJECTED', bad);
    assert.ok(!login.test(bad), bad);
  }
  assert.ok(login.test(`${'a'.repeat(34)}_acme`), '39 characters');
  assert.ok(login.test(`${'a'.repeat(39)}[bot]`), 'a bot: 39 and [bot]');
});

// A10: a commit after the first-seen one that the failure recurred on says so.
test('a later commit the failure recurred on has its own reason', async () => {
  const out = await hint({firstSeen: {commit: FIRST, authorLogin: 'octocat'}, stepCommits: [{commit: C2, authorLogin: 'hubot', recurred: true}, {commit: C3, authorLogin: 'three', recurred: false}]});
  assert.deepStrictEqual(out.output.why, [
    'octocat is the author of a1b2c3d, the commit where this failure first appeared',
    'hubot is the author of bbbbbbb, a later commit this failure also occurred on',
    'three is the author of ccccccc, a recent change before this failure'
  ]);
  await assert.rejects(hint({firstSeen: null, stepCommits: [{commit: C2, authorLogin: 'hubot', recurred: 'yes'}]}), (err) => err.code === 'INPUT_REJECTED');
});

// (a login is never followed by ':' or '=' in its reason: ch-step-redact,
// which every reason passes, would read secret-agent: … as a secret's name
// and value and mask the reason)
test('a reason starts with the login and a verb, never "<login>:"', () => {
  for (const login of ['secret-agent', 'token-bot', 'my-api-key', 'auth']) {
    const {why} = ownerHint({firstSeen: {commit: FIRST, authorLogin: login}, stepCommits: []});
    assert.ok(why[0].startsWith(`${login} is the author of `), why[0]);
  }
});
