const assert = require('assert');
const { generateToken, verifyToken } = require('../middleware/auth');

const payload = { id: 'test-user', role: 'supplier' };
const token = generateToken(payload);
const decoded = verifyToken(token);

assert.ok(typeof token === 'string' && token.length > 10, 'Token should be a non-empty string');
assert.ok(decoded && decoded.id === payload.id, 'Decoded token should match payload id');
assert.ok(decoded && decoded.role === payload.role, 'Decoded token should match payload role');

const invalid = verifyToken('invalid.token.value');
assert.strictEqual(invalid, null, 'Invalid token should return null');

console.log('auth.test.js passed');
