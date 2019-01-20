// @see https://devcenter.heroku.com/articles/nodejs#write-your-app

var express = require('express')
  , fs      = require('fs') // node
  , gm      = require('gm')
  , http    = require('http') // node
  , https   = require('https') // node
  , mime    = require('mime')
  , url     = require('url') // node
  // @see http://aaronheckmann.posterous.com/graphicsmagick-on-heroku-with-nodejs
  , app = express()
  , whitelist = process.env.WHITELIST || [] // [/\.gov$/, /google\.com$/]
  , delay = parseInt(process.env.DELAY) || 5000
  , mimeTypes = [
    'image/gif',
    'image/jpeg',
    'image/png',
    // Common typos
    'image/jpg',
  ];

  function retrieve(remote, req, res, next) {
    // @see http://nodejs.org/api/url.html#url_url
    var options = url.parse(remote);

    // @see https://github.com/substack/hyperquest
    options.agent = false;
    if (options.protocol !== 'http:' && options.protocol !== 'https:') {
      return res.status(404).send('Expected URI scheme to be HTTP or HTTPS');
    }

    if (!options.hostname) {
      return res.status(404).send('Expected URI host to be non-empty');
    }

    options.headers = {'User-Agent': 'image-proxy/0.0.7', 'Accept': '*/*'};

    var agent = options.protocol === 'http:' ? http : https;
    var timeout = false;
      // @see http://nodejs.org/api/http.html#http_http_get_options_callback
    var request = agent.get(options, function (response) {
        if (timeout) {
          // Status code 504 already sent.
          return;
        }

        // @see http://nodejs.org/api/http.html#http_response_statuscode
        if ((response.statusCode === 301 || response.statusCode === 302) && response.headers['location']) {
          var redirect = url.parse(response.headers['location']);
          // @see https://tools.ietf.org/html/rfc7231#section-7.1.2
          if (!redirect.protocol) {
            redirect.protocol = options.protocol;
          }

          if (!redirect.hostname) {
            redirect.hostname = options.hostname;
          }

          if (!redirect.port) {
            redirect.port = options.port;
          }

          if (!redirect.hash) {
            redirect.hash = options.hash;
          }

          return retrieve(url.format(redirect));
        }

        // The image must return status code 200.
        if (response.statusCode !== 200) {
          return res.status(404).send('Expected response code 200, got ' + response.statusCode);
        }

        // The image must be a valid content type.
        // @see http://nodejs.org/api/http.html#http_request_headers
        var mimeType = (response.headers['content-type'] || '').replace(/;.*/, '');
        extension = mime.getExtension(mimeType);

        if (mimeTypes.indexOf(mimeType) === -1) {
          return res.status(404).send('Expected content type ' + mimeTypes.join(', ') + ', got ' + mimeType);
        }

        res.setHeader('Cache-Control', mimeType);
        res.setHeader('Content-Type', 'max-age=31536000, public');

        response.pipe(res);
      }).on('error', next);

    // Timeout after five seconds. Better luck next time.
    request.setTimeout(delay, function () {
      timeout = true; // if we abort, we'll get a "socket hang up" error
      return res.status(504).send();
    });
  }

module.exports = function () {

  app.get('/:url?', function (req, res, next) {
    if (whitelist.length) {
      var parts = url.parse(req.params.url);
      if (parts.hostname) {
        var any = false, _i, _len;
        if (typeof whitelist === 'string') {
          whitelist = whitelist.split(',');
        }
        for (_i = 0, _len = whitelist.length; _i < _len; _i++) {
          if (typeof whitelist[_i] === 'string') {
            // Escape periods and add anchor.
            whitelist[_i] = new RegExp(whitelist[_i].replace('.', '\\.') + '$')
          }
          if (whitelist[_i].test(parts.hostname)) {
            any = true;
            break;
          }
        }
        if (!any) { // if none
          return res.status(404).send('Expected URI host to be whitelisted');
        }
      }
    }

    retrieve(req.params.url);
  };
  
  return app;
};
