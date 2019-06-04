const https = require("https");
const isEmpty = require("lodash.isempty");
const debug = require("debug")("buzzapi");
const hyperid = require("hyperid")({ fixedLength: true, urlSafe: true });
const os = require("os");
const BuzzAPIError = require("./buzzApiError");

const BuzzAPI = function(config) {
  const that = this;

  this.options = {
    api_app_id: config.apiUser,
    api_app_password: Buffer.from(config.apiPassword).toString("base64"),
    api_request_mode: config.sync ? "sync" : "async",
    api_receive_timeout: config.api_receive_timeout || 900000
  };

  const server = config.server || "https://api.gatech.edu";

  const fetch = require("make-fetch-happen").defaults({
    retry: { retries: 5, randomize: true },
    onRetry: () => debug("Retrying a request"),
    agent: https.globalAgent
  });

  const unresolved = {};
  let gettingResult = false;

  this.post = function(resource, operation, data) {
    debug("Options: " + JSON.stringify(that.options));
    return new Promise((res, rej) => {
      const handle =
        data.api_client_request_handle ||
        `${process.pid}@${os.hostname()}-${hyperid()}`;

      const myOpts = {
        method: "POST",
        body: JSON.stringify({
          ...that.options,
          ...data,
          api_client_request_handle: handle
        }),
        headers: { "Content-Type": "application/json" }
      };
      debug("Requesting %s", JSON.stringify(myOpts));
      return fetch(`${server}/apiv3/${resource}/${operation}`, myOpts).then(
        response => {
          if (!response.ok) {
            return rej(new BuzzAPIError(null, null, response.statusText));
          }
          response
            .json()
            .then(json => {
              if (json.api_error_info) {
                const error = new BuzzAPIError(
                  new Error(),
                  json.api_error_info,
                  json
                );
                return rej(error);
              } else if (that.options.api_request_mode === "sync") {
                debug("Sync was set, returning the result");
                return res(json.api_result_data);
              } else {
                debug("Got messageId: %s for %s", json.api_result_data, handle);
                unresolved[json.api_result_data] = {
                  resolve: res,
                  reject: rej,
                  initTime: new Date()
                };
                that.options.ticket = json.api_app_ticket;
                return getResult();
              }
            })
            .catch(err => rej(new BuzzAPIError()));
        }
      );
    });
  };

  const resolve = function(messageId) {
    if (messageId) {
      delete unresolved[messageId];
    }
  };

  const cleanupExpired = function() {
    Object.keys(unresolved).map(messageId => {
      if (
        new Date() - unresolved[messageId].initTime >
        that.options.api_receive_timeout
      ) {
        const err = new Error("Request timed out for: " + messageId);
        unresolved[messageId].reject(err);
        resolve(messageId);
      }
    });
    return;
  };

  const scheduleRetry = function() {
    setTimeout(() => {
      return getResult();
    }, Math.floor(Math.random() * (5000 - 1000) + 1000));
  };

  const getResult = function() {
    if (gettingResult) {
      return;
    }
    gettingResult = true;
    cleanupExpired();
    const messageIds = Object.keys(unresolved);
    if (messageIds.length === 0) {
      return;
    }
    const handle = `${process.pid}@${os.hostname()}-${hyperid()}`;
    debug("Asking for result of %s using handle %s", messageIds, handle);
    return fetch(`${server}/apiv3/api.my_messages`, {
      method: "POST",
      body: JSON.stringify({
        api_operation: "read",
        api_app_ticket: that.options.ticket,
        api_pull_response_to: messageIds,
        api_receive_timeout: 5000,
        api_client_request_handle: handle
      }),
      headers: { "Content-Type": "application/json" }
    }).then(response => {
      gettingResult = false;
      if (!response.ok) {
        messageIds.map(messageId => {
          const message = unresolved[messageId];
          message.reject(new BuzzAPIError(null, null, response.statusText));
          resolve(messageId);
        });
        return Promise.reject(
          new BuzzAPIError(null, null, response.statusText)
        );
      }

      return response.json().then(json => {
        if (
          json.api_error_info ||
          (json.api_result_data && json.api_result_data.api_error_info)
        ) {
          if (json.api_error_info) {
            const message =
              unresolved[json.api_error_info.api_request_messageid];
            const err = new BuzzAPIError(
              "BuzzApi returned error_info",
              json.api_error_info,
              json
            );
            debug(unresolved);
            debug(json);
            if (message) {
              resolve(json.api_error_info.api_request_messageid);
              return message.reject(err);
            } else {
              // We don't know which message threw the error, so invalidate all of them
              messageIds.map(messageId => {
                const m = unresolved[messageId];
                m.reject(err);
                resolve(messageId);
              });
              return;
            }
          } else if (json.api_result_data) {
            const messageId = json.api_result_data.api_request_messageid;
            const message = unresolved[messageId];
            resolve(messageId);
            const err = new BuzzAPIError(
              "BuzzApi returned error_info",
              json.api_result_data.api_error_info,
              json
            );
            return message.reject(err);
          } else {
            messageIds.map(messageId => {
              const error = new BuzzAPIError(new Error(), json, json);
              const message = unresolved[messageId];
              resolve(messageId);
              return message.reject(error);
            });
          }
        } else if (isEmpty(json.api_result_data)) {
          // Empty result_data here means our data isn't ready, wait 1 to 5 seconds and try again
          debug("Result not ready for " + messageIds);
          return scheduleRetry();
        } else {
          const messageId = json.api_result_data.api_request_messageid;
          const message = unresolved[messageId];
          debug("Got result for ", messageId);
          resolve(messageId);
          message.resolve(json.api_result_data.api_result_data);
          if (Object.keys(unresolved).length > 0) {
            return getResult();
          }
          return;
        }
      });
    });
  };
};

module.exports = BuzzAPI;
