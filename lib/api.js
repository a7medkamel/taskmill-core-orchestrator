var Promise         = require('bluebird')
  , _               = require('lodash')
  , bluebird_retry  = require('bluebird-retry')
  , rp              = require('request-promise')
  , url             = require('url')
  , ms              = require('ms')
  ;

function api(options = {}) {
  let {
      protocol      = 'http:'
    , hostname      = 'localhost'
    , port
    , pathname
    , method        = 'GET'
    , headers
    , qs
    , body
    , timeout       = ms('5s')
    , retry         = false
    , retry_timeout = ms('30s')
    , retry_inteval = ms('10s')
    , json          = true
    , transform
  } = options;

  let uri = url.format({ protocol, hostname, port, pathname });

  let req = () => {
    return rp({ uri, method, headers, qs, body, json, timeout, simple : false, resolveWithFullResponse : true })
            .promise()
            .tap((response) => {
              if (response.statusCode < 200 || response.statusCode >= 300) {
                throw new Error(`statusCode ${response.statusCode}`);
              }

              if (json) {
                if (!_.isObject(response.body)) {
                  throw new Error('response not json');
                }
              }
            })
            .then((response) => {
              if (transform) {
                return transform(response);
              }

              return response.body;
            })
            .catch((err) => {
              console.error(err);
              throw err;
            });
  }

  if (retry) {
    return bluebird_retry(req, { timeout : retry_timeout, interval : retry_inteval });
  }

  return req();
}

module.exports = {
  api
}
