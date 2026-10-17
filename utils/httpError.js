'use strict';

/**
 * Create an HTTP error carrying a safe, human-authored public message.
 * Only `publicMessage` is ever sent to clients; `message` stays server-side.
 */
function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  err.publicMessage = message;
  return err;
}

module.exports = { httpError };
