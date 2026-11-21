'use strict';
// Who might know about a failure: GitHub logins only, never an e-mail or a
// display name (the access module strips those; this step refuses anything that
// is not a login, so none can pass through it). A suggestion, never an action.

const MAX_LOGINS = 3;
// Letters, digits, hyphens and underscores (an Enterprise Managed User's
// login is shortcode_suffix), at most 39 characters, starting with a letter
// or a digit; an app's bot account adds "[bot]". (GitHub forbids a trailing
// or a doubled hyphen today, but older accounts have them.) No '@', no space:
// an e-mail address or a display name never matches.
const LOGIN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,38}(?:\[bot\])?$/;
const COMMIT = /^[0-9a-f]{7,40}$/;

const isLogin = (s) => typeof s === 'string' && LOGIN.test(s);
const isCommitRef = (c) => c != null && typeof c.commit === 'string' && COMMIT.test(c.commit)
  && (c.authorLogin === null || isLogin(c.authorLogin));
const isStepCommit = (c) => isCommitRef(c) && (c.recurred === undefined || typeof c.recurred === 'boolean');
const short = (sha) => sha.slice(0, 7);

// -> {logins, why}: the author of the commit where the failure first appeared,
// then the authors of the recent changes in the order given, each once, at
// most three, compared without case as GitHub does; why[i] says why logins[i]
// is there. A step commit with recurred: true is a later commit the failure
// also occurred on; any other, a change before it. A reason starts "<login>
// is the author of": never "<login>: …", which ch-step-redact (every reason
// passes it) reads as a secret's name and value when the login is one
// (secret-agent, my-api-key).
function ownerHint({firstSeen, stepCommits}) {
  const logins = [];
  const why = [];
  const add = (login, reason) => {
    if (login === null || logins.some((l) => l.toLowerCase() === login.toLowerCase()) || logins.length >= MAX_LOGINS) return;
    logins.push(login);
    why.push(`${login} is the author of ${reason}`);
  };
  if (firstSeen) add(firstSeen.authorLogin, `${short(firstSeen.commit)}, the commit where this failure first appeared`);
  for (const c of stepCommits) add(c.authorLogin, `${short(c.commit)}, ${c.recurred === true ? 'a later commit this failure also occurred on' : 'a recent change before this failure'}`);
  return {logins, why};
}

module.exports = {ownerHint, isLogin, isCommitRef, isStepCommit};
