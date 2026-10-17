'use strict';

const { hashPassword } = require('../utils/password');

const password = process.argv[2];
if (!password) {
  // eslint-disable-next-line no-console
  console.error('Usage: npm run hash-password -- "your-password"');
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log(hashPassword(password));
