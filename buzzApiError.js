const BuzzAPIError = function (
  message,
  buzzApiErrorInfo,
  buzzApiBody,
  buzzApiMessageId,
  buzzApiRequest
) {
  this.name = "BuzzAPIError";
  this.message = message || "BuzzApi error";
  this.stack = new Error().stack;
  this.buzzApiErrorInfo = buzzApiErrorInfo || {};
  this.buzzApiBody = buzzApiBody || {};
  this.buzzApiMessageId = buzzApiMessageId;
  this.buzzApiRequest = sanitize(buzzApiRequest) || {};
};

BuzzAPIError.prototype = Object.create(Error.prototype);
BuzzAPIError.prototype.constructor = BuzzAPIError;

/**
 * Strip password out of request body
 *
 * @param {Object} buzzApiRequest
 * @return {Object}
 */
function sanitize(buzzApiRequest) {
  if (buzzApiRequest && buzzApiRequest.options && buzzApiRequest.options.body) {
    const body = JSON.parse(buzzApiRequest.options.body);
    body.api_app_password ? body.api_app_password = "[REDACTED]": null;
    body.api_user_password ? body.api_user_password = "[REDACTED]": null;
    body.password_base64 ? body.password_base64 = "[REDACTED]": null;
    return {
      ...buzzApiRequest,
      options: { ...buzzApiRequest.options, body: JSON.stringify(body) },
    };
  }
  return buzzApiRequest;
}

export default BuzzAPIError;
