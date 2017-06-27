var BuzzAPIError = function(message, buzzApiErrorInfo, buzzApiBody) {
    this.name = 'BuzzAPIError';
    this.message = message || 'BuzzApi returned error_info';
    this.stack = (new Error()).stack;
    this.buzzApiErrorInfo = buzzApiErrorInfo || {};
    this.buzzApiBody = buzzApiBody || {};
};

BuzzAPIError.prototype = Object.create(Error.prototype);
BuzzAPIError.prototype.constructor = BuzzAPIError;

module.exports = BuzzAPIError;
