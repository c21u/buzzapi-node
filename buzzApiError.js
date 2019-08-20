const BuzzAPIError = function(
  message,
  buzzApiErrorInfo,
  buzzApiBody,
  buzzApiMessageId
) {
  this.name = "BuzzAPIError";
  this.message = message || "BuzzApi error";
  this.stack = new Error().stack;
  this.buzzApiErrorInfo = buzzApiErrorInfo || {};
  this.buzzApiBody = buzzApiBody || {};
  this.buzzApiMessageId = buzzApiMessageId;
};

BuzzAPIError.prototype = Object.create(Error.prototype);
BuzzAPIError.prototype.constructor = BuzzAPIError;

module.exports = BuzzAPIError;
