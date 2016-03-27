(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

var punycode = require('punycode');

exports.parse = urlParse;
exports.resolve = urlResolve;
exports.resolveObject = urlResolveObject;
exports.format = urlFormat;

exports.Url = Url;

function Url() {
  this.protocol = null;
  this.slashes = null;
  this.auth = null;
  this.host = null;
  this.port = null;
  this.hostname = null;
  this.hash = null;
  this.search = null;
  this.query = null;
  this.pathname = null;
  this.path = null;
  this.href = null;
}

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
var protocolPattern = /^([a-z0-9.+-]+:)/i,
    portPattern = /:[0-9]*$/,

    // RFC 2396: characters reserved for delimiting URLs.
    // We actually just auto-escape these.
    delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],

    // RFC 2396: characters not allowed for various reasons.
    unwise = ['{', '}', '|', '\\', '^', '`'].concat(delims),

    // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
    autoEscape = ['\''].concat(unwise),
    // Characters that are never ever allowed in a hostname.
    // Note that any invalid chars are also handled, but these
    // are the ones that are *expected* to be seen, so we fast-path
    // them.
    nonHostChars = ['%', '/', '?', ';', '#'].concat(autoEscape),
    hostEndingChars = ['/', '?', '#'],
    hostnameMaxLen = 255,
    hostnamePartPattern = /^[a-z0-9A-Z_-]{0,63}$/,
    hostnamePartStart = /^([a-z0-9A-Z_-]{0,63})(.*)$/,
    // protocols that can allow "unsafe" and "unwise" chars.
    unsafeProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that never have a hostname.
    hostlessProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that always contain a // bit.
    slashedProtocol = {
      'http': true,
      'https': true,
      'ftp': true,
      'gopher': true,
      'file': true,
      'http:': true,
      'https:': true,
      'ftp:': true,
      'gopher:': true,
      'file:': true
    },
    querystring = require('querystring');

function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url && isObject(url) && url instanceof Url) return url;

  var u = new Url;
  u.parse(url, parseQueryString, slashesDenoteHost);
  return u;
}

Url.prototype.parse = function(url, parseQueryString, slashesDenoteHost) {
  if (!isString(url)) {
    throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
  }

  var rest = url;

  // trim before proceeding.
  // This is to support parse stuff like "  http://foo.com  \n"
  rest = rest.trim();

  var proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    this.protocol = lowerProto;
    rest = rest.substr(proto.length);
  }

  // figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
    var slashes = rest.substr(0, 2) === '//';
    if (slashes && !(proto && hostlessProtocol[proto])) {
      rest = rest.substr(2);
      this.slashes = true;
    }
  }

  if (!hostlessProtocol[proto] &&
      (slashes || (proto && !slashedProtocol[proto]))) {

    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the last @ sign, unless some host-ending character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:c path:/?@c

    // v0.12 TODO(isaacs): This is not quite how Chrome does things.
    // Review our test case against browsers more comprehensively.

    // find the first instance of any hostEndingChars
    var hostEnd = -1;
    for (var i = 0; i < hostEndingChars.length; i++) {
      var hec = rest.indexOf(hostEndingChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }

    // at this point, either we have an explicit point where the
    // auth portion cannot go past, or the last @ char is the decider.
    var auth, atSign;
    if (hostEnd === -1) {
      // atSign can be anywhere.
      atSign = rest.lastIndexOf('@');
    } else {
      // atSign must be in auth portion.
      // http://a@b/c@d => host:b auth:a path:/c@d
      atSign = rest.lastIndexOf('@', hostEnd);
    }

    // Now we have a portion which is definitely the auth.
    // Pull that off.
    if (atSign !== -1) {
      auth = rest.slice(0, atSign);
      rest = rest.slice(atSign + 1);
      this.auth = decodeURIComponent(auth);
    }

    // the host is the remaining to the left of the first non-host char
    hostEnd = -1;
    for (var i = 0; i < nonHostChars.length; i++) {
      var hec = rest.indexOf(nonHostChars[i]);
      if (hec !== -1 && (hostEnd === -1 || hec < hostEnd))
        hostEnd = hec;
    }
    // if we still have not hit it, then the entire thing is a host.
    if (hostEnd === -1)
      hostEnd = rest.length;

    this.host = rest.slice(0, hostEnd);
    rest = rest.slice(hostEnd);

    // pull out port.
    this.parseHost();

    // we've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    this.hostname = this.hostname || '';

    // if hostname begins with [ and ends with ]
    // assume that it's an IPv6 address.
    var ipv6Hostname = this.hostname[0] === '[' &&
        this.hostname[this.hostname.length - 1] === ']';

    // validate a little.
    if (!ipv6Hostname) {
      var hostparts = this.hostname.split(/\./);
      for (var i = 0, l = hostparts.length; i < l; i++) {
        var part = hostparts[i];
        if (!part) continue;
        if (!part.match(hostnamePartPattern)) {
          var newpart = '';
          for (var j = 0, k = part.length; j < k; j++) {
            if (part.charCodeAt(j) > 127) {
              // we replace non-ASCII char with a temporary placeholder
              // we need this to make sure size of hostname is not
              // broken by replacing non-ASCII by nothing
              newpart += 'x';
            } else {
              newpart += part[j];
            }
          }
          // we test again with ASCII char only
          if (!newpart.match(hostnamePartPattern)) {
            var validParts = hostparts.slice(0, i);
            var notHost = hostparts.slice(i + 1);
            var bit = part.match(hostnamePartStart);
            if (bit) {
              validParts.push(bit[1]);
              notHost.unshift(bit[2]);
            }
            if (notHost.length) {
              rest = '/' + notHost.join('.') + rest;
            }
            this.hostname = validParts.join('.');
            break;
          }
        }
      }
    }

    if (this.hostname.length > hostnameMaxLen) {
      this.hostname = '';
    } else {
      // hostnames are always lower case.
      this.hostname = this.hostname.toLowerCase();
    }

    if (!ipv6Hostname) {
      // IDNA Support: Returns a puny coded representation of "domain".
      // It only converts the part of the domain name that
      // has non ASCII characters. I.e. it dosent matter if
      // you call it with a domain that already is in ASCII.
      var domainArray = this.hostname.split('.');
      var newOut = [];
      for (var i = 0; i < domainArray.length; ++i) {
        var s = domainArray[i];
        newOut.push(s.match(/[^A-Za-z0-9_-]/) ?
            'xn--' + punycode.encode(s) : s);
      }
      this.hostname = newOut.join('.');
    }

    var p = this.port ? ':' + this.port : '';
    var h = this.hostname || '';
    this.host = h + p;
    this.href += this.host;

    // strip [ and ] from the hostname
    // the host field still retains them, though
    if (ipv6Hostname) {
      this.hostname = this.hostname.substr(1, this.hostname.length - 2);
      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  // now rest is set to the post-host stuff.
  // chop off any delim chars.
  if (!unsafeProtocol[lowerProto]) {

    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    for (var i = 0, l = autoEscape.length; i < l; i++) {
      var ae = autoEscape[i];
      var esc = encodeURIComponent(ae);
      if (esc === ae) {
        esc = escape(ae);
      }
      rest = rest.split(ae).join(esc);
    }
  }


  // chop off from the tail first.
  var hash = rest.indexOf('#');
  if (hash !== -1) {
    // got a fragment string.
    this.hash = rest.substr(hash);
    rest = rest.slice(0, hash);
  }
  var qm = rest.indexOf('?');
  if (qm !== -1) {
    this.search = rest.substr(qm);
    this.query = rest.substr(qm + 1);
    if (parseQueryString) {
      this.query = querystring.parse(this.query);
    }
    rest = rest.slice(0, qm);
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    this.search = '';
    this.query = {};
  }
  if (rest) this.pathname = rest;
  if (slashedProtocol[lowerProto] &&
      this.hostname && !this.pathname) {
    this.pathname = '/';
  }

  //to support http.request
  if (this.pathname || this.search) {
    var p = this.pathname || '';
    var s = this.search || '';
    this.path = p + s;
  }

  // finally, reconstruct the href based on what has been validated.
  this.href = this.format();
  return this;
};

// format a parsed object into a url string
function urlFormat(obj) {
  // ensure it's an object, and not a string url.
  // If it's an obj, this is a no-op.
  // this way, you can call url_format() on strings
  // to clean up potentially wonky urls.
  if (isString(obj)) obj = urlParse(obj);
  if (!(obj instanceof Url)) return Url.prototype.format.call(obj);
  return obj.format();
}

Url.prototype.format = function() {
  var auth = this.auth || '';
  if (auth) {
    auth = encodeURIComponent(auth);
    auth = auth.replace(/%3A/i, ':');
    auth += '@';
  }

  var protocol = this.protocol || '',
      pathname = this.pathname || '',
      hash = this.hash || '',
      host = false,
      query = '';

  if (this.host) {
    host = auth + this.host;
  } else if (this.hostname) {
    host = auth + (this.hostname.indexOf(':') === -1 ?
        this.hostname :
        '[' + this.hostname + ']');
    if (this.port) {
      host += ':' + this.port;
    }
  }

  if (this.query &&
      isObject(this.query) &&
      Object.keys(this.query).length) {
    query = querystring.stringify(this.query);
  }

  var search = this.search || (query && ('?' + query)) || '';

  if (protocol && protocol.substr(-1) !== ':') protocol += ':';

  // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (this.slashes ||
      (!protocol || slashedProtocol[protocol]) && host !== false) {
    host = '//' + (host || '');
    if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
  } else if (!host) {
    host = '';
  }

  if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
  if (search && search.charAt(0) !== '?') search = '?' + search;

  pathname = pathname.replace(/[?#]/g, function(match) {
    return encodeURIComponent(match);
  });
  search = search.replace('#', '%23');

  return protocol + host + pathname + search + hash;
};

function urlResolve(source, relative) {
  return urlParse(source, false, true).resolve(relative);
}

Url.prototype.resolve = function(relative) {
  return this.resolveObject(urlParse(relative, false, true)).format();
};

function urlResolveObject(source, relative) {
  if (!source) return relative;
  return urlParse(source, false, true).resolveObject(relative);
}

Url.prototype.resolveObject = function(relative) {
  if (isString(relative)) {
    var rel = new Url();
    rel.parse(relative, false, true);
    relative = rel;
  }

  var result = new Url();
  Object.keys(this).forEach(function(k) {
    result[k] = this[k];
  }, this);

  // hash is always overridden, no matter what.
  // even href="" will remove it.
  result.hash = relative.hash;

  // if the relative url is empty, then there's nothing left to do here.
  if (relative.href === '') {
    result.href = result.format();
    return result;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    // take everything except the protocol from relative
    Object.keys(relative).forEach(function(k) {
      if (k !== 'protocol')
        result[k] = relative[k];
    });

    //urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[result.protocol] &&
        result.hostname && !result.pathname) {
      result.path = result.pathname = '/';
    }

    result.href = result.format();
    return result;
  }

  if (relative.protocol && relative.protocol !== result.protocol) {
    // if it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol[relative.protocol]) {
      Object.keys(relative).forEach(function(k) {
        result[k] = relative[k];
      });
      result.href = result.format();
      return result;
    }

    result.protocol = relative.protocol;
    if (!relative.host && !hostlessProtocol[relative.protocol]) {
      var relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      result.pathname = relPath.join('/');
    } else {
      result.pathname = relative.pathname;
    }
    result.search = relative.search;
    result.query = relative.query;
    result.host = relative.host || '';
    result.auth = relative.auth;
    result.hostname = relative.hostname || relative.host;
    result.port = relative.port;
    // to support http.request
    if (result.pathname || result.search) {
      var p = result.pathname || '';
      var s = result.search || '';
      result.path = p + s;
    }
    result.slashes = result.slashes || relative.slashes;
    result.href = result.format();
    return result;
  }

  var isSourceAbs = (result.pathname && result.pathname.charAt(0) === '/'),
      isRelAbs = (
          relative.host ||
          relative.pathname && relative.pathname.charAt(0) === '/'
      ),
      mustEndAbs = (isRelAbs || isSourceAbs ||
                    (result.host && relative.pathname)),
      removeAllDots = mustEndAbs,
      srcPath = result.pathname && result.pathname.split('/') || [],
      relPath = relative.pathname && relative.pathname.split('/') || [],
      psychotic = result.protocol && !slashedProtocol[result.protocol];

  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // result.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {
    result.hostname = '';
    result.port = null;
    if (result.host) {
      if (srcPath[0] === '') srcPath[0] = result.host;
      else srcPath.unshift(result.host);
    }
    result.host = '';
    if (relative.protocol) {
      relative.hostname = null;
      relative.port = null;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      relative.host = null;
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }

  if (isRelAbs) {
    // it's absolute.
    result.host = (relative.host || relative.host === '') ?
                  relative.host : result.host;
    result.hostname = (relative.hostname || relative.hostname === '') ?
                      relative.hostname : result.hostname;
    result.search = relative.search;
    result.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    result.search = relative.search;
    result.query = relative.query;
  } else if (!isNullOrUndefined(relative.search)) {
    // just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      result.hostname = result.host = srcPath.shift();
      //occationaly the auth can get stuck only in host
      //this especialy happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      var authInHost = result.host && result.host.indexOf('@') > 0 ?
                       result.host.split('@') : false;
      if (authInHost) {
        result.auth = authInHost.shift();
        result.host = result.hostname = authInHost.shift();
      }
    }
    result.search = relative.search;
    result.query = relative.query;
    //to support http.request
    if (!isNull(result.pathname) || !isNull(result.search)) {
      result.path = (result.pathname ? result.pathname : '') +
                    (result.search ? result.search : '');
    }
    result.href = result.format();
    return result;
  }

  if (!srcPath.length) {
    // no path at all.  easy.
    // we've already handled the other stuff above.
    result.pathname = null;
    //to support http.request
    if (result.search) {
      result.path = '/' + result.search;
    } else {
      result.path = null;
    }
    result.href = result.format();
    return result;
  }

  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash = (
      (result.host || relative.host) && (last === '.' || last === '..') ||
      last === '');

  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last == '.') {
      srcPath.splice(i, 1);
    } else if (last === '..') {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift('..');
    }
  }

  if (mustEndAbs && srcPath[0] !== '' &&
      (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
    srcPath.unshift('');
  }

  if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
    srcPath.push('');
  }

  var isAbsolute = srcPath[0] === '' ||
      (srcPath[0] && srcPath[0].charAt(0) === '/');

  // put the host back
  if (psychotic) {
    result.hostname = result.host = isAbsolute ? '' :
                                    srcPath.length ? srcPath.shift() : '';
    //occationaly the auth can get stuck only in host
    //this especialy happens in cases like
    //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    var authInHost = result.host && result.host.indexOf('@') > 0 ?
                     result.host.split('@') : false;
    if (authInHost) {
      result.auth = authInHost.shift();
      result.host = result.hostname = authInHost.shift();
    }
  }

  mustEndAbs = mustEndAbs || (result.host && srcPath.length);

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift('');
  }

  if (!srcPath.length) {
    result.pathname = null;
    result.path = null;
  } else {
    result.pathname = srcPath.join('/');
  }

  //to support request.http
  if (!isNull(result.pathname) || !isNull(result.search)) {
    result.path = (result.pathname ? result.pathname : '') +
                  (result.search ? result.search : '');
  }
  result.auth = relative.auth || result.auth;
  result.slashes = result.slashes || relative.slashes;
  result.href = result.format();
  return result;
};

Url.prototype.parseHost = function() {
  var host = this.host;
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    if (port !== ':') {
      this.port = port.substr(1);
    }
    host = host.substr(0, host.length - port.length);
  }
  if (host) this.hostname = host;
};

function isString(arg) {
  return typeof arg === "string";
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isNull(arg) {
  return arg === null;
}
function isNullOrUndefined(arg) {
  return  arg == null;
}

},{"punycode":2,"querystring":6}],2:[function(require,module,exports){
(function (global){
/*! https://mths.be/punycode v1.3.2 by @mathias */
;(function(root) {

	/** Detect free variables */
	var freeExports = typeof exports == 'object' && exports &&
		!exports.nodeType && exports;
	var freeModule = typeof module == 'object' && module &&
		!module.nodeType && module;
	var freeGlobal = typeof global == 'object' && global;
	if (
		freeGlobal.global === freeGlobal ||
		freeGlobal.window === freeGlobal ||
		freeGlobal.self === freeGlobal
	) {
		root = freeGlobal;
	}

	/**
	 * The `punycode` object.
	 * @name punycode
	 * @type Object
	 */
	var punycode,

	/** Highest positive signed 32-bit float value */
	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

	/** Bootstring parameters */
	base = 36,
	tMin = 1,
	tMax = 26,
	skew = 38,
	damp = 700,
	initialBias = 72,
	initialN = 128, // 0x80
	delimiter = '-', // '\x2D'

	/** Regular expressions */
	regexPunycode = /^xn--/,
	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

	/** Error messages */
	errors = {
		'overflow': 'Overflow: input needs wider integers to process',
		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
		'invalid-input': 'Invalid input'
	},

	/** Convenience shortcuts */
	baseMinusTMin = base - tMin,
	floor = Math.floor,
	stringFromCharCode = String.fromCharCode,

	/** Temporary variable */
	key;

	/*--------------------------------------------------------------------------*/

	/**
	 * A generic error utility function.
	 * @private
	 * @param {String} type The error type.
	 * @returns {Error} Throws a `RangeError` with the applicable error message.
	 */
	function error(type) {
		throw RangeError(errors[type]);
	}

	/**
	 * A generic `Array#map` utility function.
	 * @private
	 * @param {Array} array The array to iterate over.
	 * @param {Function} callback The function that gets called for every array
	 * item.
	 * @returns {Array} A new array of values returned by the callback function.
	 */
	function map(array, fn) {
		var length = array.length;
		var result = [];
		while (length--) {
			result[length] = fn(array[length]);
		}
		return result;
	}

	/**
	 * A simple `Array#map`-like wrapper to work with domain name strings or email
	 * addresses.
	 * @private
	 * @param {String} domain The domain name or email address.
	 * @param {Function} callback The function that gets called for every
	 * character.
	 * @returns {Array} A new string of characters returned by the callback
	 * function.
	 */
	function mapDomain(string, fn) {
		var parts = string.split('@');
		var result = '';
		if (parts.length > 1) {
			// In email addresses, only the domain name should be punycoded. Leave
			// the local part (i.e. everything up to `@`) intact.
			result = parts[0] + '@';
			string = parts[1];
		}
		// Avoid `split(regex)` for IE8 compatibility. See #17.
		string = string.replace(regexSeparators, '\x2E');
		var labels = string.split('.');
		var encoded = map(labels, fn).join('.');
		return result + encoded;
	}

	/**
	 * Creates an array containing the numeric code points of each Unicode
	 * character in the string. While JavaScript uses UCS-2 internally,
	 * this function will convert a pair of surrogate halves (each of which
	 * UCS-2 exposes as separate characters) into a single code point,
	 * matching UTF-16.
	 * @see `punycode.ucs2.encode`
	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
	 * @memberOf punycode.ucs2
	 * @name decode
	 * @param {String} string The Unicode input string (UCS-2).
	 * @returns {Array} The new array of code points.
	 */
	function ucs2decode(string) {
		var output = [],
		    counter = 0,
		    length = string.length,
		    value,
		    extra;
		while (counter < length) {
			value = string.charCodeAt(counter++);
			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
				// high surrogate, and there is a next character
				extra = string.charCodeAt(counter++);
				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
				} else {
					// unmatched surrogate; only append this code unit, in case the next
					// code unit is the high surrogate of a surrogate pair
					output.push(value);
					counter--;
				}
			} else {
				output.push(value);
			}
		}
		return output;
	}

	/**
	 * Creates a string based on an array of numeric code points.
	 * @see `punycode.ucs2.decode`
	 * @memberOf punycode.ucs2
	 * @name encode
	 * @param {Array} codePoints The array of numeric code points.
	 * @returns {String} The new Unicode string (UCS-2).
	 */
	function ucs2encode(array) {
		return map(array, function(value) {
			var output = '';
			if (value > 0xFFFF) {
				value -= 0x10000;
				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
				value = 0xDC00 | value & 0x3FF;
			}
			output += stringFromCharCode(value);
			return output;
		}).join('');
	}

	/**
	 * Converts a basic code point into a digit/integer.
	 * @see `digitToBasic()`
	 * @private
	 * @param {Number} codePoint The basic numeric code point value.
	 * @returns {Number} The numeric value of a basic code point (for use in
	 * representing integers) in the range `0` to `base - 1`, or `base` if
	 * the code point does not represent a value.
	 */
	function basicToDigit(codePoint) {
		if (codePoint - 48 < 10) {
			return codePoint - 22;
		}
		if (codePoint - 65 < 26) {
			return codePoint - 65;
		}
		if (codePoint - 97 < 26) {
			return codePoint - 97;
		}
		return base;
	}

	/**
	 * Converts a digit/integer into a basic code point.
	 * @see `basicToDigit()`
	 * @private
	 * @param {Number} digit The numeric value of a basic code point.
	 * @returns {Number} The basic code point whose value (when used for
	 * representing integers) is `digit`, which needs to be in the range
	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
	 * used; else, the lowercase form is used. The behavior is undefined
	 * if `flag` is non-zero and `digit` has no uppercase form.
	 */
	function digitToBasic(digit, flag) {
		//  0..25 map to ASCII a..z or A..Z
		// 26..35 map to ASCII 0..9
		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
	}

	/**
	 * Bias adaptation function as per section 3.4 of RFC 3492.
	 * http://tools.ietf.org/html/rfc3492#section-3.4
	 * @private
	 */
	function adapt(delta, numPoints, firstTime) {
		var k = 0;
		delta = firstTime ? floor(delta / damp) : delta >> 1;
		delta += floor(delta / numPoints);
		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
			delta = floor(delta / baseMinusTMin);
		}
		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
	}

	/**
	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
	 * symbols.
	 * @memberOf punycode
	 * @param {String} input The Punycode string of ASCII-only symbols.
	 * @returns {String} The resulting string of Unicode symbols.
	 */
	function decode(input) {
		// Don't use UCS-2
		var output = [],
		    inputLength = input.length,
		    out,
		    i = 0,
		    n = initialN,
		    bias = initialBias,
		    basic,
		    j,
		    index,
		    oldi,
		    w,
		    k,
		    digit,
		    t,
		    /** Cached calculation results */
		    baseMinusT;

		// Handle the basic code points: let `basic` be the number of input code
		// points before the last delimiter, or `0` if there is none, then copy
		// the first basic code points to the output.

		basic = input.lastIndexOf(delimiter);
		if (basic < 0) {
			basic = 0;
		}

		for (j = 0; j < basic; ++j) {
			// if it's not a basic code point
			if (input.charCodeAt(j) >= 0x80) {
				error('not-basic');
			}
			output.push(input.charCodeAt(j));
		}

		// Main decoding loop: start just after the last delimiter if any basic code
		// points were copied; start at the beginning otherwise.

		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

			// `index` is the index of the next character to be consumed.
			// Decode a generalized variable-length integer into `delta`,
			// which gets added to `i`. The overflow checking is easier
			// if we increase `i` as we go, then subtract off its starting
			// value at the end to obtain `delta`.
			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

				if (index >= inputLength) {
					error('invalid-input');
				}

				digit = basicToDigit(input.charCodeAt(index++));

				if (digit >= base || digit > floor((maxInt - i) / w)) {
					error('overflow');
				}

				i += digit * w;
				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

				if (digit < t) {
					break;
				}

				baseMinusT = base - t;
				if (w > floor(maxInt / baseMinusT)) {
					error('overflow');
				}

				w *= baseMinusT;

			}

			out = output.length + 1;
			bias = adapt(i - oldi, out, oldi == 0);

			// `i` was supposed to wrap around from `out` to `0`,
			// incrementing `n` each time, so we'll fix that now:
			if (floor(i / out) > maxInt - n) {
				error('overflow');
			}

			n += floor(i / out);
			i %= out;

			// Insert `n` at position `i` of the output
			output.splice(i++, 0, n);

		}

		return ucs2encode(output);
	}

	/**
	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
	 * Punycode string of ASCII-only symbols.
	 * @memberOf punycode
	 * @param {String} input The string of Unicode symbols.
	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
	 */
	function encode(input) {
		var n,
		    delta,
		    handledCPCount,
		    basicLength,
		    bias,
		    j,
		    m,
		    q,
		    k,
		    t,
		    currentValue,
		    output = [],
		    /** `inputLength` will hold the number of code points in `input`. */
		    inputLength,
		    /** Cached calculation results */
		    handledCPCountPlusOne,
		    baseMinusT,
		    qMinusT;

		// Convert the input in UCS-2 to Unicode
		input = ucs2decode(input);

		// Cache the length
		inputLength = input.length;

		// Initialize the state
		n = initialN;
		delta = 0;
		bias = initialBias;

		// Handle the basic code points
		for (j = 0; j < inputLength; ++j) {
			currentValue = input[j];
			if (currentValue < 0x80) {
				output.push(stringFromCharCode(currentValue));
			}
		}

		handledCPCount = basicLength = output.length;

		// `handledCPCount` is the number of code points that have been handled;
		// `basicLength` is the number of basic code points.

		// Finish the basic string - if it is not empty - with a delimiter
		if (basicLength) {
			output.push(delimiter);
		}

		// Main encoding loop:
		while (handledCPCount < inputLength) {

			// All non-basic code points < n have been handled already. Find the next
			// larger one:
			for (m = maxInt, j = 0; j < inputLength; ++j) {
				currentValue = input[j];
				if (currentValue >= n && currentValue < m) {
					m = currentValue;
				}
			}

			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
			// but guard against overflow
			handledCPCountPlusOne = handledCPCount + 1;
			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
				error('overflow');
			}

			delta += (m - n) * handledCPCountPlusOne;
			n = m;

			for (j = 0; j < inputLength; ++j) {
				currentValue = input[j];

				if (currentValue < n && ++delta > maxInt) {
					error('overflow');
				}

				if (currentValue == n) {
					// Represent delta as a generalized variable-length integer
					for (q = delta, k = base; /* no condition */; k += base) {
						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
						if (q < t) {
							break;
						}
						qMinusT = q - t;
						baseMinusT = base - t;
						output.push(
							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
						);
						q = floor(qMinusT / baseMinusT);
					}

					output.push(stringFromCharCode(digitToBasic(q, 0)));
					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
					delta = 0;
					++handledCPCount;
				}
			}

			++delta;
			++n;

		}
		return output.join('');
	}

	/**
	 * Converts a Punycode string representing a domain name or an email address
	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
	 * it doesn't matter if you call it on a string that has already been
	 * converted to Unicode.
	 * @memberOf punycode
	 * @param {String} input The Punycoded domain name or email address to
	 * convert to Unicode.
	 * @returns {String} The Unicode representation of the given Punycode
	 * string.
	 */
	function toUnicode(input) {
		return mapDomain(input, function(string) {
			return regexPunycode.test(string)
				? decode(string.slice(4).toLowerCase())
				: string;
		});
	}

	/**
	 * Converts a Unicode string representing a domain name or an email address to
	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
	 * i.e. it doesn't matter if you call it with a domain that's already in
	 * ASCII.
	 * @memberOf punycode
	 * @param {String} input The domain name or email address to convert, as a
	 * Unicode string.
	 * @returns {String} The Punycode representation of the given domain name or
	 * email address.
	 */
	function toASCII(input) {
		return mapDomain(input, function(string) {
			return regexNonASCII.test(string)
				? 'xn--' + encode(string)
				: string;
		});
	}

	/*--------------------------------------------------------------------------*/

	/** Define the public API */
	punycode = {
		/**
		 * A string representing the current Punycode.js version number.
		 * @memberOf punycode
		 * @type String
		 */
		'version': '1.3.2',
		/**
		 * An object of methods to convert from JavaScript's internal character
		 * representation (UCS-2) to Unicode code points, and back.
		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
		 * @memberOf punycode
		 * @type Object
		 */
		'ucs2': {
			'decode': ucs2decode,
			'encode': ucs2encode
		},
		'decode': decode,
		'encode': encode,
		'toASCII': toASCII,
		'toUnicode': toUnicode
	};

	/** Expose `punycode` */
	// Some AMD build optimizers, like r.js, check for specific condition patterns
	// like the following:
	if (
		typeof define == 'function' &&
		typeof define.amd == 'object' &&
		define.amd
	) {
		define('punycode', function() {
			return punycode;
		});
	} else if (freeExports && freeModule) {
		if (module.exports == freeExports) { // in Node.js or RingoJS v0.8.0+
			freeModule.exports = punycode;
		} else { // in Narwhal or RingoJS v0.7.0-
			for (key in punycode) {
				punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
			}
		}
	} else { // in Rhino or a web browser
		root.punycode = punycode;
	}

}(this));

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],3:[function(require,module,exports){
/*
 * quantize.js Copyright 2008 Nick Rabinowitz
 * Ported to node.js by Olivier Lesnicki
 * Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 */

// fill out a couple protovis dependencies
/*
 * Block below copied from Protovis: http://mbostock.github.com/protovis/
 * Copyright 2010 Stanford Visualization Group
 * Licensed under the BSD License: http://www.opensource.org/licenses/bsd-license.php
 */
if (!pv) {
    var pv = {
        map: function(array, f) {
            var o = {};
            return f ? array.map(function(d, i) {
                o.index = i;
                return f.call(o, d);
            }) : array.slice();
        },
        naturalOrder: function(a, b) {
            return (a < b) ? -1 : ((a > b) ? 1 : 0);
        },
        sum: function(array, f) {
            var o = {};
            return array.reduce(f ? function(p, d, i) {
                o.index = i;
                return p + f.call(o, d);
            } : function(p, d) {
                return p + d;
            }, 0);
        },
        max: function(array, f) {
            return Math.max.apply(null, f ? pv.map(array, f) : array);
        }
    }
}

/**
 * Basic Javascript port of the MMCQ (modified median cut quantization)
 * algorithm from the Leptonica library (http://www.leptonica.com/).
 * Returns a color map you can use to map original pixels to the reduced
 * palette. Still a work in progress.
 * 
 * @author Nick Rabinowitz
 * @example
 
// array of pixels as [R,G,B] arrays
var myPixels = [[190,197,190], [202,204,200], [207,214,210], [211,214,211], [205,207,207]
                // etc
                ];
var maxColors = 4;
 
var cmap = MMCQ.quantize(myPixels, maxColors);
var newPalette = cmap.palette();
var newPixels = myPixels.map(function(p) { 
    return cmap.map(p); 
});
 
 */
var MMCQ = (function() {
    // private constants
    var sigbits = 5,
        rshift = 8 - sigbits,
        maxIterations = 1000,
        fractByPopulations = 0.75;

    // get reduced-space color index for a pixel

    function getColorIndex(r, g, b) {
        return (r << (2 * sigbits)) + (g << sigbits) + b;
    }

    // Simple priority queue

    function PQueue(comparator) {
        var contents = [],
            sorted = false;

        function sort() {
            contents.sort(comparator);
            sorted = true;
        }

        return {
            push: function(o) {
                contents.push(o);
                sorted = false;
            },
            peek: function(index) {
                if (!sorted) sort();
                if (index === undefined) index = contents.length - 1;
                return contents[index];
            },
            pop: function() {
                if (!sorted) sort();
                return contents.pop();
            },
            size: function() {
                return contents.length;
            },
            map: function(f) {
                return contents.map(f);
            },
            debug: function() {
                if (!sorted) sort();
                return contents;
            }
        };
    }

    // 3d color space box

    function VBox(r1, r2, g1, g2, b1, b2, histo) {
        var vbox = this;
        vbox.r1 = r1;
        vbox.r2 = r2;
        vbox.g1 = g1;
        vbox.g2 = g2;
        vbox.b1 = b1;
        vbox.b2 = b2;
        vbox.histo = histo;
    }
    VBox.prototype = {
        volume: function(force) {
            var vbox = this;
            if (!vbox._volume || force) {
                vbox._volume = ((vbox.r2 - vbox.r1 + 1) * (vbox.g2 - vbox.g1 + 1) * (vbox.b2 - vbox.b1 + 1));
            }
            return vbox._volume;
        },
        count: function(force) {
            var vbox = this,
                histo = vbox.histo;
            if (!vbox._count_set || force) {
                var npix = 0,
                    i, j, k;
                for (i = vbox.r1; i <= vbox.r2; i++) {
                    for (j = vbox.g1; j <= vbox.g2; j++) {
                        for (k = vbox.b1; k <= vbox.b2; k++) {
                            index = getColorIndex(i, j, k);
                            npix += (histo[index] || 0);
                        }
                    }
                }
                vbox._count = npix;
                vbox._count_set = true;
            }
            return vbox._count;
        },
        copy: function() {
            var vbox = this;
            return new VBox(vbox.r1, vbox.r2, vbox.g1, vbox.g2, vbox.b1, vbox.b2, vbox.histo);
        },
        avg: function(force) {
            var vbox = this,
                histo = vbox.histo;
            if (!vbox._avg || force) {
                var ntot = 0,
                    mult = 1 << (8 - sigbits),
                    rsum = 0,
                    gsum = 0,
                    bsum = 0,
                    hval,
                    i, j, k, histoindex;
                for (i = vbox.r1; i <= vbox.r2; i++) {
                    for (j = vbox.g1; j <= vbox.g2; j++) {
                        for (k = vbox.b1; k <= vbox.b2; k++) {
                            histoindex = getColorIndex(i, j, k);
                            hval = histo[histoindex] || 0;
                            ntot += hval;
                            rsum += (hval * (i + 0.5) * mult);
                            gsum += (hval * (j + 0.5) * mult);
                            bsum += (hval * (k + 0.5) * mult);
                        }
                    }
                }
                if (ntot) {
                    vbox._avg = [~~(rsum / ntot), ~~ (gsum / ntot), ~~ (bsum / ntot)];
                } else {
                    //console.log('empty box');
                    vbox._avg = [~~(mult * (vbox.r1 + vbox.r2 + 1) / 2), ~~ (mult * (vbox.g1 + vbox.g2 + 1) / 2), ~~ (mult * (vbox.b1 + vbox.b2 + 1) / 2)];
                }
            }
            return vbox._avg;
        },
        contains: function(pixel) {
            var vbox = this,
                rval = pixel[0] >> rshift;
            gval = pixel[1] >> rshift;
            bval = pixel[2] >> rshift;
            return (rval >= vbox.r1 && rval <= vbox.r2 &&
                gval >= vbox.g1 && gval <= vbox.g2 &&
                bval >= vbox.b1 && bval <= vbox.b2);
        }
    };

    // Color map

    function CMap() {
        this.vboxes = new PQueue(function(a, b) {
            return pv.naturalOrder(
                a.vbox.count() * a.vbox.volume(),
                b.vbox.count() * b.vbox.volume()
            )
        });;
    }
    CMap.prototype = {
        push: function(vbox) {
            this.vboxes.push({
                vbox: vbox,
                color: vbox.avg()
            });
        },
        palette: function() {
            return this.vboxes.map(function(vb) {
                return vb.color
            });
        },
        size: function() {
            return this.vboxes.size();
        },
        map: function(color) {
            var vboxes = this.vboxes;
            for (var i = 0; i < vboxes.size(); i++) {
                if (vboxes.peek(i).vbox.contains(color)) {
                    return vboxes.peek(i).color;
                }
            }
            return this.nearest(color);
        },
        nearest: function(color) {
            var vboxes = this.vboxes,
                d1, d2, pColor;
            for (var i = 0; i < vboxes.size(); i++) {
                d2 = Math.sqrt(
                    Math.pow(color[0] - vboxes.peek(i).color[0], 2) +
                    Math.pow(color[1] - vboxes.peek(i).color[1], 2) +
                    Math.pow(color[2] - vboxes.peek(i).color[2], 2)
                );
                if (d2 < d1 || d1 === undefined) {
                    d1 = d2;
                    pColor = vboxes.peek(i).color;
                }
            }
            return pColor;
        },
        forcebw: function() {
            // XXX: won't  work yet
            var vboxes = this.vboxes;
            vboxes.sort(function(a, b) {
                return pv.naturalOrder(pv.sum(a.color), pv.sum(b.color))
            });

            // force darkest color to black if everything < 5
            var lowest = vboxes[0].color;
            if (lowest[0] < 5 && lowest[1] < 5 && lowest[2] < 5)
                vboxes[0].color = [0, 0, 0];

            // force lightest color to white if everything > 251
            var idx = vboxes.length - 1,
                highest = vboxes[idx].color;
            if (highest[0] > 251 && highest[1] > 251 && highest[2] > 251)
                vboxes[idx].color = [255, 255, 255];
        }
    };

    // histo (1-d array, giving the number of pixels in
    // each quantized region of color space), or null on error

    function getHisto(pixels) {
        var histosize = 1 << (3 * sigbits),
            histo = new Array(histosize),
            index, rval, gval, bval;
        pixels.forEach(function(pixel) {
            rval = pixel[0] >> rshift;
            gval = pixel[1] >> rshift;
            bval = pixel[2] >> rshift;
            index = getColorIndex(rval, gval, bval);
            histo[index] = (histo[index] || 0) + 1;
        });
        return histo;
    }

    function vboxFromPixels(pixels, histo) {
        var rmin = 1000000,
            rmax = 0,
            gmin = 1000000,
            gmax = 0,
            bmin = 1000000,
            bmax = 0,
            rval, gval, bval;
        // find min/max
        pixels.forEach(function(pixel) {
            rval = pixel[0] >> rshift;
            gval = pixel[1] >> rshift;
            bval = pixel[2] >> rshift;
            if (rval < rmin) rmin = rval;
            else if (rval > rmax) rmax = rval;
            if (gval < gmin) gmin = gval;
            else if (gval > gmax) gmax = gval;
            if (bval < bmin) bmin = bval;
            else if (bval > bmax) bmax = bval;
        });
        return new VBox(rmin, rmax, gmin, gmax, bmin, bmax, histo);
    }

    function medianCutApply(histo, vbox) {
        if (!vbox.count()) return;

        var rw = vbox.r2 - vbox.r1 + 1,
            gw = vbox.g2 - vbox.g1 + 1,
            bw = vbox.b2 - vbox.b1 + 1,
            maxw = pv.max([rw, gw, bw]);
        // only one pixel, no split
        if (vbox.count() == 1) {
            return [vbox.copy()]
        }
        /* Find the partial sum arrays along the selected axis. */
        var total = 0,
            partialsum = [],
            lookaheadsum = [],
            i, j, k, sum, index;
        if (maxw == rw) {
            for (i = vbox.r1; i <= vbox.r2; i++) {
                sum = 0;
                for (j = vbox.g1; j <= vbox.g2; j++) {
                    for (k = vbox.b1; k <= vbox.b2; k++) {
                        index = getColorIndex(i, j, k);
                        sum += (histo[index] || 0);
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        } else if (maxw == gw) {
            for (i = vbox.g1; i <= vbox.g2; i++) {
                sum = 0;
                for (j = vbox.r1; j <= vbox.r2; j++) {
                    for (k = vbox.b1; k <= vbox.b2; k++) {
                        index = getColorIndex(j, i, k);
                        sum += (histo[index] || 0);
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        } else { /* maxw == bw */
            for (i = vbox.b1; i <= vbox.b2; i++) {
                sum = 0;
                for (j = vbox.r1; j <= vbox.r2; j++) {
                    for (k = vbox.g1; k <= vbox.g2; k++) {
                        index = getColorIndex(j, k, i);
                        sum += (histo[index] || 0);
                    }
                }
                total += sum;
                partialsum[i] = total;
            }
        }
        partialsum.forEach(function(d, i) {
            lookaheadsum[i] = total - d
        });

        function doCut(color) {
            var dim1 = color + '1',
                dim2 = color + '2',
                left, right, vbox1, vbox2, d2, count2 = 0;
            for (i = vbox[dim1]; i <= vbox[dim2]; i++) {
                if (partialsum[i] > total / 2) {
                    vbox1 = vbox.copy();
                    vbox2 = vbox.copy();
                    left = i - vbox[dim1];
                    right = vbox[dim2] - i;
                    if (left <= right)
                        d2 = Math.min(vbox[dim2] - 1, ~~ (i + right / 2));
                    else d2 = Math.max(vbox[dim1], ~~ (i - 1 - left / 2));
                    // avoid 0-count boxes
                    while (!partialsum[d2]) d2++;
                    count2 = lookaheadsum[d2];
                    while (!count2 && partialsum[d2 - 1]) count2 = lookaheadsum[--d2];
                    // set dimensions
                    vbox1[dim2] = d2;
                    vbox2[dim1] = vbox1[dim2] + 1;
                    // console.log('vbox counts:', vbox.count(), vbox1.count(), vbox2.count());
                    return [vbox1, vbox2];
                }
            }

        }
        // determine the cut planes
        return maxw == rw ? doCut('r') :
            maxw == gw ? doCut('g') :
            doCut('b');
    }

    function quantize(pixels, maxcolors) {
        // short-circuit
        if (!pixels.length || maxcolors < 2 || maxcolors > 256) {
            // console.log('wrong number of maxcolors');
            return false;
        }

        // XXX: check color content and convert to grayscale if insufficient

        var histo = getHisto(pixels),
            histosize = 1 << (3 * sigbits);

        // check that we aren't below maxcolors already
        var nColors = 0;
        histo.forEach(function() {
            nColors++
        });
        if (nColors <= maxcolors) {
            // XXX: generate the new colors from the histo and return
        }

        // get the beginning vbox from the colors
        var vbox = vboxFromPixels(pixels, histo),
            pq = new PQueue(function(a, b) {
                return pv.naturalOrder(a.count(), b.count())
            });
        pq.push(vbox);

        // inner function to do the iteration

        function iter(lh, target) {
            var ncolors = 1,
                niters = 0,
                vbox;
            while (niters < maxIterations) {
                vbox = lh.pop();
                if (!vbox.count()) { /* just put it back */
                    lh.push(vbox);
                    niters++;
                    continue;
                }
                // do the cut
                var vboxes = medianCutApply(histo, vbox),
                    vbox1 = vboxes[0],
                    vbox2 = vboxes[1];

                if (!vbox1) {
                    // console.log("vbox1 not defined; shouldn't happen!");
                    return;
                }
                lh.push(vbox1);
                if (vbox2) { /* vbox2 can be null */
                    lh.push(vbox2);
                    ncolors++;
                }
                if (ncolors >= target) return;
                if (niters++ > maxIterations) {
                    // console.log("infinite loop; perhaps too few pixels!");
                    return;
                }
            }
        }

        // first set of colors, sorted by population
        iter(pq, fractByPopulations * maxcolors);
        // console.log(pq.size(), pq.debug().length, pq.debug().slice());

        // Re-sort by the product of pixel occupancy times the size in color space.
        var pq2 = new PQueue(function(a, b) {
            return pv.naturalOrder(a.count() * a.volume(), b.count() * b.volume())
        });
        while (pq.size()) {
            pq2.push(pq.pop());
        }

        // next set - generate the median cuts using the (npix * vol) sorting.
        iter(pq2, maxcolors - pq2.size());

        // calculate the actual colors
        var cmap = new CMap();
        while (pq2.size()) {
            cmap.push(pq2.pop());
        }

        return cmap;
    }

    return {
        quantize: quantize
    }
})();

module.exports = MMCQ.quantize

},{}],4:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

module.exports = function(qs, sep, eq, options) {
  sep = sep || '&';
  eq = eq || '=';
  var obj = {};

  if (typeof qs !== 'string' || qs.length === 0) {
    return obj;
  }

  var regexp = /\+/g;
  qs = qs.split(sep);

  var maxKeys = 1000;
  if (options && typeof options.maxKeys === 'number') {
    maxKeys = options.maxKeys;
  }

  var len = qs.length;
  // maxKeys <= 0 means that we should not limit keys count
  if (maxKeys > 0 && len > maxKeys) {
    len = maxKeys;
  }

  for (var i = 0; i < len; ++i) {
    var x = qs[i].replace(regexp, '%20'),
        idx = x.indexOf(eq),
        kstr, vstr, k, v;

    if (idx >= 0) {
      kstr = x.substr(0, idx);
      vstr = x.substr(idx + 1);
    } else {
      kstr = x;
      vstr = '';
    }

    k = decodeURIComponent(kstr);
    v = decodeURIComponent(vstr);

    if (!hasOwnProperty(obj, k)) {
      obj[k] = v;
    } else if (isArray(obj[k])) {
      obj[k].push(v);
    } else {
      obj[k] = [obj[k], v];
    }
  }

  return obj;
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

},{}],5:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

'use strict';

var stringifyPrimitive = function(v) {
  switch (typeof v) {
    case 'string':
      return v;

    case 'boolean':
      return v ? 'true' : 'false';

    case 'number':
      return isFinite(v) ? v : '';

    default:
      return '';
  }
};

module.exports = function(obj, sep, eq, name) {
  sep = sep || '&';
  eq = eq || '=';
  if (obj === null) {
    obj = undefined;
  }

  if (typeof obj === 'object') {
    return map(objectKeys(obj), function(k) {
      var ks = encodeURIComponent(stringifyPrimitive(k)) + eq;
      if (isArray(obj[k])) {
        return map(obj[k], function(v) {
          return ks + encodeURIComponent(stringifyPrimitive(v));
        }).join(sep);
      } else {
        return ks + encodeURIComponent(stringifyPrimitive(obj[k]));
      }
    }).join(sep);

  }

  if (!name) return '';
  return encodeURIComponent(stringifyPrimitive(name)) + eq +
         encodeURIComponent(stringifyPrimitive(obj));
};

var isArray = Array.isArray || function (xs) {
  return Object.prototype.toString.call(xs) === '[object Array]';
};

function map (xs, f) {
  if (xs.map) return xs.map(f);
  var res = [];
  for (var i = 0; i < xs.length; i++) {
    res.push(f(xs[i], i));
  }
  return res;
}

var objectKeys = Object.keys || function (obj) {
  var res = [];
  for (var key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) res.push(key);
  }
  return res;
};

},{}],6:[function(require,module,exports){
'use strict';

exports.decode = exports.parse = require('./decode');
exports.encode = exports.stringify = require('./encode');

},{"./decode":4,"./encode":5}],7:[function(require,module,exports){
var Vibrant;

Vibrant = require('./vibrant');

Vibrant.DefaultOpts.Image = require('./image/browser');

module.exports = Vibrant;


},{"./image/browser":13,"./vibrant":22}],8:[function(require,module,exports){
var Vibrant;

window.Vibrant = Vibrant = require('./browser');


},{"./browser":7}],9:[function(require,module,exports){
module.exports = function(r, g, b, a) {
  return a >= 125 && !(r > 250 && g > 250 && b > 250);
};


},{}],10:[function(require,module,exports){
module.exports.Default = require('./default');


},{"./default":9}],11:[function(require,module,exports){
var DefaultGenerator, DefaultOpts, Generator, Swatch, util,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  slice = [].slice;

Swatch = require('../swatch');

util = require('../util');

Generator = require('./index');

DefaultOpts = {
  targetDarkLuma: 0.26,
  maxDarkLuma: 0.45,
  minLightLuma: 0.55,
  targetLightLuma: 0.74,
  minNormalLuma: 0.3,
  targetNormalLuma: 0.5,
  maxNormalLuma: 0.7,
  targetMutesSaturation: 0.3,
  maxMutesSaturation: 0.4,
  targetVibrantSaturation: 1.0,
  minVibrantSaturation: 0.35,
  weightSaturation: 3,
  weightLuma: 6,
  weightPopulation: 1
};

module.exports = DefaultGenerator = (function(superClass) {
  extend(DefaultGenerator, superClass);

  DefaultGenerator.prototype.HighestPopulation = 0;

  function DefaultGenerator(opts) {
    this.opts = util.defaults(opts, DefaultOpts);
    this.VibrantSwatch = null;
    this.LightVibrantSwatch = null;
    this.DarkVibrantSwatch = null;
    this.MutedSwatch = null;
    this.LightMutedSwatch = null;
    this.DarkMutedSwatch = null;
  }

  DefaultGenerator.prototype.generate = function(swatches) {
    this.swatches = swatches;
    this.maxPopulation = this.findMaxPopulation;
    this.generateVarationColors();
    return this.generateEmptySwatches();
  };

  DefaultGenerator.prototype.getVibrantSwatch = function() {
    return this.VibrantSwatch;
  };

  DefaultGenerator.prototype.getLightVibrantSwatch = function() {
    return this.LightVibrantSwatch;
  };

  DefaultGenerator.prototype.getDarkVibrantSwatch = function() {
    return this.DarkVibrantSwatch;
  };

  DefaultGenerator.prototype.getMutedSwatch = function() {
    return this.MutedSwatch;
  };

  DefaultGenerator.prototype.getLightMutedSwatch = function() {
    return this.LightMutedSwatch;
  };

  DefaultGenerator.prototype.getDarkMutedSwatch = function() {
    return this.DarkMutedSwatch;
  };

  DefaultGenerator.prototype.generateVarationColors = function() {
    this.VibrantSwatch = this.findColorVariation(this.opts.targetNormalLuma, this.opts.minNormalLuma, this.opts.maxNormalLuma, this.opts.targetVibrantSaturation, this.opts.minVibrantSaturation, 1);
    this.LightVibrantSwatch = this.findColorVariation(this.opts.targetLightLuma, this.opts.minLightLuma, 1, this.opts.targetVibrantSaturation, this.opts.minVibrantSaturation, 1);
    this.DarkVibrantSwatch = this.findColorVariation(this.opts.targetDarkLuma, 0, this.opts.maxDarkLuma, this.opts.targetVibrantSaturation, this.opts.minVibrantSaturation, 1);
    this.MutedSwatch = this.findColorVariation(this.opts.targetNormalLuma, this.opts.minNormalLuma, this.opts.maxNormalLuma, this.opts.targetMutesSaturation, 0, this.opts.maxMutesSaturation);
    this.LightMutedSwatch = this.findColorVariation(this.opts.targetLightLuma, this.opts.minLightLuma, 1, this.opts.targetMutesSaturation, 0, this.opts.maxMutesSaturation);
    return this.DarkMutedSwatch = this.findColorVariation(this.opts.targetDarkLuma, 0, this.opts.maxDarkLuma, this.opts.targetMutesSaturation, 0, this.opts.maxMutesSaturation);
  };

  DefaultGenerator.prototype.generateEmptySwatches = function() {
    var hsl;
    if (this.VibrantSwatch === null) {
      if (this.DarkVibrantSwatch !== null) {
        hsl = this.DarkVibrantSwatch.getHsl();
        hsl[2] = this.opts.targetNormalLuma;
        this.VibrantSwatch = new Swatch(util.hslToRgb(hsl[0], hsl[1], hsl[2]), 0);
      }
    }
    if (this.DarkVibrantSwatch === null) {
      if (this.VibrantSwatch !== null) {
        hsl = this.VibrantSwatch.getHsl();
        hsl[2] = this.opts.targetDarkLuma;
        return this.DarkVibrantSwatch = new Swatch(util.hslToRgb(hsl[0], hsl[1], hsl[2]), 0);
      }
    }
  };

  DefaultGenerator.prototype.findMaxPopulation = function() {
    var j, len, population, ref, swatch;
    population = 0;
    ref = this.swatches;
    for (j = 0, len = ref.length; j < len; j++) {
      swatch = ref[j];
      population = Math.max(population, swatch.getPopulation());
    }
    return population;
  };

  DefaultGenerator.prototype.findColorVariation = function(targetLuma, minLuma, maxLuma, targetSaturation, minSaturation, maxSaturation) {
    var j, len, luma, max, maxValue, ref, sat, swatch, value;
    max = null;
    maxValue = 0;
    ref = this.swatches;
    for (j = 0, len = ref.length; j < len; j++) {
      swatch = ref[j];
      sat = swatch.getHsl()[1];
      luma = swatch.getHsl()[2];
      if (sat >= minSaturation && sat <= maxSaturation && luma >= minLuma && luma <= maxLuma && !this.isAlreadySelected(swatch)) {
        value = this.createComparisonValue(sat, targetSaturation, luma, targetLuma, swatch.getPopulation(), this.HighestPopulation);
        if (max === null || value > maxValue) {
          max = swatch;
          maxValue = value;
        }
      }
    }
    return max;
  };

  DefaultGenerator.prototype.createComparisonValue = function(saturation, targetSaturation, luma, targetLuma, population, maxPopulation) {
    return this.weightedMean(this.invertDiff(saturation, targetSaturation), this.opts.weightSaturation, this.invertDiff(luma, targetLuma), this.opts.weightLuma, population / maxPopulation, this.opts.weightPopulation);
  };

  DefaultGenerator.prototype.invertDiff = function(value, targetValue) {
    return 1 - Math.abs(value - targetValue);
  };

  DefaultGenerator.prototype.weightedMean = function() {
    var i, sum, sumWeight, value, values, weight;
    values = 1 <= arguments.length ? slice.call(arguments, 0) : [];
    sum = 0;
    sumWeight = 0;
    i = 0;
    while (i < values.length) {
      value = values[i];
      weight = values[i + 1];
      sum += value * weight;
      sumWeight += weight;
      i += 2;
    }
    return sum / sumWeight;
  };

  DefaultGenerator.prototype.isAlreadySelected = function(swatch) {
    return this.VibrantSwatch === swatch || this.DarkVibrantSwatch === swatch || this.LightVibrantSwatch === swatch || this.MutedSwatch === swatch || this.DarkMutedSwatch === swatch || this.LightMutedSwatch === swatch;
  };

  return DefaultGenerator;

})(Generator);


},{"../swatch":20,"../util":21,"./index":12}],12:[function(require,module,exports){
var Generator;

module.exports = Generator = (function() {
  function Generator() {}

  Generator.prototype.generate = function(swatches) {};

  Generator.prototype.getVibrantSwatch = function() {};

  Generator.prototype.getLightVibrantSwatch = function() {};

  Generator.prototype.getDarkVibrantSwatch = function() {};

  Generator.prototype.getMutedSwatch = function() {};

  Generator.prototype.getLightMutedSwatch = function() {};

  Generator.prototype.getDarkMutedSwatch = function() {};

  return Generator;

})();

module.exports.Default = require('./default');


},{"./default":11}],13:[function(require,module,exports){
var BrowserImage, Image, Url, isRelativeUrl, isSameOrigin,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Image = require('./index');

Url = require('url');

isRelativeUrl = function(url) {
  var u;
  u = Url.parse(url);
  return u.protocol === null && u.host === null && u.port === null;
};

isSameOrigin = function(a, b) {
  var ua, ub;
  ua = Url.parse(a);
  ub = Url.parse(b);
  return ua.protocol === ub.protocol && ua.hostname === ub.hostname && ua.port === ub.port;
};

module.exports = BrowserImage = (function(superClass) {
  extend(BrowserImage, superClass);

  function BrowserImage(path, cb) {
    if (typeof path === 'object' && path instanceof HTMLImageElement) {
      this.img = path;
      if (!isRelativeUrl(path) && !isSameOrigin(window.location.href, path)) {
        this.img.crossOrigin = 'anonymous';
      }
      path = this.img.src;
    } else {
      this.img = document.createElement('img');
      if (!isRelativeUrl(path) && !isSameOrigin(window.location.href, path)) {
        this.img.crossOrigin = 'anonymous';
      }
      this.img.src = path;
    }
    this.img.onload = (function(_this) {
      return function() {
        _this._initCanvas();
        return typeof cb === "function" ? cb(null, _this) : void 0;
      };
    })(this);
    if (this.img.complete) {
      this.img.onload();
    }
    this.img.onerror = (function(_this) {
      return function(e) {
        var err;
        err = new Error("Fail to load image: " + path);
        err.raw = e;
        return typeof cb === "function" ? cb(err) : void 0;
      };
    })(this);
  }

  BrowserImage.prototype._initCanvas = function() {
    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    this.width = this.canvas.width = this.img.width;
    this.height = this.canvas.height = this.img.height;
    return this.context.drawImage(this.img, 0, 0, this.width, this.height);
  };

  BrowserImage.prototype.clear = function() {
    return this.context.clearRect(0, 0, this.width, this.height);
  };

  BrowserImage.prototype.getWidth = function() {
    return this.width;
  };

  BrowserImage.prototype.getHeight = function() {
    return this.height;
  };

  BrowserImage.prototype.resize = function(w, h, r) {
    this.width = this.canvas.width = w;
    this.height = this.canvas.height = h;
    this.context.scale(r, r);
    return this.context.drawImage(this.img, 0, 0);
  };

  BrowserImage.prototype.update = function(imageData) {
    return this.context.putImageData(imageData, 0, 0);
  };

  BrowserImage.prototype.getPixelCount = function() {
    return this.width * this.height;
  };

  BrowserImage.prototype.getImageData = function() {
    return this.context.getImageData(0, 0, this.width, this.height);
  };

  BrowserImage.prototype.removeCanvas = function() {
    return this.canvas.parentNode.removeChild(this.canvas);
  };

  return BrowserImage;

})(Image);


},{"./index":14,"url":1}],14:[function(require,module,exports){
var Image;

module.exports = Image = (function() {
  function Image() {}

  Image.prototype.clear = function() {};

  Image.prototype.update = function(imageData) {};

  Image.prototype.getWidth = function() {};

  Image.prototype.getHeight = function() {};

  Image.prototype.scaleDown = function(opts) {
    var height, maxSide, ratio, width;
    width = this.getWidth();
    height = this.getHeight();
    ratio = 1;
    if (opts.maxDimension != null) {
      maxSide = Math.max(width, height);
      if (maxSide > opts.maxDimension) {
        ratio = opts.maxDimension / maxSide;
      }
    } else {
      ratio = 1 / opts.quality;
    }
    if (ratio < 1) {
      return this.resize(width * ratio, height * ratio, ratio);
    }
  };

  Image.prototype.resize = function(w, h, r) {};

  Image.prototype.getPixelCount = function() {};

  Image.prototype.getImageData = function() {};

  Image.prototype.removeCanvas = function() {};

  return Image;

})();


},{}],15:[function(require,module,exports){
var MMCQ, PQueue, RSHIFT, SIGBITS, Swatch, VBox, getColorIndex, ref, util;

ref = util = require('../../util'), getColorIndex = ref.getColorIndex, SIGBITS = ref.SIGBITS, RSHIFT = ref.RSHIFT;

Swatch = require('../../swatch');

VBox = require('./vbox');

PQueue = require('./pqueue');

module.exports = MMCQ = (function() {
  MMCQ.DefaultOpts = {
    maxIterations: 1000,
    fractByPopulations: 0.75
  };

  function MMCQ(opts) {
    this.opts = util.defaults(opts, this.constructor.DefaultOpts);
  }

  MMCQ.prototype.quantize = function(pixels, opts) {
    var color, colorCount, hist, pq, pq2, shouldIgnore, swatches, v, vbox;
    if (pixels.length === 0 || opts.colorCount < 2 || opts.colorCount > 256) {
      throw new Error("Wrong MMCQ parameters");
    }
    shouldIgnore = function() {
      return false;
    };
    if (Array.isArray(opts.filters) && opts.filters.length > 0) {
      shouldIgnore = function(r, g, b, a) {
        var f, i, len, ref1;
        ref1 = opts.filters;
        for (i = 0, len = ref1.length; i < len; i++) {
          f = ref1[i];
          if (!f(r, g, b, a)) {
            return true;
          }
        }
        return false;
      };
    }
    vbox = VBox.build(pixels, shouldIgnore);
    hist = vbox.hist;
    colorCount = Object.keys(hist).length;
    pq = new PQueue(function(a, b) {
      return a.count() - b.count();
    });
    pq.push(vbox);
    this._splitBoxes(pq, this.opts.fractByPopulations * opts.colorCount);
    pq2 = new PQueue(function(a, b) {
      return a.count() * a.volume() - b.count() * b.volume();
    });
    pq2.contents = pq.contents;
    this._splitBoxes(pq2, opts.colorCount - pq2.size());
    swatches = [];
    this.vboxes = [];
    while (pq2.size()) {
      v = pq2.pop();
      color = v.avg();
      if (!(typeof shouldIgnore === "function" ? shouldIgnore(color[0], color[1], color[2], 255) : void 0)) {
        this.vboxes.push(v);
        swatches.push(new Swatch(color, v.count()));
      }
    }
    return swatches;
  };

  MMCQ.prototype._splitBoxes = function(pq, target) {
    var colorCount, iteration, maxIterations, ref1, vbox, vbox1, vbox2;
    colorCount = 1;
    iteration = 0;
    maxIterations = this.opts.maxIterations;
    while (iteration < maxIterations) {
      iteration++;
      vbox = pq.pop();
      if (!vbox.count()) {
        continue;
      }
      ref1 = vbox.split(), vbox1 = ref1[0], vbox2 = ref1[1];
      pq.push(vbox1);
      if (vbox2) {
        pq.push(vbox2);
        colorCount++;
      }
      if (colorCount >= target || iteration > maxIterations) {
        return;
      }
    }
  };

  return MMCQ;

})();


},{"../../swatch":20,"../../util":21,"./pqueue":16,"./vbox":17}],16:[function(require,module,exports){
var PQueue;

module.exports = PQueue = (function() {
  function PQueue(comparator) {
    this.comparator = comparator;
    this.contents = [];
    this.sorted = false;
  }

  PQueue.prototype._sort = function() {
    this.contents.sort(this.comparator);
    return this.sorted = true;
  };

  PQueue.prototype.push = function(o) {
    this.contents.push(o);
    return this.sorted = false;
  };

  PQueue.prototype.peek = function(index) {
    if (!this.sorted) {
      this._sort();
    }
    if (index == null) {
      index = this.contents.length - 1;
    }
    return this.contents[index];
  };

  PQueue.prototype.pop = function() {
    if (!this.sorted) {
      this._sort();
    }
    return this.contents.pop();
  };

  PQueue.prototype.size = function() {
    return this.contents.length;
  };

  PQueue.prototype.map = function(f) {
    if (!this.sorted) {
      this._sort();
    }
    return this.contents.map(f);
  };

  return PQueue;

})();


},{}],17:[function(require,module,exports){
var RSHIFT, SIGBITS, VBox, getColorIndex, ref, util;

ref = util = require('../../util'), getColorIndex = ref.getColorIndex, SIGBITS = ref.SIGBITS, RSHIFT = ref.RSHIFT;

module.exports = VBox = (function() {
  VBox.build = function(pixels, shouldIgnore) {
    var a, b, bmax, bmin, g, gmax, gmin, hist, hn, i, index, n, offset, r, rmax, rmin;
    hn = 1 << (3 * SIGBITS);
    hist = new Uint32Array(hn);
    rmax = gmax = bmax = 0;
    rmin = gmin = bmin = Number.MAX_VALUE;
    n = pixels.length / 4;
    i = 0;
    while (i < n) {
      offset = i * 4;
      i++;
      r = pixels[offset + 0];
      g = pixels[offset + 1];
      b = pixels[offset + 2];
      a = pixels[offset + 3];
      if (shouldIgnore(r, g, b, a)) {
        continue;
      }
      r = r >> RSHIFT;
      g = g >> RSHIFT;
      b = b >> RSHIFT;
      index = getColorIndex(r, g, b);
      hist[index] += 1;
      if (r > rmax) {
        rmax = r;
      }
      if (r < rmin) {
        rmin = r;
      }
      if (g > gmax) {
        gmax = g;
      }
      if (g < gmin) {
        gmin = g;
      }
      if (b > bmax) {
        bmax = b;
      }
      if (b < bmin) {
        bmin = b;
      }
    }
    return new VBox(rmin, rmax, gmin, gmax, bmin, bmax, hist);
  };

  function VBox(r1, r2, g1, g2, b1, b2, hist1) {
    this.r1 = r1;
    this.r2 = r2;
    this.g1 = g1;
    this.g2 = g2;
    this.b1 = b1;
    this.b2 = b2;
    this.hist = hist1;
  }

  VBox.prototype.invalidate = function() {
    delete this._count;
    delete this._avg;
    return delete this._volume;
  };

  VBox.prototype.volume = function() {
    if (this._volume == null) {
      this._volume = (this.r2 - this.r1 + 1) * (this.g2 - this.g1 + 1) * (this.b2 - this.b1 + 1);
    }
    return this._volume;
  };

  VBox.prototype.count = function() {
    var c, hist;
    if (this._count == null) {
      hist = this.hist;
      c = 0;
      
      for (var r = this.r1; r <= this.r2; r++) {
        for (var g = this.g1; g <= this.g2; g++) {
          for (var b = this.b1; b <= this.b2; b++) {
            var index = getColorIndex(r, g, b);
            c += hist[index];
          }
        }
      }
      ;
      this._count = c;
    }
    return this._count;
  };

  VBox.prototype.clone = function() {
    return new VBox(this.r1, this.r2, this.g1, this.g2, this.b1, this.b2, this.hist);
  };

  VBox.prototype.avg = function() {
    var bsum, gsum, hist, mult, ntot, rsum;
    if (this._avg == null) {
      hist = this.hist;
      ntot = 0;
      mult = 1 << (8 - SIGBITS);
      rsum = gsum = bsum = 0;
      
      for (var r = this.r1; r <= this.r2; r++) {
        for (var g = this.g1; g <= this.g2; g++) {
          for (var b = this.b1; b <= this.b2; b++) {
            var index = getColorIndex(r, g, b);
            var h = hist[index];
            ntot += h;
            rsum += (h * (r + 0.5) * mult);
            gsum += (h * (g + 0.5) * mult);
            bsum += (h * (b + 0.5) * mult);
          }
        }
      }
      ;
      if (ntot) {
        this._avg = [~~(rsum / ntot), ~~(gsum / ntot), ~~(bsum / ntot)];
      } else {
        this._avg = [~~(mult * (this.r1 + this.r2 + 1) / 2), ~~(mult * (this.g1 + this.g2 + 1) / 2), ~~(mult * (this.b1 + this.b2 + 1) / 2)];
      }
    }
    return this._avg;
  };

  VBox.prototype.split = function() {
    var accSum, bw, d, doCut, gw, hist, i, j, maxd, maxw, ref1, reverseSum, rw, splitPoint, sum, total, vbox;
    hist = this.hist;
    if (!this.count()) {
      return null;
    }
    if (this.count() === 1) {
      return [this.clone()];
    }
    rw = this.r2 - this.r1 + 1;
    gw = this.g2 - this.g1 + 1;
    bw = this.b2 - this.b1 + 1;
    maxw = Math.max(rw, gw, bw);
    accSum = null;
    sum = total = 0;
    maxd = null;
    switch (maxw) {
      case rw:
        maxd = 'r';
        accSum = new Uint32Array(this.r2 + 1);
        
        for (var r = this.r1; r <= this.r2; r++) {
          sum = 0
          for (var g = this.g1; g <= this.g2; g++) {
            for (var b = this.b1; b <= this.b2; b++) {
              var index = getColorIndex(r, g, b);
              sum += hist[index];
            }
          }
          total += sum;
          accSum[r] = total;
        }
        ;
        break;
      case gw:
        maxd = 'g';
        accSum = new Uint32Array(this.g2 + 1);
        
        for (var g = this.g1; g <= this.g2; g++) {
          sum = 0
          for (var r = this.r1; r <= this.r2; r++) {
            for (var b = this.b1; b <= this.b2; b++) {
              var index = getColorIndex(r, g, b);
              sum += hist[index];
            }
          }
          total += sum;
          accSum[g] = total;
        }
        ;
        break;
      case bw:
        maxd = 'b';
        accSum = new Uint32Array(this.b2 + 1);
        
        for (var b = this.b1; b <= this.b2; b++) {
          sum = 0
          for (var r = this.r1; r <= this.r2; r++) {
            for (var g = this.g1; g <= this.g2; g++) {
              var index = getColorIndex(r, g, b);
              sum += hist[index];
            }
          }
          total += sum;
          accSum[b] = total;
        }
        ;
    }
    splitPoint = -1;
    reverseSum = new Uint32Array(accSum.length);
    for (i = j = 0, ref1 = accSum.length - 1; 0 <= ref1 ? j <= ref1 : j >= ref1; i = 0 <= ref1 ? ++j : --j) {
      d = accSum[i];
      if (splitPoint < 0 && d > total / 2) {
        splitPoint = i;
      }
      reverseSum[i] = total - d;
    }
    vbox = this;
    doCut = function(d) {
      var c2, d1, d2, dim1, dim2, left, right, vbox1, vbox2;
      dim1 = d + "1";
      dim2 = d + "2";
      d1 = vbox[dim1];
      d2 = vbox[dim2];
      vbox1 = vbox.clone();
      vbox2 = vbox.clone();
      left = splitPoint - d1;
      right = d2 - splitPoint;
      if (left <= right) {
        d2 = Math.min(d2 - 1, ~~(splitPoint + right / 2));
        d2 = Math.max(0, d2);
      } else {
        d2 = Math.max(d1, ~~(splitPoint - 1 - left / 2));
        d2 = Math.min(vbox[dim2], d2);
      }
      while (!accSum[d2]) {
        d2++;
      }
      c2 = reverseSum[d2];
      while (!c2 && accSum[d2 - 1]) {
        c2 = reverseSum[--d2];
      }
      vbox1[dim2] = d2;
      vbox2[dim1] = d2 + 1;
      return [vbox1, vbox2];
    };
    return doCut(maxd);
  };

  VBox.prototype.contains = function(p) {
    var b, g, r;
    r = p[0] >> RSHIFT;
    g = p[1] >> RSHIFT;
    b = p[2] >> RSHIFT;
    return r >= this.r1 && r <= this.r2 && g >= this.g1 && g <= this.g2 && b >= this.b1 && b <= this.b2;
  };

  return VBox;

})();


},{"../../util":21}],18:[function(require,module,exports){
var Quantizer;

module.exports = Quantizer = (function() {
  function Quantizer() {}

  Quantizer.prototype.initialize = function(pixels, opts) {};

  Quantizer.prototype.getQuantizedColors = function() {};

  return Quantizer;

})();

module.exports.MMCQ = require('./mmcq');


},{"./mmcq":19}],19:[function(require,module,exports){
var MMCQ, MMCQImpl, Quantizer, Swatch,
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty;

Swatch = require('../swatch');

Quantizer = require('./index');

MMCQImpl = require('./impl/mmcq');

module.exports = MMCQ = (function(superClass) {
  extend(MMCQ, superClass);

  function MMCQ() {
    return MMCQ.__super__.constructor.apply(this, arguments);
  }

  MMCQ.prototype.initialize = function(pixels, opts) {
    var mmcq;
    this.opts = opts;
    mmcq = new MMCQImpl();
    return this.swatches = mmcq.quantize(pixels, this.opts);
  };

  MMCQ.prototype.getQuantizedColors = function() {
    return this.swatches;
  };

  return MMCQ;

})(Quantizer);


},{"../swatch":20,"./impl/mmcq":15,"./index":18}],20:[function(require,module,exports){
var Swatch, util;

util = require('./util');


/*
  From Vibrant.js by Jari Zwarts
  Ported to node.js by AKFish

  Swatch class
 */

module.exports = Swatch = (function() {
  Swatch.prototype.hsl = void 0;

  Swatch.prototype.rgb = void 0;

  Swatch.prototype.population = 1;

  Swatch.prototype.yiq = 0;

  function Swatch(rgb, population) {
    this.rgb = rgb;
    this.population = population;
  }

  Swatch.prototype.getHsl = function() {
    if (!this.hsl) {
      return this.hsl = util.rgbToHsl(this.rgb[0], this.rgb[1], this.rgb[2]);
    } else {
      return this.hsl;
    }
  };

  Swatch.prototype.getPopulation = function() {
    return this.population;
  };

  Swatch.prototype.getRgb = function() {
    return this.rgb;
  };

  Swatch.prototype.getHex = function() {
    return util.rgbToHex(this.rgb[0], this.rgb[1], this.rgb[2]);
  };

  Swatch.prototype.getTitleTextColor = function() {
    this._ensureTextColors();
    if (this.yiq < 200) {
      return "#fff";
    } else {
      return "#000";
    }
  };

  Swatch.prototype.getBodyTextColor = function() {
    this._ensureTextColors();
    if (this.yiq < 150) {
      return "#fff";
    } else {
      return "#000";
    }
  };

  Swatch.prototype._ensureTextColors = function() {
    if (!this.yiq) {
      return this.yiq = (this.rgb[0] * 299 + this.rgb[1] * 587 + this.rgb[2] * 114) / 1000;
    }
  };

  return Swatch;

})();


},{"./util":21}],21:[function(require,module,exports){
var DELTAE94, RSHIFT, SIGBITS;

DELTAE94 = {
  NA: 0,
  PERFECT: 1,
  CLOSE: 2,
  GOOD: 10,
  SIMILAR: 50
};

SIGBITS = 5;

RSHIFT = 8 - SIGBITS;

module.exports = {
  clone: function(o) {
    var _o, key, value;
    if (typeof o === 'object') {
      if (Array.isArray(o)) {
        return o.map((function(_this) {
          return function(v) {
            return _this.clone(v);
          };
        })(this));
      } else {
        _o = {};
        for (key in o) {
          value = o[key];
          _o[key] = this.clone(value);
        }
        return _o;
      }
    }
    return o;
  },
  defaults: function() {
    var _o, i, key, len, o, value;
    o = {};
    for (i = 0, len = arguments.length; i < len; i++) {
      _o = arguments[i];
      for (key in _o) {
        value = _o[key];
        if (o[key] == null) {
          o[key] = this.clone(value);
        }
      }
    }
    return o;
  },
  hexToRgb: function(hex) {
    var m;
    m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (m != null) {
      return [m[1], m[2], m[3]].map(function(s) {
        return parseInt(s, 16);
      });
    }
    return null;
  },
  rgbToHex: function(r, g, b) {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1, 7);
  },
  rgbToHsl: function(r, g, b) {
    var d, h, l, max, min, s;
    r /= 255;
    g /= 255;
    b /= 255;
    max = Math.max(r, g, b);
    min = Math.min(r, g, b);
    h = void 0;
    s = void 0;
    l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  },
  hslToRgb: function(h, s, l) {
    var b, g, hue2rgb, p, q, r;
    r = void 0;
    g = void 0;
    b = void 0;
    hue2rgb = function(p, q, t) {
      if (t < 0) {
        t += 1;
      }
      if (t > 1) {
        t -= 1;
      }
      if (t < 1 / 6) {
        return p + (q - p) * 6 * t;
      }
      if (t < 1 / 2) {
        return q;
      }
      if (t < 2 / 3) {
        return p + (q - p) * (2 / 3 - t) * 6;
      }
      return p;
    };
    if (s === 0) {
      r = g = b = l;
    } else {
      q = l < 0.5 ? l * (1 + s) : l + s - (l * s);
      p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - (1 / 3));
    }
    return [r * 255, g * 255, b * 255];
  },
  rgbToXyz: function(r, g, b) {
    var x, y, z;
    r /= 255;
    g /= 255;
    b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.005) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.005) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.005) / 1.055, 2.4) : b / 12.92;
    r *= 100;
    g *= 100;
    b *= 100;
    x = r * 0.4124 + g * 0.3576 + b * 0.1805;
    y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    z = r * 0.0193 + g * 0.1192 + b * 0.9505;
    return [x, y, z];
  },
  xyzToCIELab: function(x, y, z) {
    var L, REF_X, REF_Y, REF_Z, a, b;
    REF_X = 95.047;
    REF_Y = 100;
    REF_Z = 108.883;
    x /= REF_X;
    y /= REF_Y;
    z /= REF_Z;
    x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
    y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
    z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
    L = 116 * y - 16;
    a = 500 * (x - y);
    b = 200 * (y - z);
    return [L, a, b];
  },
  rgbToCIELab: function(r, g, b) {
    var ref, x, y, z;
    ref = this.rgbToXyz(r, g, b), x = ref[0], y = ref[1], z = ref[2];
    return this.xyzToCIELab(x, y, z);
  },
  deltaE94: function(lab1, lab2) {
    var L1, L2, WEIGHT_C, WEIGHT_H, WEIGHT_L, a1, a2, b1, b2, dL, da, db, xC1, xC2, xDC, xDE, xDH, xDL, xSC, xSH;
    WEIGHT_L = 1;
    WEIGHT_C = 1;
    WEIGHT_H = 1;
    L1 = lab1[0], a1 = lab1[1], b1 = lab1[2];
    L2 = lab2[0], a2 = lab2[1], b2 = lab2[2];
    dL = L1 - L2;
    da = a1 - a2;
    db = b1 - b2;
    xC1 = Math.sqrt(a1 * a1 + b1 * b1);
    xC2 = Math.sqrt(a2 * a2 + b2 * b2);
    xDL = L2 - L1;
    xDC = xC2 - xC1;
    xDE = Math.sqrt(dL * dL + da * da + db * db);
    if (Math.sqrt(xDE) > Math.sqrt(Math.abs(xDL)) + Math.sqrt(Math.abs(xDC))) {
      xDH = Math.sqrt(xDE * xDE - xDL * xDL - xDC * xDC);
    } else {
      xDH = 0;
    }
    xSC = 1 + 0.045 * xC1;
    xSH = 1 + 0.015 * xC1;
    xDL /= WEIGHT_L;
    xDC /= WEIGHT_C * xSC;
    xDH /= WEIGHT_H * xSH;
    return Math.sqrt(xDL * xDL + xDC * xDC + xDH * xDH);
  },
  rgbDiff: function(rgb1, rgb2) {
    var lab1, lab2;
    lab1 = this.rgbToCIELab.apply(this, rgb1);
    lab2 = this.rgbToCIELab.apply(this, rgb2);
    return this.deltaE94(lab1, lab2);
  },
  hexDiff: function(hex1, hex2) {
    var rgb1, rgb2;
    rgb1 = this.hexToRgb(hex1);
    rgb2 = this.hexToRgb(hex2);
    return this.rgbDiff(rgb1, rgb2);
  },
  DELTAE94_DIFF_STATUS: DELTAE94,
  getColorDiffStatus: function(d) {
    if (d < DELTAE94.NA) {
      return "N/A";
    }
    if (d <= DELTAE94.PERFECT) {
      return "Perfect";
    }
    if (d <= DELTAE94.CLOSE) {
      return "Close";
    }
    if (d <= DELTAE94.GOOD) {
      return "Good";
    }
    if (d < DELTAE94.SIMILAR) {
      return "Similar";
    }
    return "Wrong";
  },
  SIGBITS: SIGBITS,
  RSHIFT: RSHIFT,
  getColorIndex: function(r, g, b) {
    return (r << (2 * SIGBITS)) + (g << SIGBITS) + b;
  }
};


},{}],22:[function(require,module,exports){

/*
  From Vibrant.js by Jari Zwarts
  Ported to node.js by AKFish

  Color algorithm class that finds variations on colors in an image.

  Credits
  --------
  Lokesh Dhakar (http://www.lokeshdhakar.com) - Created ColorThief
  Google - Palette support library in Android
 */
var Builder, DefaultGenerator, Filter, Swatch, Vibrant, util,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

Swatch = require('./swatch');

util = require('./util');

DefaultGenerator = require('./generator').Default;

Filter = require('./filter');

module.exports = Vibrant = (function() {
  Vibrant.DefaultOpts = {
    colorCount: 64,
    quality: 5,
    generator: new DefaultGenerator(),
    Image: null,
    Quantizer: require('./quantizer').MMCQ,
    filters: []
  };

  Vibrant.from = function(src) {
    return new Builder(src);
  };

  Vibrant.prototype.quantize = require('quantize');

  Vibrant.prototype._swatches = [];

  function Vibrant(sourceImage, opts) {
    this.sourceImage = sourceImage;
    if (opts == null) {
      opts = {};
    }
    this.swatches = bind(this.swatches, this);
    this.opts = util.defaults(opts, this.constructor.DefaultOpts);
    this.generator = this.opts.generator;
  }

  Vibrant.prototype.getPalette = function(cb) {
    var image;
    return image = new this.opts.Image(this.sourceImage, (function(_this) {
      return function(err, image) {
        var error, error1;
        if (err != null) {
          return cb(err);
        }
        try {
          _this._process(image, _this.opts);
          return cb(null, _this.swatches());
        } catch (error1) {
          error = error1;
          return cb(error);
        }
      };
    })(this));
  };

  Vibrant.prototype.getSwatches = function(cb) {
    return this.getPalette(cb);
  };

  Vibrant.prototype._process = function(image, opts) {
    var imageData, quantizer, swatches;
    image.scaleDown(this.opts);
    imageData = image.getImageData();
    quantizer = new this.opts.Quantizer();
    quantizer.initialize(imageData.data, this.opts);
    swatches = quantizer.getQuantizedColors();
    this.generator.generate(swatches);
    return image.removeCanvas();
  };

  Vibrant.prototype.swatches = function() {
    return {
      Vibrant: this.generator.getVibrantSwatch(),
      Muted: this.generator.getMutedSwatch(),
      DarkVibrant: this.generator.getDarkVibrantSwatch(),
      DarkMuted: this.generator.getDarkMutedSwatch(),
      LightVibrant: this.generator.getLightVibrantSwatch(),
      LightMuted: this.generator.getLightMutedSwatch()
    };
  };

  return Vibrant;

})();

module.exports.Builder = Builder = (function() {
  function Builder(src1, opts1) {
    this.src = src1;
    this.opts = opts1 != null ? opts1 : {};
    this.opts.filters = util.clone(Vibrant.DefaultOpts.filters);
  }

  Builder.prototype.maxColorCount = function(n) {
    this.opts.colorCount = n;
    return this;
  };

  Builder.prototype.maxDimension = function(d) {
    this.opts.maxDimension = d;
    return this;
  };

  Builder.prototype.addFilter = function(f) {
    if (typeof f === 'function') {
      this.opts.filters.push(f);
    }
    return this;
  };

  Builder.prototype.removeFilter = function(f) {
    var i;
    if ((i = this.opts.filters.indexOf(f)) > 0) {
      this.opts.filters.splice(i);
    }
    return this;
  };

  Builder.prototype.clearFilters = function() {
    this.opts.filters = [];
    return this;
  };

  Builder.prototype.quality = function(q) {
    this.opts.quality = q;
    return this;
  };

  Builder.prototype.useImage = function(image) {
    this.opts.Image = image;
    return this;
  };

  Builder.prototype.useGenerator = function(generator) {
    this.opts.generator = generator;
    return this;
  };

  Builder.prototype.useQuantizer = function(quantizer) {
    this.opts.Quantizer = quantizer;
    return this;
  };

  Builder.prototype.build = function() {
    if (this.v == null) {
      this.v = new Vibrant(this.src, this.opts);
    }
    return this.v;
  };

  Builder.prototype.getSwatches = function(cb) {
    return this.build().getPalette(cb);
  };

  Builder.prototype.getPalette = function(cb) {
    return this.build().getPalette(cb);
  };

  Builder.prototype.from = function(src) {
    return new Vibrant(src, this.opts);
  };

  return Builder;

})();

module.exports.Util = util;

module.exports.Swatch = Swatch;

module.exports.Quantizer = require('./quantizer/');

module.exports.Generator = require('./generator/');

module.exports.Filter = require('./filter/');


},{"./filter":10,"./filter/":10,"./generator":12,"./generator/":12,"./quantizer":18,"./quantizer/":18,"./swatch":20,"./util":21,"quantize":3}]},{},[8])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvdXJsL3VybC5qcyIsIm5vZGVfbW9kdWxlcy9wdW55Y29kZS9wdW55Y29kZS5qcyIsIm5vZGVfbW9kdWxlcy9xdWFudGl6ZS9xdWFudGl6ZS5qcyIsIm5vZGVfbW9kdWxlcy9xdWVyeXN0cmluZy1lczMvZGVjb2RlLmpzIiwibm9kZV9tb2R1bGVzL3F1ZXJ5c3RyaW5nLWVzMy9lbmNvZGUuanMiLCJub2RlX21vZHVsZXMvcXVlcnlzdHJpbmctZXMzL2luZGV4LmpzIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy9icm93c2VyLmNvZmZlZSIsIi9Vc2Vycy92bWFncm8vRGV2ZWxvcGVyL3FjYXN0L25vZGUtdmlicmFudC9zcmMvYnVuZGxlLmNvZmZlZSIsIi9Vc2Vycy92bWFncm8vRGV2ZWxvcGVyL3FjYXN0L25vZGUtdmlicmFudC9zcmMvZmlsdGVyL2RlZmF1bHQuY29mZmVlIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy9maWx0ZXIvaW5kZXguY29mZmVlIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy9nZW5lcmF0b3IvZGVmYXVsdC5jb2ZmZWUiLCIvVXNlcnMvdm1hZ3JvL0RldmVsb3Blci9xY2FzdC9ub2RlLXZpYnJhbnQvc3JjL2dlbmVyYXRvci9pbmRleC5jb2ZmZWUiLCIvVXNlcnMvdm1hZ3JvL0RldmVsb3Blci9xY2FzdC9ub2RlLXZpYnJhbnQvc3JjL2ltYWdlL2Jyb3dzZXIuY29mZmVlIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy9pbWFnZS9pbmRleC5jb2ZmZWUiLCIvVXNlcnMvdm1hZ3JvL0RldmVsb3Blci9xY2FzdC9ub2RlLXZpYnJhbnQvc3JjL3F1YW50aXplci9pbXBsL21tY3EuY29mZmVlIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy9xdWFudGl6ZXIvaW1wbC9wcXVldWUuY29mZmVlIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy9xdWFudGl6ZXIvaW1wbC92Ym94LmNvZmZlZSIsIi9Vc2Vycy92bWFncm8vRGV2ZWxvcGVyL3FjYXN0L25vZGUtdmlicmFudC9zcmMvcXVhbnRpemVyL2luZGV4LmNvZmZlZSIsIi9Vc2Vycy92bWFncm8vRGV2ZWxvcGVyL3FjYXN0L25vZGUtdmlicmFudC9zcmMvcXVhbnRpemVyL21tY3EuY29mZmVlIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy9zd2F0Y2guY29mZmVlIiwiL1VzZXJzL3ZtYWdyby9EZXZlbG9wZXIvcWNhc3Qvbm9kZS12aWJyYW50L3NyYy91dGlsLmNvZmZlZSIsIi9Vc2Vycy92bWFncm8vRGV2ZWxvcGVyL3FjYXN0L25vZGUtdmlicmFudC9zcmMvdmlicmFudC5jb2ZmZWUiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ25zQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDbGhCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFlQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFD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QUMsU0FBZixHQUEyQixPQUFBLENBQVEsY0FBUjs7QUFDM0IsTUFBTSxDQUFDLE9BQU8sQ0FBQyxTQUFmLEdBQTJCLE9BQUEsQ0FBUSxjQUFSOztBQUMzQixNQUFNLENBQUMsT0FBTyxDQUFDLE1BQWYsR0FBd0IsT0FBQSxDQUFRLFdBQVIiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbnZhciBwdW55Y29kZSA9IHJlcXVpcmUoJ3B1bnljb2RlJyk7XG5cbmV4cG9ydHMucGFyc2UgPSB1cmxQYXJzZTtcbmV4cG9ydHMucmVzb2x2ZSA9IHVybFJlc29sdmU7XG5leHBvcnRzLnJlc29sdmVPYmplY3QgPSB1cmxSZXNvbHZlT2JqZWN0O1xuZXhwb3J0cy5mb3JtYXQgPSB1cmxGb3JtYXQ7XG5cbmV4cG9ydHMuVXJsID0gVXJsO1xuXG5mdW5jdGlvbiBVcmwoKSB7XG4gIHRoaXMucHJvdG9jb2wgPSBudWxsO1xuICB0aGlzLnNsYXNoZXMgPSBudWxsO1xuICB0aGlzLmF1dGggPSBudWxsO1xuICB0aGlzLmhvc3QgPSBudWxsO1xuICB0aGlzLnBvcnQgPSBudWxsO1xuICB0aGlzLmhvc3RuYW1lID0gbnVsbDtcbiAgdGhpcy5oYXNoID0gbnVsbDtcbiAgdGhpcy5zZWFyY2ggPSBudWxsO1xuICB0aGlzLnF1ZXJ5ID0gbnVsbDtcbiAgdGhpcy5wYXRobmFtZSA9IG51bGw7XG4gIHRoaXMucGF0aCA9IG51bGw7XG4gIHRoaXMuaHJlZiA9IG51bGw7XG59XG5cbi8vIFJlZmVyZW5jZTogUkZDIDM5ODYsIFJGQyAxODA4LCBSRkMgMjM5NlxuXG4vLyBkZWZpbmUgdGhlc2UgaGVyZSBzbyBhdCBsZWFzdCB0aGV5IG9ubHkgaGF2ZSB0byBiZVxuLy8gY29tcGlsZWQgb25jZSBvbiB0aGUgZmlyc3QgbW9kdWxlIGxvYWQuXG52YXIgcHJvdG9jb2xQYXR0ZXJuID0gL14oW2EtejAtOS4rLV0rOikvaSxcbiAgICBwb3J0UGF0dGVybiA9IC86WzAtOV0qJC8sXG5cbiAgICAvLyBSRkMgMjM5NjogY2hhcmFjdGVycyByZXNlcnZlZCBmb3IgZGVsaW1pdGluZyBVUkxzLlxuICAgIC8vIFdlIGFjdHVhbGx5IGp1c3QgYXV0by1lc2NhcGUgdGhlc2UuXG4gICAgZGVsaW1zID0gWyc8JywgJz4nLCAnXCInLCAnYCcsICcgJywgJ1xccicsICdcXG4nLCAnXFx0J10sXG5cbiAgICAvLyBSRkMgMjM5NjogY2hhcmFjdGVycyBub3QgYWxsb3dlZCBmb3IgdmFyaW91cyByZWFzb25zLlxuICAgIHVud2lzZSA9IFsneycsICd9JywgJ3wnLCAnXFxcXCcsICdeJywgJ2AnXS5jb25jYXQoZGVsaW1zKSxcblxuICAgIC8vIEFsbG93ZWQgYnkgUkZDcywgYnV0IGNhdXNlIG9mIFhTUyBhdHRhY2tzLiAgQWx3YXlzIGVzY2FwZSB0aGVzZS5cbiAgICBhdXRvRXNjYXBlID0gWydcXCcnXS5jb25jYXQodW53aXNlKSxcbiAgICAvLyBDaGFyYWN0ZXJzIHRoYXQgYXJlIG5ldmVyIGV2ZXIgYWxsb3dlZCBpbiBhIGhvc3RuYW1lLlxuICAgIC8vIE5vdGUgdGhhdCBhbnkgaW52YWxpZCBjaGFycyBhcmUgYWxzbyBoYW5kbGVkLCBidXQgdGhlc2VcbiAgICAvLyBhcmUgdGhlIG9uZXMgdGhhdCBhcmUgKmV4cGVjdGVkKiB0byBiZSBzZWVuLCBzbyB3ZSBmYXN0LXBhdGhcbiAgICAvLyB0aGVtLlxuICAgIG5vbkhvc3RDaGFycyA9IFsnJScsICcvJywgJz8nLCAnOycsICcjJ10uY29uY2F0KGF1dG9Fc2NhcGUpLFxuICAgIGhvc3RFbmRpbmdDaGFycyA9IFsnLycsICc/JywgJyMnXSxcbiAgICBob3N0bmFtZU1heExlbiA9IDI1NSxcbiAgICBob3N0bmFtZVBhcnRQYXR0ZXJuID0gL15bYS16MC05QS1aXy1dezAsNjN9JC8sXG4gICAgaG9zdG5hbWVQYXJ0U3RhcnQgPSAvXihbYS16MC05QS1aXy1dezAsNjN9KSguKikkLyxcbiAgICAvLyBwcm90b2NvbHMgdGhhdCBjYW4gYWxsb3cgXCJ1bnNhZmVcIiBhbmQgXCJ1bndpc2VcIiBjaGFycy5cbiAgICB1bnNhZmVQcm90b2NvbCA9IHtcbiAgICAgICdqYXZhc2NyaXB0JzogdHJ1ZSxcbiAgICAgICdqYXZhc2NyaXB0Oic6IHRydWVcbiAgICB9LFxuICAgIC8vIHByb3RvY29scyB0aGF0IG5ldmVyIGhhdmUgYSBob3N0bmFtZS5cbiAgICBob3N0bGVzc1Byb3RvY29sID0ge1xuICAgICAgJ2phdmFzY3JpcHQnOiB0cnVlLFxuICAgICAgJ2phdmFzY3JpcHQ6JzogdHJ1ZVxuICAgIH0sXG4gICAgLy8gcHJvdG9jb2xzIHRoYXQgYWx3YXlzIGNvbnRhaW4gYSAvLyBiaXQuXG4gICAgc2xhc2hlZFByb3RvY29sID0ge1xuICAgICAgJ2h0dHAnOiB0cnVlLFxuICAgICAgJ2h0dHBzJzogdHJ1ZSxcbiAgICAgICdmdHAnOiB0cnVlLFxuICAgICAgJ2dvcGhlcic6IHRydWUsXG4gICAgICAnZmlsZSc6IHRydWUsXG4gICAgICAnaHR0cDonOiB0cnVlLFxuICAgICAgJ2h0dHBzOic6IHRydWUsXG4gICAgICAnZnRwOic6IHRydWUsXG4gICAgICAnZ29waGVyOic6IHRydWUsXG4gICAgICAnZmlsZTonOiB0cnVlXG4gICAgfSxcbiAgICBxdWVyeXN0cmluZyA9IHJlcXVpcmUoJ3F1ZXJ5c3RyaW5nJyk7XG5cbmZ1bmN0aW9uIHVybFBhcnNlKHVybCwgcGFyc2VRdWVyeVN0cmluZywgc2xhc2hlc0Rlbm90ZUhvc3QpIHtcbiAgaWYgKHVybCAmJiBpc09iamVjdCh1cmwpICYmIHVybCBpbnN0YW5jZW9mIFVybCkgcmV0dXJuIHVybDtcblxuICB2YXIgdSA9IG5ldyBVcmw7XG4gIHUucGFyc2UodXJsLCBwYXJzZVF1ZXJ5U3RyaW5nLCBzbGFzaGVzRGVub3RlSG9zdCk7XG4gIHJldHVybiB1O1xufVxuXG5VcmwucHJvdG90eXBlLnBhcnNlID0gZnVuY3Rpb24odXJsLCBwYXJzZVF1ZXJ5U3RyaW5nLCBzbGFzaGVzRGVub3RlSG9zdCkge1xuICBpZiAoIWlzU3RyaW5nKHVybCkpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKFwiUGFyYW1ldGVyICd1cmwnIG11c3QgYmUgYSBzdHJpbmcsIG5vdCBcIiArIHR5cGVvZiB1cmwpO1xuICB9XG5cbiAgdmFyIHJlc3QgPSB1cmw7XG5cbiAgLy8gdHJpbSBiZWZvcmUgcHJvY2VlZGluZy5cbiAgLy8gVGhpcyBpcyB0byBzdXBwb3J0IHBhcnNlIHN0dWZmIGxpa2UgXCIgIGh0dHA6Ly9mb28uY29tICBcXG5cIlxuICByZXN0ID0gcmVzdC50cmltKCk7XG5cbiAgdmFyIHByb3RvID0gcHJvdG9jb2xQYXR0ZXJuLmV4ZWMocmVzdCk7XG4gIGlmIChwcm90bykge1xuICAgIHByb3RvID0gcHJvdG9bMF07XG4gICAgdmFyIGxvd2VyUHJvdG8gPSBwcm90by50b0xvd2VyQ2FzZSgpO1xuICAgIHRoaXMucHJvdG9jb2wgPSBsb3dlclByb3RvO1xuICAgIHJlc3QgPSByZXN0LnN1YnN0cihwcm90by5sZW5ndGgpO1xuICB9XG5cbiAgLy8gZmlndXJlIG91dCBpZiBpdCdzIGdvdCBhIGhvc3RcbiAgLy8gdXNlckBzZXJ2ZXIgaXMgKmFsd2F5cyogaW50ZXJwcmV0ZWQgYXMgYSBob3N0bmFtZSwgYW5kIHVybFxuICAvLyByZXNvbHV0aW9uIHdpbGwgdHJlYXQgLy9mb28vYmFyIGFzIGhvc3Q9Zm9vLHBhdGg9YmFyIGJlY2F1c2UgdGhhdCdzXG4gIC8vIGhvdyB0aGUgYnJvd3NlciByZXNvbHZlcyByZWxhdGl2ZSBVUkxzLlxuICBpZiAoc2xhc2hlc0Rlbm90ZUhvc3QgfHwgcHJvdG8gfHwgcmVzdC5tYXRjaCgvXlxcL1xcL1teQFxcL10rQFteQFxcL10rLykpIHtcbiAgICB2YXIgc2xhc2hlcyA9IHJlc3Quc3Vic3RyKDAsIDIpID09PSAnLy8nO1xuICAgIGlmIChzbGFzaGVzICYmICEocHJvdG8gJiYgaG9zdGxlc3NQcm90b2NvbFtwcm90b10pKSB7XG4gICAgICByZXN0ID0gcmVzdC5zdWJzdHIoMik7XG4gICAgICB0aGlzLnNsYXNoZXMgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghaG9zdGxlc3NQcm90b2NvbFtwcm90b10gJiZcbiAgICAgIChzbGFzaGVzIHx8IChwcm90byAmJiAhc2xhc2hlZFByb3RvY29sW3Byb3RvXSkpKSB7XG5cbiAgICAvLyB0aGVyZSdzIGEgaG9zdG5hbWUuXG4gICAgLy8gdGhlIGZpcnN0IGluc3RhbmNlIG9mIC8sID8sIDssIG9yICMgZW5kcyB0aGUgaG9zdC5cbiAgICAvL1xuICAgIC8vIElmIHRoZXJlIGlzIGFuIEAgaW4gdGhlIGhvc3RuYW1lLCB0aGVuIG5vbi1ob3N0IGNoYXJzICphcmUqIGFsbG93ZWRcbiAgICAvLyB0byB0aGUgbGVmdCBvZiB0aGUgbGFzdCBAIHNpZ24sIHVubGVzcyBzb21lIGhvc3QtZW5kaW5nIGNoYXJhY3RlclxuICAgIC8vIGNvbWVzICpiZWZvcmUqIHRoZSBALXNpZ24uXG4gICAgLy8gVVJMcyBhcmUgb2Jub3hpb3VzLlxuICAgIC8vXG4gICAgLy8gZXg6XG4gICAgLy8gaHR0cDovL2FAYkBjLyA9PiB1c2VyOmFAYiBob3N0OmNcbiAgICAvLyBodHRwOi8vYUBiP0BjID0+IHVzZXI6YSBob3N0OmMgcGF0aDovP0BjXG5cbiAgICAvLyB2MC4xMiBUT0RPKGlzYWFjcyk6IFRoaXMgaXMgbm90IHF1aXRlIGhvdyBDaHJvbWUgZG9lcyB0aGluZ3MuXG4gICAgLy8gUmV2aWV3IG91ciB0ZXN0IGNhc2UgYWdhaW5zdCBicm93c2VycyBtb3JlIGNvbXByZWhlbnNpdmVseS5cblxuICAgIC8vIGZpbmQgdGhlIGZpcnN0IGluc3RhbmNlIG9mIGFueSBob3N0RW5kaW5nQ2hhcnNcbiAgICB2YXIgaG9zdEVuZCA9IC0xO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgaG9zdEVuZGluZ0NoYXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgaGVjID0gcmVzdC5pbmRleE9mKGhvc3RFbmRpbmdDaGFyc1tpXSk7XG4gICAgICBpZiAoaGVjICE9PSAtMSAmJiAoaG9zdEVuZCA9PT0gLTEgfHwgaGVjIDwgaG9zdEVuZCkpXG4gICAgICAgIGhvc3RFbmQgPSBoZWM7XG4gICAgfVxuXG4gICAgLy8gYXQgdGhpcyBwb2ludCwgZWl0aGVyIHdlIGhhdmUgYW4gZXhwbGljaXQgcG9pbnQgd2hlcmUgdGhlXG4gICAgLy8gYXV0aCBwb3J0aW9uIGNhbm5vdCBnbyBwYXN0LCBvciB0aGUgbGFzdCBAIGNoYXIgaXMgdGhlIGRlY2lkZXIuXG4gICAgdmFyIGF1dGgsIGF0U2lnbjtcbiAgICBpZiAoaG9zdEVuZCA9PT0gLTEpIHtcbiAgICAgIC8vIGF0U2lnbiBjYW4gYmUgYW55d2hlcmUuXG4gICAgICBhdFNpZ24gPSByZXN0Lmxhc3RJbmRleE9mKCdAJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIGF0U2lnbiBtdXN0IGJlIGluIGF1dGggcG9ydGlvbi5cbiAgICAgIC8vIGh0dHA6Ly9hQGIvY0BkID0+IGhvc3Q6YiBhdXRoOmEgcGF0aDovY0BkXG4gICAgICBhdFNpZ24gPSByZXN0Lmxhc3RJbmRleE9mKCdAJywgaG9zdEVuZCk7XG4gICAgfVxuXG4gICAgLy8gTm93IHdlIGhhdmUgYSBwb3J0aW9uIHdoaWNoIGlzIGRlZmluaXRlbHkgdGhlIGF1dGguXG4gICAgLy8gUHVsbCB0aGF0IG9mZi5cbiAgICBpZiAoYXRTaWduICE9PSAtMSkge1xuICAgICAgYXV0aCA9IHJlc3Quc2xpY2UoMCwgYXRTaWduKTtcbiAgICAgIHJlc3QgPSByZXN0LnNsaWNlKGF0U2lnbiArIDEpO1xuICAgICAgdGhpcy5hdXRoID0gZGVjb2RlVVJJQ29tcG9uZW50KGF1dGgpO1xuICAgIH1cblxuICAgIC8vIHRoZSBob3N0IGlzIHRoZSByZW1haW5pbmcgdG8gdGhlIGxlZnQgb2YgdGhlIGZpcnN0IG5vbi1ob3N0IGNoYXJcbiAgICBob3N0RW5kID0gLTE7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBub25Ib3N0Q2hhcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBoZWMgPSByZXN0LmluZGV4T2Yobm9uSG9zdENoYXJzW2ldKTtcbiAgICAgIGlmIChoZWMgIT09IC0xICYmIChob3N0RW5kID09PSAtMSB8fCBoZWMgPCBob3N0RW5kKSlcbiAgICAgICAgaG9zdEVuZCA9IGhlYztcbiAgICB9XG4gICAgLy8gaWYgd2Ugc3RpbGwgaGF2ZSBub3QgaGl0IGl0LCB0aGVuIHRoZSBlbnRpcmUgdGhpbmcgaXMgYSBob3N0LlxuICAgIGlmIChob3N0RW5kID09PSAtMSlcbiAgICAgIGhvc3RFbmQgPSByZXN0Lmxlbmd0aDtcblxuICAgIHRoaXMuaG9zdCA9IHJlc3Quc2xpY2UoMCwgaG9zdEVuZCk7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoaG9zdEVuZCk7XG5cbiAgICAvLyBwdWxsIG91dCBwb3J0LlxuICAgIHRoaXMucGFyc2VIb3N0KCk7XG5cbiAgICAvLyB3ZSd2ZSBpbmRpY2F0ZWQgdGhhdCB0aGVyZSBpcyBhIGhvc3RuYW1lLFxuICAgIC8vIHNvIGV2ZW4gaWYgaXQncyBlbXB0eSwgaXQgaGFzIHRvIGJlIHByZXNlbnQuXG4gICAgdGhpcy5ob3N0bmFtZSA9IHRoaXMuaG9zdG5hbWUgfHwgJyc7XG5cbiAgICAvLyBpZiBob3N0bmFtZSBiZWdpbnMgd2l0aCBbIGFuZCBlbmRzIHdpdGggXVxuICAgIC8vIGFzc3VtZSB0aGF0IGl0J3MgYW4gSVB2NiBhZGRyZXNzLlxuICAgIHZhciBpcHY2SG9zdG5hbWUgPSB0aGlzLmhvc3RuYW1lWzBdID09PSAnWycgJiZcbiAgICAgICAgdGhpcy5ob3N0bmFtZVt0aGlzLmhvc3RuYW1lLmxlbmd0aCAtIDFdID09PSAnXSc7XG5cbiAgICAvLyB2YWxpZGF0ZSBhIGxpdHRsZS5cbiAgICBpZiAoIWlwdjZIb3N0bmFtZSkge1xuICAgICAgdmFyIGhvc3RwYXJ0cyA9IHRoaXMuaG9zdG5hbWUuc3BsaXQoL1xcLi8pO1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBob3N0cGFydHMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIHZhciBwYXJ0ID0gaG9zdHBhcnRzW2ldO1xuICAgICAgICBpZiAoIXBhcnQpIGNvbnRpbnVlO1xuICAgICAgICBpZiAoIXBhcnQubWF0Y2goaG9zdG5hbWVQYXJ0UGF0dGVybikpIHtcbiAgICAgICAgICB2YXIgbmV3cGFydCA9ICcnO1xuICAgICAgICAgIGZvciAodmFyIGogPSAwLCBrID0gcGFydC5sZW5ndGg7IGogPCBrOyBqKyspIHtcbiAgICAgICAgICAgIGlmIChwYXJ0LmNoYXJDb2RlQXQoaikgPiAxMjcpIHtcbiAgICAgICAgICAgICAgLy8gd2UgcmVwbGFjZSBub24tQVNDSUkgY2hhciB3aXRoIGEgdGVtcG9yYXJ5IHBsYWNlaG9sZGVyXG4gICAgICAgICAgICAgIC8vIHdlIG5lZWQgdGhpcyB0byBtYWtlIHN1cmUgc2l6ZSBvZiBob3N0bmFtZSBpcyBub3RcbiAgICAgICAgICAgICAgLy8gYnJva2VuIGJ5IHJlcGxhY2luZyBub24tQVNDSUkgYnkgbm90aGluZ1xuICAgICAgICAgICAgICBuZXdwYXJ0ICs9ICd4JztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIG5ld3BhcnQgKz0gcGFydFtqXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gd2UgdGVzdCBhZ2FpbiB3aXRoIEFTQ0lJIGNoYXIgb25seVxuICAgICAgICAgIGlmICghbmV3cGFydC5tYXRjaChob3N0bmFtZVBhcnRQYXR0ZXJuKSkge1xuICAgICAgICAgICAgdmFyIHZhbGlkUGFydHMgPSBob3N0cGFydHMuc2xpY2UoMCwgaSk7XG4gICAgICAgICAgICB2YXIgbm90SG9zdCA9IGhvc3RwYXJ0cy5zbGljZShpICsgMSk7XG4gICAgICAgICAgICB2YXIgYml0ID0gcGFydC5tYXRjaChob3N0bmFtZVBhcnRTdGFydCk7XG4gICAgICAgICAgICBpZiAoYml0KSB7XG4gICAgICAgICAgICAgIHZhbGlkUGFydHMucHVzaChiaXRbMV0pO1xuICAgICAgICAgICAgICBub3RIb3N0LnVuc2hpZnQoYml0WzJdKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChub3RIb3N0Lmxlbmd0aCkge1xuICAgICAgICAgICAgICByZXN0ID0gJy8nICsgbm90SG9zdC5qb2luKCcuJykgKyByZXN0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5ob3N0bmFtZSA9IHZhbGlkUGFydHMuam9pbignLicpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaG9zdG5hbWUubGVuZ3RoID4gaG9zdG5hbWVNYXhMZW4pIHtcbiAgICAgIHRoaXMuaG9zdG5hbWUgPSAnJztcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gaG9zdG5hbWVzIGFyZSBhbHdheXMgbG93ZXIgY2FzZS5cbiAgICAgIHRoaXMuaG9zdG5hbWUgPSB0aGlzLmhvc3RuYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgfVxuXG4gICAgaWYgKCFpcHY2SG9zdG5hbWUpIHtcbiAgICAgIC8vIElETkEgU3VwcG9ydDogUmV0dXJucyBhIHB1bnkgY29kZWQgcmVwcmVzZW50YXRpb24gb2YgXCJkb21haW5cIi5cbiAgICAgIC8vIEl0IG9ubHkgY29udmVydHMgdGhlIHBhcnQgb2YgdGhlIGRvbWFpbiBuYW1lIHRoYXRcbiAgICAgIC8vIGhhcyBub24gQVNDSUkgY2hhcmFjdGVycy4gSS5lLiBpdCBkb3NlbnQgbWF0dGVyIGlmXG4gICAgICAvLyB5b3UgY2FsbCBpdCB3aXRoIGEgZG9tYWluIHRoYXQgYWxyZWFkeSBpcyBpbiBBU0NJSS5cbiAgICAgIHZhciBkb21haW5BcnJheSA9IHRoaXMuaG9zdG5hbWUuc3BsaXQoJy4nKTtcbiAgICAgIHZhciBuZXdPdXQgPSBbXTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgZG9tYWluQXJyYXkubGVuZ3RoOyArK2kpIHtcbiAgICAgICAgdmFyIHMgPSBkb21haW5BcnJheVtpXTtcbiAgICAgICAgbmV3T3V0LnB1c2gocy5tYXRjaCgvW15BLVphLXowLTlfLV0vKSA/XG4gICAgICAgICAgICAneG4tLScgKyBwdW55Y29kZS5lbmNvZGUocykgOiBzKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuaG9zdG5hbWUgPSBuZXdPdXQuam9pbignLicpO1xuICAgIH1cblxuICAgIHZhciBwID0gdGhpcy5wb3J0ID8gJzonICsgdGhpcy5wb3J0IDogJyc7XG4gICAgdmFyIGggPSB0aGlzLmhvc3RuYW1lIHx8ICcnO1xuICAgIHRoaXMuaG9zdCA9IGggKyBwO1xuICAgIHRoaXMuaHJlZiArPSB0aGlzLmhvc3Q7XG5cbiAgICAvLyBzdHJpcCBbIGFuZCBdIGZyb20gdGhlIGhvc3RuYW1lXG4gICAgLy8gdGhlIGhvc3QgZmllbGQgc3RpbGwgcmV0YWlucyB0aGVtLCB0aG91Z2hcbiAgICBpZiAoaXB2Nkhvc3RuYW1lKSB7XG4gICAgICB0aGlzLmhvc3RuYW1lID0gdGhpcy5ob3N0bmFtZS5zdWJzdHIoMSwgdGhpcy5ob3N0bmFtZS5sZW5ndGggLSAyKTtcbiAgICAgIGlmIChyZXN0WzBdICE9PSAnLycpIHtcbiAgICAgICAgcmVzdCA9ICcvJyArIHJlc3Q7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gbm93IHJlc3QgaXMgc2V0IHRvIHRoZSBwb3N0LWhvc3Qgc3R1ZmYuXG4gIC8vIGNob3Agb2ZmIGFueSBkZWxpbSBjaGFycy5cbiAgaWYgKCF1bnNhZmVQcm90b2NvbFtsb3dlclByb3RvXSkge1xuXG4gICAgLy8gRmlyc3QsIG1ha2UgMTAwJSBzdXJlIHRoYXQgYW55IFwiYXV0b0VzY2FwZVwiIGNoYXJzIGdldFxuICAgIC8vIGVzY2FwZWQsIGV2ZW4gaWYgZW5jb2RlVVJJQ29tcG9uZW50IGRvZXNuJ3QgdGhpbmsgdGhleVxuICAgIC8vIG5lZWQgdG8gYmUuXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBhdXRvRXNjYXBlLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIGFlID0gYXV0b0VzY2FwZVtpXTtcbiAgICAgIHZhciBlc2MgPSBlbmNvZGVVUklDb21wb25lbnQoYWUpO1xuICAgICAgaWYgKGVzYyA9PT0gYWUpIHtcbiAgICAgICAgZXNjID0gZXNjYXBlKGFlKTtcbiAgICAgIH1cbiAgICAgIHJlc3QgPSByZXN0LnNwbGl0KGFlKS5qb2luKGVzYyk7XG4gICAgfVxuICB9XG5cblxuICAvLyBjaG9wIG9mZiBmcm9tIHRoZSB0YWlsIGZpcnN0LlxuICB2YXIgaGFzaCA9IHJlc3QuaW5kZXhPZignIycpO1xuICBpZiAoaGFzaCAhPT0gLTEpIHtcbiAgICAvLyBnb3QgYSBmcmFnbWVudCBzdHJpbmcuXG4gICAgdGhpcy5oYXNoID0gcmVzdC5zdWJzdHIoaGFzaCk7XG4gICAgcmVzdCA9IHJlc3Quc2xpY2UoMCwgaGFzaCk7XG4gIH1cbiAgdmFyIHFtID0gcmVzdC5pbmRleE9mKCc/Jyk7XG4gIGlmIChxbSAhPT0gLTEpIHtcbiAgICB0aGlzLnNlYXJjaCA9IHJlc3Quc3Vic3RyKHFtKTtcbiAgICB0aGlzLnF1ZXJ5ID0gcmVzdC5zdWJzdHIocW0gKyAxKTtcbiAgICBpZiAocGFyc2VRdWVyeVN0cmluZykge1xuICAgICAgdGhpcy5xdWVyeSA9IHF1ZXJ5c3RyaW5nLnBhcnNlKHRoaXMucXVlcnkpO1xuICAgIH1cbiAgICByZXN0ID0gcmVzdC5zbGljZSgwLCBxbSk7XG4gIH0gZWxzZSBpZiAocGFyc2VRdWVyeVN0cmluZykge1xuICAgIC8vIG5vIHF1ZXJ5IHN0cmluZywgYnV0IHBhcnNlUXVlcnlTdHJpbmcgc3RpbGwgcmVxdWVzdGVkXG4gICAgdGhpcy5zZWFyY2ggPSAnJztcbiAgICB0aGlzLnF1ZXJ5ID0ge307XG4gIH1cbiAgaWYgKHJlc3QpIHRoaXMucGF0aG5hbWUgPSByZXN0O1xuICBpZiAoc2xhc2hlZFByb3RvY29sW2xvd2VyUHJvdG9dICYmXG4gICAgICB0aGlzLmhvc3RuYW1lICYmICF0aGlzLnBhdGhuYW1lKSB7XG4gICAgdGhpcy5wYXRobmFtZSA9ICcvJztcbiAgfVxuXG4gIC8vdG8gc3VwcG9ydCBodHRwLnJlcXVlc3RcbiAgaWYgKHRoaXMucGF0aG5hbWUgfHwgdGhpcy5zZWFyY2gpIHtcbiAgICB2YXIgcCA9IHRoaXMucGF0aG5hbWUgfHwgJyc7XG4gICAgdmFyIHMgPSB0aGlzLnNlYXJjaCB8fCAnJztcbiAgICB0aGlzLnBhdGggPSBwICsgcztcbiAgfVxuXG4gIC8vIGZpbmFsbHksIHJlY29uc3RydWN0IHRoZSBocmVmIGJhc2VkIG9uIHdoYXQgaGFzIGJlZW4gdmFsaWRhdGVkLlxuICB0aGlzLmhyZWYgPSB0aGlzLmZvcm1hdCgpO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGZvcm1hdCBhIHBhcnNlZCBvYmplY3QgaW50byBhIHVybCBzdHJpbmdcbmZ1bmN0aW9uIHVybEZvcm1hdChvYmopIHtcbiAgLy8gZW5zdXJlIGl0J3MgYW4gb2JqZWN0LCBhbmQgbm90IGEgc3RyaW5nIHVybC5cbiAgLy8gSWYgaXQncyBhbiBvYmosIHRoaXMgaXMgYSBuby1vcC5cbiAgLy8gdGhpcyB3YXksIHlvdSBjYW4gY2FsbCB1cmxfZm9ybWF0KCkgb24gc3RyaW5nc1xuICAvLyB0byBjbGVhbiB1cCBwb3RlbnRpYWxseSB3b25reSB1cmxzLlxuICBpZiAoaXNTdHJpbmcob2JqKSkgb2JqID0gdXJsUGFyc2Uob2JqKTtcbiAgaWYgKCEob2JqIGluc3RhbmNlb2YgVXJsKSkgcmV0dXJuIFVybC5wcm90b3R5cGUuZm9ybWF0LmNhbGwob2JqKTtcbiAgcmV0dXJuIG9iai5mb3JtYXQoKTtcbn1cblxuVXJsLnByb3RvdHlwZS5mb3JtYXQgPSBmdW5jdGlvbigpIHtcbiAgdmFyIGF1dGggPSB0aGlzLmF1dGggfHwgJyc7XG4gIGlmIChhdXRoKSB7XG4gICAgYXV0aCA9IGVuY29kZVVSSUNvbXBvbmVudChhdXRoKTtcbiAgICBhdXRoID0gYXV0aC5yZXBsYWNlKC8lM0EvaSwgJzonKTtcbiAgICBhdXRoICs9ICdAJztcbiAgfVxuXG4gIHZhciBwcm90b2NvbCA9IHRoaXMucHJvdG9jb2wgfHwgJycsXG4gICAgICBwYXRobmFtZSA9IHRoaXMucGF0aG5hbWUgfHwgJycsXG4gICAgICBoYXNoID0gdGhpcy5oYXNoIHx8ICcnLFxuICAgICAgaG9zdCA9IGZhbHNlLFxuICAgICAgcXVlcnkgPSAnJztcblxuICBpZiAodGhpcy5ob3N0KSB7XG4gICAgaG9zdCA9IGF1dGggKyB0aGlzLmhvc3Q7XG4gIH0gZWxzZSBpZiAodGhpcy5ob3N0bmFtZSkge1xuICAgIGhvc3QgPSBhdXRoICsgKHRoaXMuaG9zdG5hbWUuaW5kZXhPZignOicpID09PSAtMSA/XG4gICAgICAgIHRoaXMuaG9zdG5hbWUgOlxuICAgICAgICAnWycgKyB0aGlzLmhvc3RuYW1lICsgJ10nKTtcbiAgICBpZiAodGhpcy5wb3J0KSB7XG4gICAgICBob3N0ICs9ICc6JyArIHRoaXMucG9ydDtcbiAgICB9XG4gIH1cblxuICBpZiAodGhpcy5xdWVyeSAmJlxuICAgICAgaXNPYmplY3QodGhpcy5xdWVyeSkgJiZcbiAgICAgIE9iamVjdC5rZXlzKHRoaXMucXVlcnkpLmxlbmd0aCkge1xuICAgIHF1ZXJ5ID0gcXVlcnlzdHJpbmcuc3RyaW5naWZ5KHRoaXMucXVlcnkpO1xuICB9XG5cbiAgdmFyIHNlYXJjaCA9IHRoaXMuc2VhcmNoIHx8IChxdWVyeSAmJiAoJz8nICsgcXVlcnkpKSB8fCAnJztcblxuICBpZiAocHJvdG9jb2wgJiYgcHJvdG9jb2wuc3Vic3RyKC0xKSAhPT0gJzonKSBwcm90b2NvbCArPSAnOic7XG5cbiAgLy8gb25seSB0aGUgc2xhc2hlZFByb3RvY29scyBnZXQgdGhlIC8vLiAgTm90IG1haWx0bzosIHhtcHA6LCBldGMuXG4gIC8vIHVubGVzcyB0aGV5IGhhZCB0aGVtIHRvIGJlZ2luIHdpdGguXG4gIGlmICh0aGlzLnNsYXNoZXMgfHxcbiAgICAgICghcHJvdG9jb2wgfHwgc2xhc2hlZFByb3RvY29sW3Byb3RvY29sXSkgJiYgaG9zdCAhPT0gZmFsc2UpIHtcbiAgICBob3N0ID0gJy8vJyArIChob3N0IHx8ICcnKTtcbiAgICBpZiAocGF0aG5hbWUgJiYgcGF0aG5hbWUuY2hhckF0KDApICE9PSAnLycpIHBhdGhuYW1lID0gJy8nICsgcGF0aG5hbWU7XG4gIH0gZWxzZSBpZiAoIWhvc3QpIHtcbiAgICBob3N0ID0gJyc7XG4gIH1cblxuICBpZiAoaGFzaCAmJiBoYXNoLmNoYXJBdCgwKSAhPT0gJyMnKSBoYXNoID0gJyMnICsgaGFzaDtcbiAgaWYgKHNlYXJjaCAmJiBzZWFyY2guY2hhckF0KDApICE9PSAnPycpIHNlYXJjaCA9ICc/JyArIHNlYXJjaDtcblxuICBwYXRobmFtZSA9IHBhdGhuYW1lLnJlcGxhY2UoL1s/I10vZywgZnVuY3Rpb24obWF0Y2gpIHtcbiAgICByZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KG1hdGNoKTtcbiAgfSk7XG4gIHNlYXJjaCA9IHNlYXJjaC5yZXBsYWNlKCcjJywgJyUyMycpO1xuXG4gIHJldHVybiBwcm90b2NvbCArIGhvc3QgKyBwYXRobmFtZSArIHNlYXJjaCArIGhhc2g7XG59O1xuXG5mdW5jdGlvbiB1cmxSZXNvbHZlKHNvdXJjZSwgcmVsYXRpdmUpIHtcbiAgcmV0dXJuIHVybFBhcnNlKHNvdXJjZSwgZmFsc2UsIHRydWUpLnJlc29sdmUocmVsYXRpdmUpO1xufVxuXG5VcmwucHJvdG90eXBlLnJlc29sdmUgPSBmdW5jdGlvbihyZWxhdGl2ZSkge1xuICByZXR1cm4gdGhpcy5yZXNvbHZlT2JqZWN0KHVybFBhcnNlKHJlbGF0aXZlLCBmYWxzZSwgdHJ1ZSkpLmZvcm1hdCgpO1xufTtcblxuZnVuY3Rpb24gdXJsUmVzb2x2ZU9iamVjdChzb3VyY2UsIHJlbGF0aXZlKSB7XG4gIGlmICghc291cmNlKSByZXR1cm4gcmVsYXRpdmU7XG4gIHJldHVybiB1cmxQYXJzZShzb3VyY2UsIGZhbHNlLCB0cnVlKS5yZXNvbHZlT2JqZWN0KHJlbGF0aXZlKTtcbn1cblxuVXJsLnByb3RvdHlwZS5yZXNvbHZlT2JqZWN0ID0gZnVuY3Rpb24ocmVsYXRpdmUpIHtcbiAgaWYgKGlzU3RyaW5nKHJlbGF0aXZlKSkge1xuICAgIHZhciByZWwgPSBuZXcgVXJsKCk7XG4gICAgcmVsLnBhcnNlKHJlbGF0aXZlLCBmYWxzZSwgdHJ1ZSk7XG4gICAgcmVsYXRpdmUgPSByZWw7XG4gIH1cblxuICB2YXIgcmVzdWx0ID0gbmV3IFVybCgpO1xuICBPYmplY3Qua2V5cyh0aGlzKS5mb3JFYWNoKGZ1bmN0aW9uKGspIHtcbiAgICByZXN1bHRba10gPSB0aGlzW2tdO1xuICB9LCB0aGlzKTtcblxuICAvLyBoYXNoIGlzIGFsd2F5cyBvdmVycmlkZGVuLCBubyBtYXR0ZXIgd2hhdC5cbiAgLy8gZXZlbiBocmVmPVwiXCIgd2lsbCByZW1vdmUgaXQuXG4gIHJlc3VsdC5oYXNoID0gcmVsYXRpdmUuaGFzaDtcblxuICAvLyBpZiB0aGUgcmVsYXRpdmUgdXJsIGlzIGVtcHR5LCB0aGVuIHRoZXJlJ3Mgbm90aGluZyBsZWZ0IHRvIGRvIGhlcmUuXG4gIGlmIChyZWxhdGl2ZS5ocmVmID09PSAnJykge1xuICAgIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICAvLyBocmVmcyBsaWtlIC8vZm9vL2JhciBhbHdheXMgY3V0IHRvIHRoZSBwcm90b2NvbC5cbiAgaWYgKHJlbGF0aXZlLnNsYXNoZXMgJiYgIXJlbGF0aXZlLnByb3RvY29sKSB7XG4gICAgLy8gdGFrZSBldmVyeXRoaW5nIGV4Y2VwdCB0aGUgcHJvdG9jb2wgZnJvbSByZWxhdGl2ZVxuICAgIE9iamVjdC5rZXlzKHJlbGF0aXZlKS5mb3JFYWNoKGZ1bmN0aW9uKGspIHtcbiAgICAgIGlmIChrICE9PSAncHJvdG9jb2wnKVxuICAgICAgICByZXN1bHRba10gPSByZWxhdGl2ZVtrXTtcbiAgICB9KTtcblxuICAgIC8vdXJsUGFyc2UgYXBwZW5kcyB0cmFpbGluZyAvIHRvIHVybHMgbGlrZSBodHRwOi8vd3d3LmV4YW1wbGUuY29tXG4gICAgaWYgKHNsYXNoZWRQcm90b2NvbFtyZXN1bHQucHJvdG9jb2xdICYmXG4gICAgICAgIHJlc3VsdC5ob3N0bmFtZSAmJiAhcmVzdWx0LnBhdGhuYW1lKSB7XG4gICAgICByZXN1bHQucGF0aCA9IHJlc3VsdC5wYXRobmFtZSA9ICcvJztcbiAgICB9XG5cbiAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgaWYgKHJlbGF0aXZlLnByb3RvY29sICYmIHJlbGF0aXZlLnByb3RvY29sICE9PSByZXN1bHQucHJvdG9jb2wpIHtcbiAgICAvLyBpZiBpdCdzIGEga25vd24gdXJsIHByb3RvY29sLCB0aGVuIGNoYW5naW5nXG4gICAgLy8gdGhlIHByb3RvY29sIGRvZXMgd2VpcmQgdGhpbmdzXG4gICAgLy8gZmlyc3QsIGlmIGl0J3Mgbm90IGZpbGU6LCB0aGVuIHdlIE1VU1QgaGF2ZSBhIGhvc3QsXG4gICAgLy8gYW5kIGlmIHRoZXJlIHdhcyBhIHBhdGhcbiAgICAvLyB0byBiZWdpbiB3aXRoLCB0aGVuIHdlIE1VU1QgaGF2ZSBhIHBhdGguXG4gICAgLy8gaWYgaXQgaXMgZmlsZTosIHRoZW4gdGhlIGhvc3QgaXMgZHJvcHBlZCxcbiAgICAvLyBiZWNhdXNlIHRoYXQncyBrbm93biB0byBiZSBob3N0bGVzcy5cbiAgICAvLyBhbnl0aGluZyBlbHNlIGlzIGFzc3VtZWQgdG8gYmUgYWJzb2x1dGUuXG4gICAgaWYgKCFzbGFzaGVkUHJvdG9jb2xbcmVsYXRpdmUucHJvdG9jb2xdKSB7XG4gICAgICBPYmplY3Qua2V5cyhyZWxhdGl2ZSkuZm9yRWFjaChmdW5jdGlvbihrKSB7XG4gICAgICAgIHJlc3VsdFtrXSA9IHJlbGF0aXZlW2tdO1xuICAgICAgfSk7XG4gICAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuXG4gICAgcmVzdWx0LnByb3RvY29sID0gcmVsYXRpdmUucHJvdG9jb2w7XG4gICAgaWYgKCFyZWxhdGl2ZS5ob3N0ICYmICFob3N0bGVzc1Byb3RvY29sW3JlbGF0aXZlLnByb3RvY29sXSkge1xuICAgICAgdmFyIHJlbFBhdGggPSAocmVsYXRpdmUucGF0aG5hbWUgfHwgJycpLnNwbGl0KCcvJyk7XG4gICAgICB3aGlsZSAocmVsUGF0aC5sZW5ndGggJiYgIShyZWxhdGl2ZS5ob3N0ID0gcmVsUGF0aC5zaGlmdCgpKSk7XG4gICAgICBpZiAoIXJlbGF0aXZlLmhvc3QpIHJlbGF0aXZlLmhvc3QgPSAnJztcbiAgICAgIGlmICghcmVsYXRpdmUuaG9zdG5hbWUpIHJlbGF0aXZlLmhvc3RuYW1lID0gJyc7XG4gICAgICBpZiAocmVsUGF0aFswXSAhPT0gJycpIHJlbFBhdGgudW5zaGlmdCgnJyk7XG4gICAgICBpZiAocmVsUGF0aC5sZW5ndGggPCAyKSByZWxQYXRoLnVuc2hpZnQoJycpO1xuICAgICAgcmVzdWx0LnBhdGhuYW1lID0gcmVsUGF0aC5qb2luKCcvJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5wYXRobmFtZSA9IHJlbGF0aXZlLnBhdGhuYW1lO1xuICAgIH1cbiAgICByZXN1bHQuc2VhcmNoID0gcmVsYXRpdmUuc2VhcmNoO1xuICAgIHJlc3VsdC5xdWVyeSA9IHJlbGF0aXZlLnF1ZXJ5O1xuICAgIHJlc3VsdC5ob3N0ID0gcmVsYXRpdmUuaG9zdCB8fCAnJztcbiAgICByZXN1bHQuYXV0aCA9IHJlbGF0aXZlLmF1dGg7XG4gICAgcmVzdWx0Lmhvc3RuYW1lID0gcmVsYXRpdmUuaG9zdG5hbWUgfHwgcmVsYXRpdmUuaG9zdDtcbiAgICByZXN1bHQucG9ydCA9IHJlbGF0aXZlLnBvcnQ7XG4gICAgLy8gdG8gc3VwcG9ydCBodHRwLnJlcXVlc3RcbiAgICBpZiAocmVzdWx0LnBhdGhuYW1lIHx8IHJlc3VsdC5zZWFyY2gpIHtcbiAgICAgIHZhciBwID0gcmVzdWx0LnBhdGhuYW1lIHx8ICcnO1xuICAgICAgdmFyIHMgPSByZXN1bHQuc2VhcmNoIHx8ICcnO1xuICAgICAgcmVzdWx0LnBhdGggPSBwICsgcztcbiAgICB9XG4gICAgcmVzdWx0LnNsYXNoZXMgPSByZXN1bHQuc2xhc2hlcyB8fCByZWxhdGl2ZS5zbGFzaGVzO1xuICAgIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICB2YXIgaXNTb3VyY2VBYnMgPSAocmVzdWx0LnBhdGhuYW1lICYmIHJlc3VsdC5wYXRobmFtZS5jaGFyQXQoMCkgPT09ICcvJyksXG4gICAgICBpc1JlbEFicyA9IChcbiAgICAgICAgICByZWxhdGl2ZS5ob3N0IHx8XG4gICAgICAgICAgcmVsYXRpdmUucGF0aG5hbWUgJiYgcmVsYXRpdmUucGF0aG5hbWUuY2hhckF0KDApID09PSAnLydcbiAgICAgICksXG4gICAgICBtdXN0RW5kQWJzID0gKGlzUmVsQWJzIHx8IGlzU291cmNlQWJzIHx8XG4gICAgICAgICAgICAgICAgICAgIChyZXN1bHQuaG9zdCAmJiByZWxhdGl2ZS5wYXRobmFtZSkpLFxuICAgICAgcmVtb3ZlQWxsRG90cyA9IG11c3RFbmRBYnMsXG4gICAgICBzcmNQYXRoID0gcmVzdWx0LnBhdGhuYW1lICYmIHJlc3VsdC5wYXRobmFtZS5zcGxpdCgnLycpIHx8IFtdLFxuICAgICAgcmVsUGF0aCA9IHJlbGF0aXZlLnBhdGhuYW1lICYmIHJlbGF0aXZlLnBhdGhuYW1lLnNwbGl0KCcvJykgfHwgW10sXG4gICAgICBwc3ljaG90aWMgPSByZXN1bHQucHJvdG9jb2wgJiYgIXNsYXNoZWRQcm90b2NvbFtyZXN1bHQucHJvdG9jb2xdO1xuXG4gIC8vIGlmIHRoZSB1cmwgaXMgYSBub24tc2xhc2hlZCB1cmwsIHRoZW4gcmVsYXRpdmVcbiAgLy8gbGlua3MgbGlrZSAuLi8uLiBzaG91bGQgYmUgYWJsZVxuICAvLyB0byBjcmF3bCB1cCB0byB0aGUgaG9zdG5hbWUsIGFzIHdlbGwuICBUaGlzIGlzIHN0cmFuZ2UuXG4gIC8vIHJlc3VsdC5wcm90b2NvbCBoYXMgYWxyZWFkeSBiZWVuIHNldCBieSBub3cuXG4gIC8vIExhdGVyIG9uLCBwdXQgdGhlIGZpcnN0IHBhdGggcGFydCBpbnRvIHRoZSBob3N0IGZpZWxkLlxuICBpZiAocHN5Y2hvdGljKSB7XG4gICAgcmVzdWx0Lmhvc3RuYW1lID0gJyc7XG4gICAgcmVzdWx0LnBvcnQgPSBudWxsO1xuICAgIGlmIChyZXN1bHQuaG9zdCkge1xuICAgICAgaWYgKHNyY1BhdGhbMF0gPT09ICcnKSBzcmNQYXRoWzBdID0gcmVzdWx0Lmhvc3Q7XG4gICAgICBlbHNlIHNyY1BhdGgudW5zaGlmdChyZXN1bHQuaG9zdCk7XG4gICAgfVxuICAgIHJlc3VsdC5ob3N0ID0gJyc7XG4gICAgaWYgKHJlbGF0aXZlLnByb3RvY29sKSB7XG4gICAgICByZWxhdGl2ZS5ob3N0bmFtZSA9IG51bGw7XG4gICAgICByZWxhdGl2ZS5wb3J0ID0gbnVsbDtcbiAgICAgIGlmIChyZWxhdGl2ZS5ob3N0KSB7XG4gICAgICAgIGlmIChyZWxQYXRoWzBdID09PSAnJykgcmVsUGF0aFswXSA9IHJlbGF0aXZlLmhvc3Q7XG4gICAgICAgIGVsc2UgcmVsUGF0aC51bnNoaWZ0KHJlbGF0aXZlLmhvc3QpO1xuICAgICAgfVxuICAgICAgcmVsYXRpdmUuaG9zdCA9IG51bGw7XG4gICAgfVxuICAgIG11c3RFbmRBYnMgPSBtdXN0RW5kQWJzICYmIChyZWxQYXRoWzBdID09PSAnJyB8fCBzcmNQYXRoWzBdID09PSAnJyk7XG4gIH1cblxuICBpZiAoaXNSZWxBYnMpIHtcbiAgICAvLyBpdCdzIGFic29sdXRlLlxuICAgIHJlc3VsdC5ob3N0ID0gKHJlbGF0aXZlLmhvc3QgfHwgcmVsYXRpdmUuaG9zdCA9PT0gJycpID9cbiAgICAgICAgICAgICAgICAgIHJlbGF0aXZlLmhvc3QgOiByZXN1bHQuaG9zdDtcbiAgICByZXN1bHQuaG9zdG5hbWUgPSAocmVsYXRpdmUuaG9zdG5hbWUgfHwgcmVsYXRpdmUuaG9zdG5hbWUgPT09ICcnKSA/XG4gICAgICAgICAgICAgICAgICAgICAgcmVsYXRpdmUuaG9zdG5hbWUgOiByZXN1bHQuaG9zdG5hbWU7XG4gICAgcmVzdWx0LnNlYXJjaCA9IHJlbGF0aXZlLnNlYXJjaDtcbiAgICByZXN1bHQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICBzcmNQYXRoID0gcmVsUGF0aDtcbiAgICAvLyBmYWxsIHRocm91Z2ggdG8gdGhlIGRvdC1oYW5kbGluZyBiZWxvdy5cbiAgfSBlbHNlIGlmIChyZWxQYXRoLmxlbmd0aCkge1xuICAgIC8vIGl0J3MgcmVsYXRpdmVcbiAgICAvLyB0aHJvdyBhd2F5IHRoZSBleGlzdGluZyBmaWxlLCBhbmQgdGFrZSB0aGUgbmV3IHBhdGggaW5zdGVhZC5cbiAgICBpZiAoIXNyY1BhdGgpIHNyY1BhdGggPSBbXTtcbiAgICBzcmNQYXRoLnBvcCgpO1xuICAgIHNyY1BhdGggPSBzcmNQYXRoLmNvbmNhdChyZWxQYXRoKTtcbiAgICByZXN1bHQuc2VhcmNoID0gcmVsYXRpdmUuc2VhcmNoO1xuICAgIHJlc3VsdC5xdWVyeSA9IHJlbGF0aXZlLnF1ZXJ5O1xuICB9IGVsc2UgaWYgKCFpc051bGxPclVuZGVmaW5lZChyZWxhdGl2ZS5zZWFyY2gpKSB7XG4gICAgLy8ganVzdCBwdWxsIG91dCB0aGUgc2VhcmNoLlxuICAgIC8vIGxpa2UgaHJlZj0nP2ZvbycuXG4gICAgLy8gUHV0IHRoaXMgYWZ0ZXIgdGhlIG90aGVyIHR3byBjYXNlcyBiZWNhdXNlIGl0IHNpbXBsaWZpZXMgdGhlIGJvb2xlYW5zXG4gICAgaWYgKHBzeWNob3RpYykge1xuICAgICAgcmVzdWx0Lmhvc3RuYW1lID0gcmVzdWx0Lmhvc3QgPSBzcmNQYXRoLnNoaWZ0KCk7XG4gICAgICAvL29jY2F0aW9uYWx5IHRoZSBhdXRoIGNhbiBnZXQgc3R1Y2sgb25seSBpbiBob3N0XG4gICAgICAvL3RoaXMgZXNwZWNpYWx5IGhhcHBlbnMgaW4gY2FzZXMgbGlrZVxuICAgICAgLy91cmwucmVzb2x2ZU9iamVjdCgnbWFpbHRvOmxvY2FsMUBkb21haW4xJywgJ2xvY2FsMkBkb21haW4yJylcbiAgICAgIHZhciBhdXRoSW5Ib3N0ID0gcmVzdWx0Lmhvc3QgJiYgcmVzdWx0Lmhvc3QuaW5kZXhPZignQCcpID4gMCA/XG4gICAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5ob3N0LnNwbGl0KCdAJykgOiBmYWxzZTtcbiAgICAgIGlmIChhdXRoSW5Ib3N0KSB7XG4gICAgICAgIHJlc3VsdC5hdXRoID0gYXV0aEluSG9zdC5zaGlmdCgpO1xuICAgICAgICByZXN1bHQuaG9zdCA9IHJlc3VsdC5ob3N0bmFtZSA9IGF1dGhJbkhvc3Quc2hpZnQoKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmVzdWx0LnNlYXJjaCA9IHJlbGF0aXZlLnNlYXJjaDtcbiAgICByZXN1bHQucXVlcnkgPSByZWxhdGl2ZS5xdWVyeTtcbiAgICAvL3RvIHN1cHBvcnQgaHR0cC5yZXF1ZXN0XG4gICAgaWYgKCFpc051bGwocmVzdWx0LnBhdGhuYW1lKSB8fCAhaXNOdWxsKHJlc3VsdC5zZWFyY2gpKSB7XG4gICAgICByZXN1bHQucGF0aCA9IChyZXN1bHQucGF0aG5hbWUgPyByZXN1bHQucGF0aG5hbWUgOiAnJykgK1xuICAgICAgICAgICAgICAgICAgICAocmVzdWx0LnNlYXJjaCA/IHJlc3VsdC5zZWFyY2ggOiAnJyk7XG4gICAgfVxuICAgIHJlc3VsdC5ocmVmID0gcmVzdWx0LmZvcm1hdCgpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cblxuICBpZiAoIXNyY1BhdGgubGVuZ3RoKSB7XG4gICAgLy8gbm8gcGF0aCBhdCBhbGwuICBlYXN5LlxuICAgIC8vIHdlJ3ZlIGFscmVhZHkgaGFuZGxlZCB0aGUgb3RoZXIgc3R1ZmYgYWJvdmUuXG4gICAgcmVzdWx0LnBhdGhuYW1lID0gbnVsbDtcbiAgICAvL3RvIHN1cHBvcnQgaHR0cC5yZXF1ZXN0XG4gICAgaWYgKHJlc3VsdC5zZWFyY2gpIHtcbiAgICAgIHJlc3VsdC5wYXRoID0gJy8nICsgcmVzdWx0LnNlYXJjaDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0LnBhdGggPSBudWxsO1xuICAgIH1cbiAgICByZXN1bHQuaHJlZiA9IHJlc3VsdC5mb3JtYXQoKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgLy8gaWYgYSB1cmwgRU5EcyBpbiAuIG9yIC4uLCB0aGVuIGl0IG11c3QgZ2V0IGEgdHJhaWxpbmcgc2xhc2guXG4gIC8vIGhvd2V2ZXIsIGlmIGl0IGVuZHMgaW4gYW55dGhpbmcgZWxzZSBub24tc2xhc2h5LFxuICAvLyB0aGVuIGl0IG11c3QgTk9UIGdldCBhIHRyYWlsaW5nIHNsYXNoLlxuICB2YXIgbGFzdCA9IHNyY1BhdGguc2xpY2UoLTEpWzBdO1xuICB2YXIgaGFzVHJhaWxpbmdTbGFzaCA9IChcbiAgICAgIChyZXN1bHQuaG9zdCB8fCByZWxhdGl2ZS5ob3N0KSAmJiAobGFzdCA9PT0gJy4nIHx8IGxhc3QgPT09ICcuLicpIHx8XG4gICAgICBsYXN0ID09PSAnJyk7XG5cbiAgLy8gc3RyaXAgc2luZ2xlIGRvdHMsIHJlc29sdmUgZG91YmxlIGRvdHMgdG8gcGFyZW50IGRpclxuICAvLyBpZiB0aGUgcGF0aCB0cmllcyB0byBnbyBhYm92ZSB0aGUgcm9vdCwgYHVwYCBlbmRzIHVwID4gMFxuICB2YXIgdXAgPSAwO1xuICBmb3IgKHZhciBpID0gc3JjUGF0aC5sZW5ndGg7IGkgPj0gMDsgaS0tKSB7XG4gICAgbGFzdCA9IHNyY1BhdGhbaV07XG4gICAgaWYgKGxhc3QgPT0gJy4nKSB7XG4gICAgICBzcmNQYXRoLnNwbGljZShpLCAxKTtcbiAgICB9IGVsc2UgaWYgKGxhc3QgPT09ICcuLicpIHtcbiAgICAgIHNyY1BhdGguc3BsaWNlKGksIDEpO1xuICAgICAgdXArKztcbiAgICB9IGVsc2UgaWYgKHVwKSB7XG4gICAgICBzcmNQYXRoLnNwbGljZShpLCAxKTtcbiAgICAgIHVwLS07XG4gICAgfVxuICB9XG5cbiAgLy8gaWYgdGhlIHBhdGggaXMgYWxsb3dlZCB0byBnbyBhYm92ZSB0aGUgcm9vdCwgcmVzdG9yZSBsZWFkaW5nIC4uc1xuICBpZiAoIW11c3RFbmRBYnMgJiYgIXJlbW92ZUFsbERvdHMpIHtcbiAgICBmb3IgKDsgdXAtLTsgdXApIHtcbiAgICAgIHNyY1BhdGgudW5zaGlmdCgnLi4nKTtcbiAgICB9XG4gIH1cblxuICBpZiAobXVzdEVuZEFicyAmJiBzcmNQYXRoWzBdICE9PSAnJyAmJlxuICAgICAgKCFzcmNQYXRoWzBdIHx8IHNyY1BhdGhbMF0uY2hhckF0KDApICE9PSAnLycpKSB7XG4gICAgc3JjUGF0aC51bnNoaWZ0KCcnKTtcbiAgfVxuXG4gIGlmIChoYXNUcmFpbGluZ1NsYXNoICYmIChzcmNQYXRoLmpvaW4oJy8nKS5zdWJzdHIoLTEpICE9PSAnLycpKSB7XG4gICAgc3JjUGF0aC5wdXNoKCcnKTtcbiAgfVxuXG4gIHZhciBpc0Fic29sdXRlID0gc3JjUGF0aFswXSA9PT0gJycgfHxcbiAgICAgIChzcmNQYXRoWzBdICYmIHNyY1BhdGhbMF0uY2hhckF0KDApID09PSAnLycpO1xuXG4gIC8vIHB1dCB0aGUgaG9zdCBiYWNrXG4gIGlmIChwc3ljaG90aWMpIHtcbiAgICByZXN1bHQuaG9zdG5hbWUgPSByZXN1bHQuaG9zdCA9IGlzQWJzb2x1dGUgPyAnJyA6XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzcmNQYXRoLmxlbmd0aCA/IHNyY1BhdGguc2hpZnQoKSA6ICcnO1xuICAgIC8vb2NjYXRpb25hbHkgdGhlIGF1dGggY2FuIGdldCBzdHVjayBvbmx5IGluIGhvc3RcbiAgICAvL3RoaXMgZXNwZWNpYWx5IGhhcHBlbnMgaW4gY2FzZXMgbGlrZVxuICAgIC8vdXJsLnJlc29sdmVPYmplY3QoJ21haWx0bzpsb2NhbDFAZG9tYWluMScsICdsb2NhbDJAZG9tYWluMicpXG4gICAgdmFyIGF1dGhJbkhvc3QgPSByZXN1bHQuaG9zdCAmJiByZXN1bHQuaG9zdC5pbmRleE9mKCdAJykgPiAwID9cbiAgICAgICAgICAgICAgICAgICAgIHJlc3VsdC5ob3N0LnNwbGl0KCdAJykgOiBmYWxzZTtcbiAgICBpZiAoYXV0aEluSG9zdCkge1xuICAgICAgcmVzdWx0LmF1dGggPSBhdXRoSW5Ib3N0LnNoaWZ0KCk7XG4gICAgICByZXN1bHQuaG9zdCA9IHJlc3VsdC5ob3N0bmFtZSA9IGF1dGhJbkhvc3Quc2hpZnQoKTtcbiAgICB9XG4gIH1cblxuICBtdXN0RW5kQWJzID0gbXVzdEVuZEFicyB8fCAocmVzdWx0Lmhvc3QgJiYgc3JjUGF0aC5sZW5ndGgpO1xuXG4gIGlmIChtdXN0RW5kQWJzICYmICFpc0Fic29sdXRlKSB7XG4gICAgc3JjUGF0aC51bnNoaWZ0KCcnKTtcbiAgfVxuXG4gIGlmICghc3JjUGF0aC5sZW5ndGgpIHtcbiAgICByZXN1bHQucGF0aG5hbWUgPSBudWxsO1xuICAgIHJlc3VsdC5wYXRoID0gbnVsbDtcbiAgfSBlbHNlIHtcbiAgICByZXN1bHQucGF0aG5hbWUgPSBzcmNQYXRoLmpvaW4oJy8nKTtcbiAgfVxuXG4gIC8vdG8gc3VwcG9ydCByZXF1ZXN0Lmh0dHBcbiAgaWYgKCFpc051bGwocmVzdWx0LnBhdGhuYW1lKSB8fCAhaXNOdWxsKHJlc3VsdC5zZWFyY2gpKSB7XG4gICAgcmVzdWx0LnBhdGggPSAocmVzdWx0LnBhdGhuYW1lID8gcmVzdWx0LnBhdGhuYW1lIDogJycpICtcbiAgICAgICAgICAgICAgICAgIChyZXN1bHQuc2VhcmNoID8gcmVzdWx0LnNlYXJjaCA6ICcnKTtcbiAgfVxuICByZXN1bHQuYXV0aCA9IHJlbGF0aXZlLmF1dGggfHwgcmVzdWx0LmF1dGg7XG4gIHJlc3VsdC5zbGFzaGVzID0gcmVzdWx0LnNsYXNoZXMgfHwgcmVsYXRpdmUuc2xhc2hlcztcbiAgcmVzdWx0LmhyZWYgPSByZXN1bHQuZm9ybWF0KCk7XG4gIHJldHVybiByZXN1bHQ7XG59O1xuXG5VcmwucHJvdG90eXBlLnBhcnNlSG9zdCA9IGZ1bmN0aW9uKCkge1xuICB2YXIgaG9zdCA9IHRoaXMuaG9zdDtcbiAgdmFyIHBvcnQgPSBwb3J0UGF0dGVybi5leGVjKGhvc3QpO1xuICBpZiAocG9ydCkge1xuICAgIHBvcnQgPSBwb3J0WzBdO1xuICAgIGlmIChwb3J0ICE9PSAnOicpIHtcbiAgICAgIHRoaXMucG9ydCA9IHBvcnQuc3Vic3RyKDEpO1xuICAgIH1cbiAgICBob3N0ID0gaG9zdC5zdWJzdHIoMCwgaG9zdC5sZW5ndGggLSBwb3J0Lmxlbmd0aCk7XG4gIH1cbiAgaWYgKGhvc3QpIHRoaXMuaG9zdG5hbWUgPSBob3N0O1xufTtcblxuZnVuY3Rpb24gaXNTdHJpbmcoYXJnKSB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSBcInN0cmluZ1wiO1xufVxuXG5mdW5jdGlvbiBpc09iamVjdChhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbDtcbn1cblxuZnVuY3Rpb24gaXNOdWxsKGFyZykge1xuICByZXR1cm4gYXJnID09PSBudWxsO1xufVxuZnVuY3Rpb24gaXNOdWxsT3JVbmRlZmluZWQoYXJnKSB7XG4gIHJldHVybiAgYXJnID09IG51bGw7XG59XG4iLCIvKiEgaHR0cHM6Ly9tdGhzLmJlL3B1bnljb2RlIHYxLjMuMiBieSBAbWF0aGlhcyAqL1xuOyhmdW5jdGlvbihyb290KSB7XG5cblx0LyoqIERldGVjdCBmcmVlIHZhcmlhYmxlcyAqL1xuXHR2YXIgZnJlZUV4cG9ydHMgPSB0eXBlb2YgZXhwb3J0cyA9PSAnb2JqZWN0JyAmJiBleHBvcnRzICYmXG5cdFx0IWV4cG9ydHMubm9kZVR5cGUgJiYgZXhwb3J0cztcblx0dmFyIGZyZWVNb2R1bGUgPSB0eXBlb2YgbW9kdWxlID09ICdvYmplY3QnICYmIG1vZHVsZSAmJlxuXHRcdCFtb2R1bGUubm9kZVR5cGUgJiYgbW9kdWxlO1xuXHR2YXIgZnJlZUdsb2JhbCA9IHR5cGVvZiBnbG9iYWwgPT0gJ29iamVjdCcgJiYgZ2xvYmFsO1xuXHRpZiAoXG5cdFx0ZnJlZUdsb2JhbC5nbG9iYWwgPT09IGZyZWVHbG9iYWwgfHxcblx0XHRmcmVlR2xvYmFsLndpbmRvdyA9PT0gZnJlZUdsb2JhbCB8fFxuXHRcdGZyZWVHbG9iYWwuc2VsZiA9PT0gZnJlZUdsb2JhbFxuXHQpIHtcblx0XHRyb290ID0gZnJlZUdsb2JhbDtcblx0fVxuXG5cdC8qKlxuXHQgKiBUaGUgYHB1bnljb2RlYCBvYmplY3QuXG5cdCAqIEBuYW1lIHB1bnljb2RlXG5cdCAqIEB0eXBlIE9iamVjdFxuXHQgKi9cblx0dmFyIHB1bnljb2RlLFxuXG5cdC8qKiBIaWdoZXN0IHBvc2l0aXZlIHNpZ25lZCAzMi1iaXQgZmxvYXQgdmFsdWUgKi9cblx0bWF4SW50ID0gMjE0NzQ4MzY0NywgLy8gYWthLiAweDdGRkZGRkZGIG9yIDJeMzEtMVxuXG5cdC8qKiBCb290c3RyaW5nIHBhcmFtZXRlcnMgKi9cblx0YmFzZSA9IDM2LFxuXHR0TWluID0gMSxcblx0dE1heCA9IDI2LFxuXHRza2V3ID0gMzgsXG5cdGRhbXAgPSA3MDAsXG5cdGluaXRpYWxCaWFzID0gNzIsXG5cdGluaXRpYWxOID0gMTI4LCAvLyAweDgwXG5cdGRlbGltaXRlciA9ICctJywgLy8gJ1xceDJEJ1xuXG5cdC8qKiBSZWd1bGFyIGV4cHJlc3Npb25zICovXG5cdHJlZ2V4UHVueWNvZGUgPSAvXnhuLS0vLFxuXHRyZWdleE5vbkFTQ0lJID0gL1teXFx4MjAtXFx4N0VdLywgLy8gdW5wcmludGFibGUgQVNDSUkgY2hhcnMgKyBub24tQVNDSUkgY2hhcnNcblx0cmVnZXhTZXBhcmF0b3JzID0gL1tcXHgyRVxcdTMwMDJcXHVGRjBFXFx1RkY2MV0vZywgLy8gUkZDIDM0OTAgc2VwYXJhdG9yc1xuXG5cdC8qKiBFcnJvciBtZXNzYWdlcyAqL1xuXHRlcnJvcnMgPSB7XG5cdFx0J292ZXJmbG93JzogJ092ZXJmbG93OiBpbnB1dCBuZWVkcyB3aWRlciBpbnRlZ2VycyB0byBwcm9jZXNzJyxcblx0XHQnbm90LWJhc2ljJzogJ0lsbGVnYWwgaW5wdXQgPj0gMHg4MCAobm90IGEgYmFzaWMgY29kZSBwb2ludCknLFxuXHRcdCdpbnZhbGlkLWlucHV0JzogJ0ludmFsaWQgaW5wdXQnXG5cdH0sXG5cblx0LyoqIENvbnZlbmllbmNlIHNob3J0Y3V0cyAqL1xuXHRiYXNlTWludXNUTWluID0gYmFzZSAtIHRNaW4sXG5cdGZsb29yID0gTWF0aC5mbG9vcixcblx0c3RyaW5nRnJvbUNoYXJDb2RlID0gU3RyaW5nLmZyb21DaGFyQ29kZSxcblxuXHQvKiogVGVtcG9yYXJ5IHZhcmlhYmxlICovXG5cdGtleTtcblxuXHQvKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cblxuXHQvKipcblx0ICogQSBnZW5lcmljIGVycm9yIHV0aWxpdHkgZnVuY3Rpb24uXG5cdCAqIEBwcml2YXRlXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSB0eXBlIFRoZSBlcnJvciB0eXBlLlxuXHQgKiBAcmV0dXJucyB7RXJyb3J9IFRocm93cyBhIGBSYW5nZUVycm9yYCB3aXRoIHRoZSBhcHBsaWNhYmxlIGVycm9yIG1lc3NhZ2UuXG5cdCAqL1xuXHRmdW5jdGlvbiBlcnJvcih0eXBlKSB7XG5cdFx0dGhyb3cgUmFuZ2VFcnJvcihlcnJvcnNbdHlwZV0pO1xuXHR9XG5cblx0LyoqXG5cdCAqIEEgZ2VuZXJpYyBgQXJyYXkjbWFwYCB1dGlsaXR5IGZ1bmN0aW9uLlxuXHQgKiBAcHJpdmF0ZVxuXHQgKiBAcGFyYW0ge0FycmF5fSBhcnJheSBUaGUgYXJyYXkgdG8gaXRlcmF0ZSBvdmVyLlxuXHQgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdGhhdCBnZXRzIGNhbGxlZCBmb3IgZXZlcnkgYXJyYXlcblx0ICogaXRlbS5cblx0ICogQHJldHVybnMge0FycmF5fSBBIG5ldyBhcnJheSBvZiB2YWx1ZXMgcmV0dXJuZWQgYnkgdGhlIGNhbGxiYWNrIGZ1bmN0aW9uLlxuXHQgKi9cblx0ZnVuY3Rpb24gbWFwKGFycmF5LCBmbikge1xuXHRcdHZhciBsZW5ndGggPSBhcnJheS5sZW5ndGg7XG5cdFx0dmFyIHJlc3VsdCA9IFtdO1xuXHRcdHdoaWxlIChsZW5ndGgtLSkge1xuXHRcdFx0cmVzdWx0W2xlbmd0aF0gPSBmbihhcnJheVtsZW5ndGhdKTtcblx0XHR9XG5cdFx0cmV0dXJuIHJlc3VsdDtcblx0fVxuXG5cdC8qKlxuXHQgKiBBIHNpbXBsZSBgQXJyYXkjbWFwYC1saWtlIHdyYXBwZXIgdG8gd29yayB3aXRoIGRvbWFpbiBuYW1lIHN0cmluZ3Mgb3IgZW1haWxcblx0ICogYWRkcmVzc2VzLlxuXHQgKiBAcHJpdmF0ZVxuXHQgKiBAcGFyYW0ge1N0cmluZ30gZG9tYWluIFRoZSBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzLlxuXHQgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBUaGUgZnVuY3Rpb24gdGhhdCBnZXRzIGNhbGxlZCBmb3IgZXZlcnlcblx0ICogY2hhcmFjdGVyLlxuXHQgKiBAcmV0dXJucyB7QXJyYXl9IEEgbmV3IHN0cmluZyBvZiBjaGFyYWN0ZXJzIHJldHVybmVkIGJ5IHRoZSBjYWxsYmFja1xuXHQgKiBmdW5jdGlvbi5cblx0ICovXG5cdGZ1bmN0aW9uIG1hcERvbWFpbihzdHJpbmcsIGZuKSB7XG5cdFx0dmFyIHBhcnRzID0gc3RyaW5nLnNwbGl0KCdAJyk7XG5cdFx0dmFyIHJlc3VsdCA9ICcnO1xuXHRcdGlmIChwYXJ0cy5sZW5ndGggPiAxKSB7XG5cdFx0XHQvLyBJbiBlbWFpbCBhZGRyZXNzZXMsIG9ubHkgdGhlIGRvbWFpbiBuYW1lIHNob3VsZCBiZSBwdW55Y29kZWQuIExlYXZlXG5cdFx0XHQvLyB0aGUgbG9jYWwgcGFydCAoaS5lLiBldmVyeXRoaW5nIHVwIHRvIGBAYCkgaW50YWN0LlxuXHRcdFx0cmVzdWx0ID0gcGFydHNbMF0gKyAnQCc7XG5cdFx0XHRzdHJpbmcgPSBwYXJ0c1sxXTtcblx0XHR9XG5cdFx0Ly8gQXZvaWQgYHNwbGl0KHJlZ2V4KWAgZm9yIElFOCBjb21wYXRpYmlsaXR5LiBTZWUgIzE3LlxuXHRcdHN0cmluZyA9IHN0cmluZy5yZXBsYWNlKHJlZ2V4U2VwYXJhdG9ycywgJ1xceDJFJyk7XG5cdFx0dmFyIGxhYmVscyA9IHN0cmluZy5zcGxpdCgnLicpO1xuXHRcdHZhciBlbmNvZGVkID0gbWFwKGxhYmVscywgZm4pLmpvaW4oJy4nKTtcblx0XHRyZXR1cm4gcmVzdWx0ICsgZW5jb2RlZDtcblx0fVxuXG5cdC8qKlxuXHQgKiBDcmVhdGVzIGFuIGFycmF5IGNvbnRhaW5pbmcgdGhlIG51bWVyaWMgY29kZSBwb2ludHMgb2YgZWFjaCBVbmljb2RlXG5cdCAqIGNoYXJhY3RlciBpbiB0aGUgc3RyaW5nLiBXaGlsZSBKYXZhU2NyaXB0IHVzZXMgVUNTLTIgaW50ZXJuYWxseSxcblx0ICogdGhpcyBmdW5jdGlvbiB3aWxsIGNvbnZlcnQgYSBwYWlyIG9mIHN1cnJvZ2F0ZSBoYWx2ZXMgKGVhY2ggb2Ygd2hpY2hcblx0ICogVUNTLTIgZXhwb3NlcyBhcyBzZXBhcmF0ZSBjaGFyYWN0ZXJzKSBpbnRvIGEgc2luZ2xlIGNvZGUgcG9pbnQsXG5cdCAqIG1hdGNoaW5nIFVURi0xNi5cblx0ICogQHNlZSBgcHVueWNvZGUudWNzMi5lbmNvZGVgXG5cdCAqIEBzZWUgPGh0dHBzOi8vbWF0aGlhc2J5bmVucy5iZS9ub3Rlcy9qYXZhc2NyaXB0LWVuY29kaW5nPlxuXHQgKiBAbWVtYmVyT2YgcHVueWNvZGUudWNzMlxuXHQgKiBAbmFtZSBkZWNvZGVcblx0ICogQHBhcmFtIHtTdHJpbmd9IHN0cmluZyBUaGUgVW5pY29kZSBpbnB1dCBzdHJpbmcgKFVDUy0yKS5cblx0ICogQHJldHVybnMge0FycmF5fSBUaGUgbmV3IGFycmF5IG9mIGNvZGUgcG9pbnRzLlxuXHQgKi9cblx0ZnVuY3Rpb24gdWNzMmRlY29kZShzdHJpbmcpIHtcblx0XHR2YXIgb3V0cHV0ID0gW10sXG5cdFx0ICAgIGNvdW50ZXIgPSAwLFxuXHRcdCAgICBsZW5ndGggPSBzdHJpbmcubGVuZ3RoLFxuXHRcdCAgICB2YWx1ZSxcblx0XHQgICAgZXh0cmE7XG5cdFx0d2hpbGUgKGNvdW50ZXIgPCBsZW5ndGgpIHtcblx0XHRcdHZhbHVlID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcblx0XHRcdGlmICh2YWx1ZSA+PSAweEQ4MDAgJiYgdmFsdWUgPD0gMHhEQkZGICYmIGNvdW50ZXIgPCBsZW5ndGgpIHtcblx0XHRcdFx0Ly8gaGlnaCBzdXJyb2dhdGUsIGFuZCB0aGVyZSBpcyBhIG5leHQgY2hhcmFjdGVyXG5cdFx0XHRcdGV4dHJhID0gc3RyaW5nLmNoYXJDb2RlQXQoY291bnRlcisrKTtcblx0XHRcdFx0aWYgKChleHRyYSAmIDB4RkMwMCkgPT0gMHhEQzAwKSB7IC8vIGxvdyBzdXJyb2dhdGVcblx0XHRcdFx0XHRvdXRwdXQucHVzaCgoKHZhbHVlICYgMHgzRkYpIDw8IDEwKSArIChleHRyYSAmIDB4M0ZGKSArIDB4MTAwMDApO1xuXHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdC8vIHVubWF0Y2hlZCBzdXJyb2dhdGU7IG9ubHkgYXBwZW5kIHRoaXMgY29kZSB1bml0LCBpbiBjYXNlIHRoZSBuZXh0XG5cdFx0XHRcdFx0Ly8gY29kZSB1bml0IGlzIHRoZSBoaWdoIHN1cnJvZ2F0ZSBvZiBhIHN1cnJvZ2F0ZSBwYWlyXG5cdFx0XHRcdFx0b3V0cHV0LnB1c2godmFsdWUpO1xuXHRcdFx0XHRcdGNvdW50ZXItLTtcblx0XHRcdFx0fVxuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0b3V0cHV0LnB1c2godmFsdWUpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gb3V0cHV0O1xuXHR9XG5cblx0LyoqXG5cdCAqIENyZWF0ZXMgYSBzdHJpbmcgYmFzZWQgb24gYW4gYXJyYXkgb2YgbnVtZXJpYyBjb2RlIHBvaW50cy5cblx0ICogQHNlZSBgcHVueWNvZGUudWNzMi5kZWNvZGVgXG5cdCAqIEBtZW1iZXJPZiBwdW55Y29kZS51Y3MyXG5cdCAqIEBuYW1lIGVuY29kZVxuXHQgKiBAcGFyYW0ge0FycmF5fSBjb2RlUG9pbnRzIFRoZSBhcnJheSBvZiBudW1lcmljIGNvZGUgcG9pbnRzLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgbmV3IFVuaWNvZGUgc3RyaW5nIChVQ1MtMikuXG5cdCAqL1xuXHRmdW5jdGlvbiB1Y3MyZW5jb2RlKGFycmF5KSB7XG5cdFx0cmV0dXJuIG1hcChhcnJheSwgZnVuY3Rpb24odmFsdWUpIHtcblx0XHRcdHZhciBvdXRwdXQgPSAnJztcblx0XHRcdGlmICh2YWx1ZSA+IDB4RkZGRikge1xuXHRcdFx0XHR2YWx1ZSAtPSAweDEwMDAwO1xuXHRcdFx0XHRvdXRwdXQgKz0gc3RyaW5nRnJvbUNoYXJDb2RlKHZhbHVlID4+PiAxMCAmIDB4M0ZGIHwgMHhEODAwKTtcblx0XHRcdFx0dmFsdWUgPSAweERDMDAgfCB2YWx1ZSAmIDB4M0ZGO1xuXHRcdFx0fVxuXHRcdFx0b3V0cHV0ICs9IHN0cmluZ0Zyb21DaGFyQ29kZSh2YWx1ZSk7XG5cdFx0XHRyZXR1cm4gb3V0cHV0O1xuXHRcdH0pLmpvaW4oJycpO1xuXHR9XG5cblx0LyoqXG5cdCAqIENvbnZlcnRzIGEgYmFzaWMgY29kZSBwb2ludCBpbnRvIGEgZGlnaXQvaW50ZWdlci5cblx0ICogQHNlZSBgZGlnaXRUb0Jhc2ljKClgXG5cdCAqIEBwcml2YXRlXG5cdCAqIEBwYXJhbSB7TnVtYmVyfSBjb2RlUG9pbnQgVGhlIGJhc2ljIG51bWVyaWMgY29kZSBwb2ludCB2YWx1ZS5cblx0ICogQHJldHVybnMge051bWJlcn0gVGhlIG51bWVyaWMgdmFsdWUgb2YgYSBiYXNpYyBjb2RlIHBvaW50IChmb3IgdXNlIGluXG5cdCAqIHJlcHJlc2VudGluZyBpbnRlZ2VycykgaW4gdGhlIHJhbmdlIGAwYCB0byBgYmFzZSAtIDFgLCBvciBgYmFzZWAgaWZcblx0ICogdGhlIGNvZGUgcG9pbnQgZG9lcyBub3QgcmVwcmVzZW50IGEgdmFsdWUuXG5cdCAqL1xuXHRmdW5jdGlvbiBiYXNpY1RvRGlnaXQoY29kZVBvaW50KSB7XG5cdFx0aWYgKGNvZGVQb2ludCAtIDQ4IDwgMTApIHtcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSAyMjtcblx0XHR9XG5cdFx0aWYgKGNvZGVQb2ludCAtIDY1IDwgMjYpIHtcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSA2NTtcblx0XHR9XG5cdFx0aWYgKGNvZGVQb2ludCAtIDk3IDwgMjYpIHtcblx0XHRcdHJldHVybiBjb2RlUG9pbnQgLSA5Nztcblx0XHR9XG5cdFx0cmV0dXJuIGJhc2U7XG5cdH1cblxuXHQvKipcblx0ICogQ29udmVydHMgYSBkaWdpdC9pbnRlZ2VyIGludG8gYSBiYXNpYyBjb2RlIHBvaW50LlxuXHQgKiBAc2VlIGBiYXNpY1RvRGlnaXQoKWBcblx0ICogQHByaXZhdGVcblx0ICogQHBhcmFtIHtOdW1iZXJ9IGRpZ2l0IFRoZSBudW1lcmljIHZhbHVlIG9mIGEgYmFzaWMgY29kZSBwb2ludC5cblx0ICogQHJldHVybnMge051bWJlcn0gVGhlIGJhc2ljIGNvZGUgcG9pbnQgd2hvc2UgdmFsdWUgKHdoZW4gdXNlZCBmb3Jcblx0ICogcmVwcmVzZW50aW5nIGludGVnZXJzKSBpcyBgZGlnaXRgLCB3aGljaCBuZWVkcyB0byBiZSBpbiB0aGUgcmFuZ2Vcblx0ICogYDBgIHRvIGBiYXNlIC0gMWAuIElmIGBmbGFnYCBpcyBub24temVybywgdGhlIHVwcGVyY2FzZSBmb3JtIGlzXG5cdCAqIHVzZWQ7IGVsc2UsIHRoZSBsb3dlcmNhc2UgZm9ybSBpcyB1c2VkLiBUaGUgYmVoYXZpb3IgaXMgdW5kZWZpbmVkXG5cdCAqIGlmIGBmbGFnYCBpcyBub24temVybyBhbmQgYGRpZ2l0YCBoYXMgbm8gdXBwZXJjYXNlIGZvcm0uXG5cdCAqL1xuXHRmdW5jdGlvbiBkaWdpdFRvQmFzaWMoZGlnaXQsIGZsYWcpIHtcblx0XHQvLyAgMC4uMjUgbWFwIHRvIEFTQ0lJIGEuLnogb3IgQS4uWlxuXHRcdC8vIDI2Li4zNSBtYXAgdG8gQVNDSUkgMC4uOVxuXHRcdHJldHVybiBkaWdpdCArIDIyICsgNzUgKiAoZGlnaXQgPCAyNikgLSAoKGZsYWcgIT0gMCkgPDwgNSk7XG5cdH1cblxuXHQvKipcblx0ICogQmlhcyBhZGFwdGF0aW9uIGZ1bmN0aW9uIGFzIHBlciBzZWN0aW9uIDMuNCBvZiBSRkMgMzQ5Mi5cblx0ICogaHR0cDovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjMzQ5MiNzZWN0aW9uLTMuNFxuXHQgKiBAcHJpdmF0ZVxuXHQgKi9cblx0ZnVuY3Rpb24gYWRhcHQoZGVsdGEsIG51bVBvaW50cywgZmlyc3RUaW1lKSB7XG5cdFx0dmFyIGsgPSAwO1xuXHRcdGRlbHRhID0gZmlyc3RUaW1lID8gZmxvb3IoZGVsdGEgLyBkYW1wKSA6IGRlbHRhID4+IDE7XG5cdFx0ZGVsdGEgKz0gZmxvb3IoZGVsdGEgLyBudW1Qb2ludHMpO1xuXHRcdGZvciAoLyogbm8gaW5pdGlhbGl6YXRpb24gKi87IGRlbHRhID4gYmFzZU1pbnVzVE1pbiAqIHRNYXggPj4gMTsgayArPSBiYXNlKSB7XG5cdFx0XHRkZWx0YSA9IGZsb29yKGRlbHRhIC8gYmFzZU1pbnVzVE1pbik7XG5cdFx0fVxuXHRcdHJldHVybiBmbG9vcihrICsgKGJhc2VNaW51c1RNaW4gKyAxKSAqIGRlbHRhIC8gKGRlbHRhICsgc2tldykpO1xuXHR9XG5cblx0LyoqXG5cdCAqIENvbnZlcnRzIGEgUHVueWNvZGUgc3RyaW5nIG9mIEFTQ0lJLW9ubHkgc3ltYm9scyB0byBhIHN0cmluZyBvZiBVbmljb2RlXG5cdCAqIHN5bWJvbHMuXG5cdCAqIEBtZW1iZXJPZiBwdW55Y29kZVxuXHQgKiBAcGFyYW0ge1N0cmluZ30gaW5wdXQgVGhlIFB1bnljb2RlIHN0cmluZyBvZiBBU0NJSS1vbmx5IHN5bWJvbHMuXG5cdCAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSByZXN1bHRpbmcgc3RyaW5nIG9mIFVuaWNvZGUgc3ltYm9scy5cblx0ICovXG5cdGZ1bmN0aW9uIGRlY29kZShpbnB1dCkge1xuXHRcdC8vIERvbid0IHVzZSBVQ1MtMlxuXHRcdHZhciBvdXRwdXQgPSBbXSxcblx0XHQgICAgaW5wdXRMZW5ndGggPSBpbnB1dC5sZW5ndGgsXG5cdFx0ICAgIG91dCxcblx0XHQgICAgaSA9IDAsXG5cdFx0ICAgIG4gPSBpbml0aWFsTixcblx0XHQgICAgYmlhcyA9IGluaXRpYWxCaWFzLFxuXHRcdCAgICBiYXNpYyxcblx0XHQgICAgaixcblx0XHQgICAgaW5kZXgsXG5cdFx0ICAgIG9sZGksXG5cdFx0ICAgIHcsXG5cdFx0ICAgIGssXG5cdFx0ICAgIGRpZ2l0LFxuXHRcdCAgICB0LFxuXHRcdCAgICAvKiogQ2FjaGVkIGNhbGN1bGF0aW9uIHJlc3VsdHMgKi9cblx0XHQgICAgYmFzZU1pbnVzVDtcblxuXHRcdC8vIEhhbmRsZSB0aGUgYmFzaWMgY29kZSBwb2ludHM6IGxldCBgYmFzaWNgIGJlIHRoZSBudW1iZXIgb2YgaW5wdXQgY29kZVxuXHRcdC8vIHBvaW50cyBiZWZvcmUgdGhlIGxhc3QgZGVsaW1pdGVyLCBvciBgMGAgaWYgdGhlcmUgaXMgbm9uZSwgdGhlbiBjb3B5XG5cdFx0Ly8gdGhlIGZpcnN0IGJhc2ljIGNvZGUgcG9pbnRzIHRvIHRoZSBvdXRwdXQuXG5cblx0XHRiYXNpYyA9IGlucHV0Lmxhc3RJbmRleE9mKGRlbGltaXRlcik7XG5cdFx0aWYgKGJhc2ljIDwgMCkge1xuXHRcdFx0YmFzaWMgPSAwO1xuXHRcdH1cblxuXHRcdGZvciAoaiA9IDA7IGogPCBiYXNpYzsgKytqKSB7XG5cdFx0XHQvLyBpZiBpdCdzIG5vdCBhIGJhc2ljIGNvZGUgcG9pbnRcblx0XHRcdGlmIChpbnB1dC5jaGFyQ29kZUF0KGopID49IDB4ODApIHtcblx0XHRcdFx0ZXJyb3IoJ25vdC1iYXNpYycpO1xuXHRcdFx0fVxuXHRcdFx0b3V0cHV0LnB1c2goaW5wdXQuY2hhckNvZGVBdChqKSk7XG5cdFx0fVxuXG5cdFx0Ly8gTWFpbiBkZWNvZGluZyBsb29wOiBzdGFydCBqdXN0IGFmdGVyIHRoZSBsYXN0IGRlbGltaXRlciBpZiBhbnkgYmFzaWMgY29kZVxuXHRcdC8vIHBvaW50cyB3ZXJlIGNvcGllZDsgc3RhcnQgYXQgdGhlIGJlZ2lubmluZyBvdGhlcndpc2UuXG5cblx0XHRmb3IgKGluZGV4ID0gYmFzaWMgPiAwID8gYmFzaWMgKyAxIDogMDsgaW5kZXggPCBpbnB1dExlbmd0aDsgLyogbm8gZmluYWwgZXhwcmVzc2lvbiAqLykge1xuXG5cdFx0XHQvLyBgaW5kZXhgIGlzIHRoZSBpbmRleCBvZiB0aGUgbmV4dCBjaGFyYWN0ZXIgdG8gYmUgY29uc3VtZWQuXG5cdFx0XHQvLyBEZWNvZGUgYSBnZW5lcmFsaXplZCB2YXJpYWJsZS1sZW5ndGggaW50ZWdlciBpbnRvIGBkZWx0YWAsXG5cdFx0XHQvLyB3aGljaCBnZXRzIGFkZGVkIHRvIGBpYC4gVGhlIG92ZXJmbG93IGNoZWNraW5nIGlzIGVhc2llclxuXHRcdFx0Ly8gaWYgd2UgaW5jcmVhc2UgYGlgIGFzIHdlIGdvLCB0aGVuIHN1YnRyYWN0IG9mZiBpdHMgc3RhcnRpbmdcblx0XHRcdC8vIHZhbHVlIGF0IHRoZSBlbmQgdG8gb2J0YWluIGBkZWx0YWAuXG5cdFx0XHRmb3IgKG9sZGkgPSBpLCB3ID0gMSwgayA9IGJhc2U7IC8qIG5vIGNvbmRpdGlvbiAqLzsgayArPSBiYXNlKSB7XG5cblx0XHRcdFx0aWYgKGluZGV4ID49IGlucHV0TGVuZ3RoKSB7XG5cdFx0XHRcdFx0ZXJyb3IoJ2ludmFsaWQtaW5wdXQnKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGRpZ2l0ID0gYmFzaWNUb0RpZ2l0KGlucHV0LmNoYXJDb2RlQXQoaW5kZXgrKykpO1xuXG5cdFx0XHRcdGlmIChkaWdpdCA+PSBiYXNlIHx8IGRpZ2l0ID4gZmxvb3IoKG1heEludCAtIGkpIC8gdykpIHtcblx0XHRcdFx0XHRlcnJvcignb3ZlcmZsb3cnKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdGkgKz0gZGlnaXQgKiB3O1xuXHRcdFx0XHR0ID0gayA8PSBiaWFzID8gdE1pbiA6IChrID49IGJpYXMgKyB0TWF4ID8gdE1heCA6IGsgLSBiaWFzKTtcblxuXHRcdFx0XHRpZiAoZGlnaXQgPCB0KSB7XG5cdFx0XHRcdFx0YnJlYWs7XG5cdFx0XHRcdH1cblxuXHRcdFx0XHRiYXNlTWludXNUID0gYmFzZSAtIHQ7XG5cdFx0XHRcdGlmICh3ID4gZmxvb3IobWF4SW50IC8gYmFzZU1pbnVzVCkpIHtcblx0XHRcdFx0XHRlcnJvcignb3ZlcmZsb3cnKTtcblx0XHRcdFx0fVxuXG5cdFx0XHRcdHcgKj0gYmFzZU1pbnVzVDtcblxuXHRcdFx0fVxuXG5cdFx0XHRvdXQgPSBvdXRwdXQubGVuZ3RoICsgMTtcblx0XHRcdGJpYXMgPSBhZGFwdChpIC0gb2xkaSwgb3V0LCBvbGRpID09IDApO1xuXG5cdFx0XHQvLyBgaWAgd2FzIHN1cHBvc2VkIHRvIHdyYXAgYXJvdW5kIGZyb20gYG91dGAgdG8gYDBgLFxuXHRcdFx0Ly8gaW5jcmVtZW50aW5nIGBuYCBlYWNoIHRpbWUsIHNvIHdlJ2xsIGZpeCB0aGF0IG5vdzpcblx0XHRcdGlmIChmbG9vcihpIC8gb3V0KSA+IG1heEludCAtIG4pIHtcblx0XHRcdFx0ZXJyb3IoJ292ZXJmbG93Jyk7XG5cdFx0XHR9XG5cblx0XHRcdG4gKz0gZmxvb3IoaSAvIG91dCk7XG5cdFx0XHRpICU9IG91dDtcblxuXHRcdFx0Ly8gSW5zZXJ0IGBuYCBhdCBwb3NpdGlvbiBgaWAgb2YgdGhlIG91dHB1dFxuXHRcdFx0b3V0cHV0LnNwbGljZShpKyssIDAsIG4pO1xuXG5cdFx0fVxuXG5cdFx0cmV0dXJuIHVjczJlbmNvZGUob3V0cHV0KTtcblx0fVxuXG5cdC8qKlxuXHQgKiBDb252ZXJ0cyBhIHN0cmluZyBvZiBVbmljb2RlIHN5bWJvbHMgKGUuZy4gYSBkb21haW4gbmFtZSBsYWJlbCkgdG8gYVxuXHQgKiBQdW55Y29kZSBzdHJpbmcgb2YgQVNDSUktb25seSBzeW1ib2xzLlxuXHQgKiBAbWVtYmVyT2YgcHVueWNvZGVcblx0ICogQHBhcmFtIHtTdHJpbmd9IGlucHV0IFRoZSBzdHJpbmcgb2YgVW5pY29kZSBzeW1ib2xzLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgcmVzdWx0aW5nIFB1bnljb2RlIHN0cmluZyBvZiBBU0NJSS1vbmx5IHN5bWJvbHMuXG5cdCAqL1xuXHRmdW5jdGlvbiBlbmNvZGUoaW5wdXQpIHtcblx0XHR2YXIgbixcblx0XHQgICAgZGVsdGEsXG5cdFx0ICAgIGhhbmRsZWRDUENvdW50LFxuXHRcdCAgICBiYXNpY0xlbmd0aCxcblx0XHQgICAgYmlhcyxcblx0XHQgICAgaixcblx0XHQgICAgbSxcblx0XHQgICAgcSxcblx0XHQgICAgayxcblx0XHQgICAgdCxcblx0XHQgICAgY3VycmVudFZhbHVlLFxuXHRcdCAgICBvdXRwdXQgPSBbXSxcblx0XHQgICAgLyoqIGBpbnB1dExlbmd0aGAgd2lsbCBob2xkIHRoZSBudW1iZXIgb2YgY29kZSBwb2ludHMgaW4gYGlucHV0YC4gKi9cblx0XHQgICAgaW5wdXRMZW5ndGgsXG5cdFx0ICAgIC8qKiBDYWNoZWQgY2FsY3VsYXRpb24gcmVzdWx0cyAqL1xuXHRcdCAgICBoYW5kbGVkQ1BDb3VudFBsdXNPbmUsXG5cdFx0ICAgIGJhc2VNaW51c1QsXG5cdFx0ICAgIHFNaW51c1Q7XG5cblx0XHQvLyBDb252ZXJ0IHRoZSBpbnB1dCBpbiBVQ1MtMiB0byBVbmljb2RlXG5cdFx0aW5wdXQgPSB1Y3MyZGVjb2RlKGlucHV0KTtcblxuXHRcdC8vIENhY2hlIHRoZSBsZW5ndGhcblx0XHRpbnB1dExlbmd0aCA9IGlucHV0Lmxlbmd0aDtcblxuXHRcdC8vIEluaXRpYWxpemUgdGhlIHN0YXRlXG5cdFx0biA9IGluaXRpYWxOO1xuXHRcdGRlbHRhID0gMDtcblx0XHRiaWFzID0gaW5pdGlhbEJpYXM7XG5cblx0XHQvLyBIYW5kbGUgdGhlIGJhc2ljIGNvZGUgcG9pbnRzXG5cdFx0Zm9yIChqID0gMDsgaiA8IGlucHV0TGVuZ3RoOyArK2opIHtcblx0XHRcdGN1cnJlbnRWYWx1ZSA9IGlucHV0W2pdO1xuXHRcdFx0aWYgKGN1cnJlbnRWYWx1ZSA8IDB4ODApIHtcblx0XHRcdFx0b3V0cHV0LnB1c2goc3RyaW5nRnJvbUNoYXJDb2RlKGN1cnJlbnRWYWx1ZSkpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGhhbmRsZWRDUENvdW50ID0gYmFzaWNMZW5ndGggPSBvdXRwdXQubGVuZ3RoO1xuXG5cdFx0Ly8gYGhhbmRsZWRDUENvdW50YCBpcyB0aGUgbnVtYmVyIG9mIGNvZGUgcG9pbnRzIHRoYXQgaGF2ZSBiZWVuIGhhbmRsZWQ7XG5cdFx0Ly8gYGJhc2ljTGVuZ3RoYCBpcyB0aGUgbnVtYmVyIG9mIGJhc2ljIGNvZGUgcG9pbnRzLlxuXG5cdFx0Ly8gRmluaXNoIHRoZSBiYXNpYyBzdHJpbmcgLSBpZiBpdCBpcyBub3QgZW1wdHkgLSB3aXRoIGEgZGVsaW1pdGVyXG5cdFx0aWYgKGJhc2ljTGVuZ3RoKSB7XG5cdFx0XHRvdXRwdXQucHVzaChkZWxpbWl0ZXIpO1xuXHRcdH1cblxuXHRcdC8vIE1haW4gZW5jb2RpbmcgbG9vcDpcblx0XHR3aGlsZSAoaGFuZGxlZENQQ291bnQgPCBpbnB1dExlbmd0aCkge1xuXG5cdFx0XHQvLyBBbGwgbm9uLWJhc2ljIGNvZGUgcG9pbnRzIDwgbiBoYXZlIGJlZW4gaGFuZGxlZCBhbHJlYWR5LiBGaW5kIHRoZSBuZXh0XG5cdFx0XHQvLyBsYXJnZXIgb25lOlxuXHRcdFx0Zm9yIChtID0gbWF4SW50LCBqID0gMDsgaiA8IGlucHV0TGVuZ3RoOyArK2opIHtcblx0XHRcdFx0Y3VycmVudFZhbHVlID0gaW5wdXRbal07XG5cdFx0XHRcdGlmIChjdXJyZW50VmFsdWUgPj0gbiAmJiBjdXJyZW50VmFsdWUgPCBtKSB7XG5cdFx0XHRcdFx0bSA9IGN1cnJlbnRWYWx1ZTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHQvLyBJbmNyZWFzZSBgZGVsdGFgIGVub3VnaCB0byBhZHZhbmNlIHRoZSBkZWNvZGVyJ3MgPG4saT4gc3RhdGUgdG8gPG0sMD4sXG5cdFx0XHQvLyBidXQgZ3VhcmQgYWdhaW5zdCBvdmVyZmxvd1xuXHRcdFx0aGFuZGxlZENQQ291bnRQbHVzT25lID0gaGFuZGxlZENQQ291bnQgKyAxO1xuXHRcdFx0aWYgKG0gLSBuID4gZmxvb3IoKG1heEludCAtIGRlbHRhKSAvIGhhbmRsZWRDUENvdW50UGx1c09uZSkpIHtcblx0XHRcdFx0ZXJyb3IoJ292ZXJmbG93Jyk7XG5cdFx0XHR9XG5cblx0XHRcdGRlbHRhICs9IChtIC0gbikgKiBoYW5kbGVkQ1BDb3VudFBsdXNPbmU7XG5cdFx0XHRuID0gbTtcblxuXHRcdFx0Zm9yIChqID0gMDsgaiA8IGlucHV0TGVuZ3RoOyArK2opIHtcblx0XHRcdFx0Y3VycmVudFZhbHVlID0gaW5wdXRbal07XG5cblx0XHRcdFx0aWYgKGN1cnJlbnRWYWx1ZSA8IG4gJiYgKytkZWx0YSA+IG1heEludCkge1xuXHRcdFx0XHRcdGVycm9yKCdvdmVyZmxvdycpO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKGN1cnJlbnRWYWx1ZSA9PSBuKSB7XG5cdFx0XHRcdFx0Ly8gUmVwcmVzZW50IGRlbHRhIGFzIGEgZ2VuZXJhbGl6ZWQgdmFyaWFibGUtbGVuZ3RoIGludGVnZXJcblx0XHRcdFx0XHRmb3IgKHEgPSBkZWx0YSwgayA9IGJhc2U7IC8qIG5vIGNvbmRpdGlvbiAqLzsgayArPSBiYXNlKSB7XG5cdFx0XHRcdFx0XHR0ID0gayA8PSBiaWFzID8gdE1pbiA6IChrID49IGJpYXMgKyB0TWF4ID8gdE1heCA6IGsgLSBiaWFzKTtcblx0XHRcdFx0XHRcdGlmIChxIDwgdCkge1xuXHRcdFx0XHRcdFx0XHRicmVhaztcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdHFNaW51c1QgPSBxIC0gdDtcblx0XHRcdFx0XHRcdGJhc2VNaW51c1QgPSBiYXNlIC0gdDtcblx0XHRcdFx0XHRcdG91dHB1dC5wdXNoKFxuXHRcdFx0XHRcdFx0XHRzdHJpbmdGcm9tQ2hhckNvZGUoZGlnaXRUb0Jhc2ljKHQgKyBxTWludXNUICUgYmFzZU1pbnVzVCwgMCkpXG5cdFx0XHRcdFx0XHQpO1xuXHRcdFx0XHRcdFx0cSA9IGZsb29yKHFNaW51c1QgLyBiYXNlTWludXNUKTtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRvdXRwdXQucHVzaChzdHJpbmdGcm9tQ2hhckNvZGUoZGlnaXRUb0Jhc2ljKHEsIDApKSk7XG5cdFx0XHRcdFx0YmlhcyA9IGFkYXB0KGRlbHRhLCBoYW5kbGVkQ1BDb3VudFBsdXNPbmUsIGhhbmRsZWRDUENvdW50ID09IGJhc2ljTGVuZ3RoKTtcblx0XHRcdFx0XHRkZWx0YSA9IDA7XG5cdFx0XHRcdFx0KytoYW5kbGVkQ1BDb3VudDtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHQrK2RlbHRhO1xuXHRcdFx0KytuO1xuXG5cdFx0fVxuXHRcdHJldHVybiBvdXRwdXQuam9pbignJyk7XG5cdH1cblxuXHQvKipcblx0ICogQ29udmVydHMgYSBQdW55Y29kZSBzdHJpbmcgcmVwcmVzZW50aW5nIGEgZG9tYWluIG5hbWUgb3IgYW4gZW1haWwgYWRkcmVzc1xuXHQgKiB0byBVbmljb2RlLiBPbmx5IHRoZSBQdW55Y29kZWQgcGFydHMgb2YgdGhlIGlucHV0IHdpbGwgYmUgY29udmVydGVkLCBpLmUuXG5cdCAqIGl0IGRvZXNuJ3QgbWF0dGVyIGlmIHlvdSBjYWxsIGl0IG9uIGEgc3RyaW5nIHRoYXQgaGFzIGFscmVhZHkgYmVlblxuXHQgKiBjb252ZXJ0ZWQgdG8gVW5pY29kZS5cblx0ICogQG1lbWJlck9mIHB1bnljb2RlXG5cdCAqIEBwYXJhbSB7U3RyaW5nfSBpbnB1dCBUaGUgUHVueWNvZGVkIGRvbWFpbiBuYW1lIG9yIGVtYWlsIGFkZHJlc3MgdG9cblx0ICogY29udmVydCB0byBVbmljb2RlLlxuXHQgKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgVW5pY29kZSByZXByZXNlbnRhdGlvbiBvZiB0aGUgZ2l2ZW4gUHVueWNvZGVcblx0ICogc3RyaW5nLlxuXHQgKi9cblx0ZnVuY3Rpb24gdG9Vbmljb2RlKGlucHV0KSB7XG5cdFx0cmV0dXJuIG1hcERvbWFpbihpbnB1dCwgZnVuY3Rpb24oc3RyaW5nKSB7XG5cdFx0XHRyZXR1cm4gcmVnZXhQdW55Y29kZS50ZXN0KHN0cmluZylcblx0XHRcdFx0PyBkZWNvZGUoc3RyaW5nLnNsaWNlKDQpLnRvTG93ZXJDYXNlKCkpXG5cdFx0XHRcdDogc3RyaW5nO1xuXHRcdH0pO1xuXHR9XG5cblx0LyoqXG5cdCAqIENvbnZlcnRzIGEgVW5pY29kZSBzdHJpbmcgcmVwcmVzZW50aW5nIGEgZG9tYWluIG5hbWUgb3IgYW4gZW1haWwgYWRkcmVzcyB0b1xuXHQgKiBQdW55Y29kZS4gT25seSB0aGUgbm9uLUFTQ0lJIHBhcnRzIG9mIHRoZSBkb21haW4gbmFtZSB3aWxsIGJlIGNvbnZlcnRlZCxcblx0ICogaS5lLiBpdCBkb2Vzbid0IG1hdHRlciBpZiB5b3UgY2FsbCBpdCB3aXRoIGEgZG9tYWluIHRoYXQncyBhbHJlYWR5IGluXG5cdCAqIEFTQ0lJLlxuXHQgKiBAbWVtYmVyT2YgcHVueWNvZGVcblx0ICogQHBhcmFtIHtTdHJpbmd9IGlucHV0IFRoZSBkb21haW4gbmFtZSBvciBlbWFpbCBhZGRyZXNzIHRvIGNvbnZlcnQsIGFzIGFcblx0ICogVW5pY29kZSBzdHJpbmcuXG5cdCAqIEByZXR1cm5zIHtTdHJpbmd9IFRoZSBQdW55Y29kZSByZXByZXNlbnRhdGlvbiBvZiB0aGUgZ2l2ZW4gZG9tYWluIG5hbWUgb3Jcblx0ICogZW1haWwgYWRkcmVzcy5cblx0ICovXG5cdGZ1bmN0aW9uIHRvQVNDSUkoaW5wdXQpIHtcblx0XHRyZXR1cm4gbWFwRG9tYWluKGlucHV0LCBmdW5jdGlvbihzdHJpbmcpIHtcblx0XHRcdHJldHVybiByZWdleE5vbkFTQ0lJLnRlc3Qoc3RyaW5nKVxuXHRcdFx0XHQ/ICd4bi0tJyArIGVuY29kZShzdHJpbmcpXG5cdFx0XHRcdDogc3RyaW5nO1xuXHRcdH0pO1xuXHR9XG5cblx0LyotLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSovXG5cblx0LyoqIERlZmluZSB0aGUgcHVibGljIEFQSSAqL1xuXHRwdW55Y29kZSA9IHtcblx0XHQvKipcblx0XHQgKiBBIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIGN1cnJlbnQgUHVueWNvZGUuanMgdmVyc2lvbiBudW1iZXIuXG5cdFx0ICogQG1lbWJlck9mIHB1bnljb2RlXG5cdFx0ICogQHR5cGUgU3RyaW5nXG5cdFx0ICovXG5cdFx0J3ZlcnNpb24nOiAnMS4zLjInLFxuXHRcdC8qKlxuXHRcdCAqIEFuIG9iamVjdCBvZiBtZXRob2RzIHRvIGNvbnZlcnQgZnJvbSBKYXZhU2NyaXB0J3MgaW50ZXJuYWwgY2hhcmFjdGVyXG5cdFx0ICogcmVwcmVzZW50YXRpb24gKFVDUy0yKSB0byBVbmljb2RlIGNvZGUgcG9pbnRzLCBhbmQgYmFjay5cblx0XHQgKiBAc2VlIDxodHRwczovL21hdGhpYXNieW5lbnMuYmUvbm90ZXMvamF2YXNjcmlwdC1lbmNvZGluZz5cblx0XHQgKiBAbWVtYmVyT2YgcHVueWNvZGVcblx0XHQgKiBAdHlwZSBPYmplY3Rcblx0XHQgKi9cblx0XHQndWNzMic6IHtcblx0XHRcdCdkZWNvZGUnOiB1Y3MyZGVjb2RlLFxuXHRcdFx0J2VuY29kZSc6IHVjczJlbmNvZGVcblx0XHR9LFxuXHRcdCdkZWNvZGUnOiBkZWNvZGUsXG5cdFx0J2VuY29kZSc6IGVuY29kZSxcblx0XHQndG9BU0NJSSc6IHRvQVNDSUksXG5cdFx0J3RvVW5pY29kZSc6IHRvVW5pY29kZVxuXHR9O1xuXG5cdC8qKiBFeHBvc2UgYHB1bnljb2RlYCAqL1xuXHQvLyBTb21lIEFNRCBidWlsZCBvcHRpbWl6ZXJzLCBsaWtlIHIuanMsIGNoZWNrIGZvciBzcGVjaWZpYyBjb25kaXRpb24gcGF0dGVybnNcblx0Ly8gbGlrZSB0aGUgZm9sbG93aW5nOlxuXHRpZiAoXG5cdFx0dHlwZW9mIGRlZmluZSA9PSAnZnVuY3Rpb24nICYmXG5cdFx0dHlwZW9mIGRlZmluZS5hbWQgPT0gJ29iamVjdCcgJiZcblx0XHRkZWZpbmUuYW1kXG5cdCkge1xuXHRcdGRlZmluZSgncHVueWNvZGUnLCBmdW5jdGlvbigpIHtcblx0XHRcdHJldHVybiBwdW55Y29kZTtcblx0XHR9KTtcblx0fSBlbHNlIGlmIChmcmVlRXhwb3J0cyAmJiBmcmVlTW9kdWxlKSB7XG5cdFx0aWYgKG1vZHVsZS5leHBvcnRzID09IGZyZWVFeHBvcnRzKSB7IC8vIGluIE5vZGUuanMgb3IgUmluZ29KUyB2MC44LjArXG5cdFx0XHRmcmVlTW9kdWxlLmV4cG9ydHMgPSBwdW55Y29kZTtcblx0XHR9IGVsc2UgeyAvLyBpbiBOYXJ3aGFsIG9yIFJpbmdvSlMgdjAuNy4wLVxuXHRcdFx0Zm9yIChrZXkgaW4gcHVueWNvZGUpIHtcblx0XHRcdFx0cHVueWNvZGUuaGFzT3duUHJvcGVydHkoa2V5KSAmJiAoZnJlZUV4cG9ydHNba2V5XSA9IHB1bnljb2RlW2tleV0pO1xuXHRcdFx0fVxuXHRcdH1cblx0fSBlbHNlIHsgLy8gaW4gUmhpbm8gb3IgYSB3ZWIgYnJvd3NlclxuXHRcdHJvb3QucHVueWNvZGUgPSBwdW55Y29kZTtcblx0fVxuXG59KHRoaXMpKTtcbiIsIi8qXG4gKiBxdWFudGl6ZS5qcyBDb3B5cmlnaHQgMjAwOCBOaWNrIFJhYmlub3dpdHpcbiAqIFBvcnRlZCB0byBub2RlLmpzIGJ5IE9saXZpZXIgTGVzbmlja2lcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBNSVQgbGljZW5zZTogaHR0cDovL3d3dy5vcGVuc291cmNlLm9yZy9saWNlbnNlcy9taXQtbGljZW5zZS5waHBcbiAqL1xuXG4vLyBmaWxsIG91dCBhIGNvdXBsZSBwcm90b3ZpcyBkZXBlbmRlbmNpZXNcbi8qXG4gKiBCbG9jayBiZWxvdyBjb3BpZWQgZnJvbSBQcm90b3ZpczogaHR0cDovL21ib3N0b2NrLmdpdGh1Yi5jb20vcHJvdG92aXMvXG4gKiBDb3B5cmlnaHQgMjAxMCBTdGFuZm9yZCBWaXN1YWxpemF0aW9uIEdyb3VwXG4gKiBMaWNlbnNlZCB1bmRlciB0aGUgQlNEIExpY2Vuc2U6IGh0dHA6Ly93d3cub3BlbnNvdXJjZS5vcmcvbGljZW5zZXMvYnNkLWxpY2Vuc2UucGhwXG4gKi9cbmlmICghcHYpIHtcbiAgICB2YXIgcHYgPSB7XG4gICAgICAgIG1hcDogZnVuY3Rpb24oYXJyYXksIGYpIHtcbiAgICAgICAgICAgIHZhciBvID0ge307XG4gICAgICAgICAgICByZXR1cm4gZiA/IGFycmF5Lm1hcChmdW5jdGlvbihkLCBpKSB7XG4gICAgICAgICAgICAgICAgby5pbmRleCA9IGk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGYuY2FsbChvLCBkKTtcbiAgICAgICAgICAgIH0pIDogYXJyYXkuc2xpY2UoKTtcbiAgICAgICAgfSxcbiAgICAgICAgbmF0dXJhbE9yZGVyOiBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICByZXR1cm4gKGEgPCBiKSA/IC0xIDogKChhID4gYikgPyAxIDogMCk7XG4gICAgICAgIH0sXG4gICAgICAgIHN1bTogZnVuY3Rpb24oYXJyYXksIGYpIHtcbiAgICAgICAgICAgIHZhciBvID0ge307XG4gICAgICAgICAgICByZXR1cm4gYXJyYXkucmVkdWNlKGYgPyBmdW5jdGlvbihwLCBkLCBpKSB7XG4gICAgICAgICAgICAgICAgby5pbmRleCA9IGk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHAgKyBmLmNhbGwobywgZCk7XG4gICAgICAgICAgICB9IDogZnVuY3Rpb24ocCwgZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBwICsgZDtcbiAgICAgICAgICAgIH0sIDApO1xuICAgICAgICB9LFxuICAgICAgICBtYXg6IGZ1bmN0aW9uKGFycmF5LCBmKSB7XG4gICAgICAgICAgICByZXR1cm4gTWF0aC5tYXguYXBwbHkobnVsbCwgZiA/IHB2Lm1hcChhcnJheSwgZikgOiBhcnJheSk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cbi8qKlxuICogQmFzaWMgSmF2YXNjcmlwdCBwb3J0IG9mIHRoZSBNTUNRIChtb2RpZmllZCBtZWRpYW4gY3V0IHF1YW50aXphdGlvbilcbiAqIGFsZ29yaXRobSBmcm9tIHRoZSBMZXB0b25pY2EgbGlicmFyeSAoaHR0cDovL3d3dy5sZXB0b25pY2EuY29tLykuXG4gKiBSZXR1cm5zIGEgY29sb3IgbWFwIHlvdSBjYW4gdXNlIHRvIG1hcCBvcmlnaW5hbCBwaXhlbHMgdG8gdGhlIHJlZHVjZWRcbiAqIHBhbGV0dGUuIFN0aWxsIGEgd29yayBpbiBwcm9ncmVzcy5cbiAqIFxuICogQGF1dGhvciBOaWNrIFJhYmlub3dpdHpcbiAqIEBleGFtcGxlXG4gXG4vLyBhcnJheSBvZiBwaXhlbHMgYXMgW1IsRyxCXSBhcnJheXNcbnZhciBteVBpeGVscyA9IFtbMTkwLDE5NywxOTBdLCBbMjAyLDIwNCwyMDBdLCBbMjA3LDIxNCwyMTBdLCBbMjExLDIxNCwyMTFdLCBbMjA1LDIwNywyMDddXG4gICAgICAgICAgICAgICAgLy8gZXRjXG4gICAgICAgICAgICAgICAgXTtcbnZhciBtYXhDb2xvcnMgPSA0O1xuIFxudmFyIGNtYXAgPSBNTUNRLnF1YW50aXplKG15UGl4ZWxzLCBtYXhDb2xvcnMpO1xudmFyIG5ld1BhbGV0dGUgPSBjbWFwLnBhbGV0dGUoKTtcbnZhciBuZXdQaXhlbHMgPSBteVBpeGVscy5tYXAoZnVuY3Rpb24ocCkgeyBcbiAgICByZXR1cm4gY21hcC5tYXAocCk7IFxufSk7XG4gXG4gKi9cbnZhciBNTUNRID0gKGZ1bmN0aW9uKCkge1xuICAgIC8vIHByaXZhdGUgY29uc3RhbnRzXG4gICAgdmFyIHNpZ2JpdHMgPSA1LFxuICAgICAgICByc2hpZnQgPSA4IC0gc2lnYml0cyxcbiAgICAgICAgbWF4SXRlcmF0aW9ucyA9IDEwMDAsXG4gICAgICAgIGZyYWN0QnlQb3B1bGF0aW9ucyA9IDAuNzU7XG5cbiAgICAvLyBnZXQgcmVkdWNlZC1zcGFjZSBjb2xvciBpbmRleCBmb3IgYSBwaXhlbFxuXG4gICAgZnVuY3Rpb24gZ2V0Q29sb3JJbmRleChyLCBnLCBiKSB7XG4gICAgICAgIHJldHVybiAociA8PCAoMiAqIHNpZ2JpdHMpKSArIChnIDw8IHNpZ2JpdHMpICsgYjtcbiAgICB9XG5cbiAgICAvLyBTaW1wbGUgcHJpb3JpdHkgcXVldWVcblxuICAgIGZ1bmN0aW9uIFBRdWV1ZShjb21wYXJhdG9yKSB7XG4gICAgICAgIHZhciBjb250ZW50cyA9IFtdLFxuICAgICAgICAgICAgc29ydGVkID0gZmFsc2U7XG5cbiAgICAgICAgZnVuY3Rpb24gc29ydCgpIHtcbiAgICAgICAgICAgIGNvbnRlbnRzLnNvcnQoY29tcGFyYXRvcik7XG4gICAgICAgICAgICBzb3J0ZWQgPSB0cnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHB1c2g6IGZ1bmN0aW9uKG8pIHtcbiAgICAgICAgICAgICAgICBjb250ZW50cy5wdXNoKG8pO1xuICAgICAgICAgICAgICAgIHNvcnRlZCA9IGZhbHNlO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHBlZWs6IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFzb3J0ZWQpIHNvcnQoKTtcbiAgICAgICAgICAgICAgICBpZiAoaW5kZXggPT09IHVuZGVmaW5lZCkgaW5kZXggPSBjb250ZW50cy5sZW5ndGggLSAxO1xuICAgICAgICAgICAgICAgIHJldHVybiBjb250ZW50c1tpbmRleF07XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcG9wOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXNvcnRlZCkgc29ydCgpO1xuICAgICAgICAgICAgICAgIHJldHVybiBjb250ZW50cy5wb3AoKTtcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBzaXplOiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gY29udGVudHMubGVuZ3RoO1xuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIG1hcDogZnVuY3Rpb24oZikge1xuICAgICAgICAgICAgICAgIHJldHVybiBjb250ZW50cy5tYXAoZik7XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGVidWc6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgICAgIGlmICghc29ydGVkKSBzb3J0KCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGNvbnRlbnRzO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgIH1cblxuICAgIC8vIDNkIGNvbG9yIHNwYWNlIGJveFxuXG4gICAgZnVuY3Rpb24gVkJveChyMSwgcjIsIGcxLCBnMiwgYjEsIGIyLCBoaXN0bykge1xuICAgICAgICB2YXIgdmJveCA9IHRoaXM7XG4gICAgICAgIHZib3gucjEgPSByMTtcbiAgICAgICAgdmJveC5yMiA9IHIyO1xuICAgICAgICB2Ym94LmcxID0gZzE7XG4gICAgICAgIHZib3guZzIgPSBnMjtcbiAgICAgICAgdmJveC5iMSA9IGIxO1xuICAgICAgICB2Ym94LmIyID0gYjI7XG4gICAgICAgIHZib3guaGlzdG8gPSBoaXN0bztcbiAgICB9XG4gICAgVkJveC5wcm90b3R5cGUgPSB7XG4gICAgICAgIHZvbHVtZTogZnVuY3Rpb24oZm9yY2UpIHtcbiAgICAgICAgICAgIHZhciB2Ym94ID0gdGhpcztcbiAgICAgICAgICAgIGlmICghdmJveC5fdm9sdW1lIHx8IGZvcmNlKSB7XG4gICAgICAgICAgICAgICAgdmJveC5fdm9sdW1lID0gKCh2Ym94LnIyIC0gdmJveC5yMSArIDEpICogKHZib3guZzIgLSB2Ym94LmcxICsgMSkgKiAodmJveC5iMiAtIHZib3guYjEgKyAxKSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdmJveC5fdm9sdW1lO1xuICAgICAgICB9LFxuICAgICAgICBjb3VudDogZnVuY3Rpb24oZm9yY2UpIHtcbiAgICAgICAgICAgIHZhciB2Ym94ID0gdGhpcyxcbiAgICAgICAgICAgICAgICBoaXN0byA9IHZib3guaGlzdG87XG4gICAgICAgICAgICBpZiAoIXZib3guX2NvdW50X3NldCB8fCBmb3JjZSkge1xuICAgICAgICAgICAgICAgIHZhciBucGl4ID0gMCxcbiAgICAgICAgICAgICAgICAgICAgaSwgaiwgaztcbiAgICAgICAgICAgICAgICBmb3IgKGkgPSB2Ym94LnIxOyBpIDw9IHZib3gucjI7IGkrKykge1xuICAgICAgICAgICAgICAgICAgICBmb3IgKGogPSB2Ym94LmcxOyBqIDw9IHZib3guZzI7IGorKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgZm9yIChrID0gdmJveC5iMTsgayA8PSB2Ym94LmIyOyBrKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgoaSwgaiwgayk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgbnBpeCArPSAoaGlzdG9baW5kZXhdIHx8IDApO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHZib3guX2NvdW50ID0gbnBpeDtcbiAgICAgICAgICAgICAgICB2Ym94Ll9jb3VudF9zZXQgPSB0cnVlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHZib3guX2NvdW50O1xuICAgICAgICB9LFxuICAgICAgICBjb3B5OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIHZhciB2Ym94ID0gdGhpcztcbiAgICAgICAgICAgIHJldHVybiBuZXcgVkJveCh2Ym94LnIxLCB2Ym94LnIyLCB2Ym94LmcxLCB2Ym94LmcyLCB2Ym94LmIxLCB2Ym94LmIyLCB2Ym94Lmhpc3RvKTtcbiAgICAgICAgfSxcbiAgICAgICAgYXZnOiBmdW5jdGlvbihmb3JjZSkge1xuICAgICAgICAgICAgdmFyIHZib3ggPSB0aGlzLFxuICAgICAgICAgICAgICAgIGhpc3RvID0gdmJveC5oaXN0bztcbiAgICAgICAgICAgIGlmICghdmJveC5fYXZnIHx8IGZvcmNlKSB7XG4gICAgICAgICAgICAgICAgdmFyIG50b3QgPSAwLFxuICAgICAgICAgICAgICAgICAgICBtdWx0ID0gMSA8PCAoOCAtIHNpZ2JpdHMpLFxuICAgICAgICAgICAgICAgICAgICByc3VtID0gMCxcbiAgICAgICAgICAgICAgICAgICAgZ3N1bSA9IDAsXG4gICAgICAgICAgICAgICAgICAgIGJzdW0gPSAwLFxuICAgICAgICAgICAgICAgICAgICBodmFsLFxuICAgICAgICAgICAgICAgICAgICBpLCBqLCBrLCBoaXN0b2luZGV4O1xuICAgICAgICAgICAgICAgIGZvciAoaSA9IHZib3gucjE7IGkgPD0gdmJveC5yMjsgaSsrKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoaiA9IHZib3guZzE7IGogPD0gdmJveC5nMjsgaisrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBmb3IgKGsgPSB2Ym94LmIxOyBrIDw9IHZib3guYjI7IGsrKykge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGhpc3RvaW5kZXggPSBnZXRDb2xvckluZGV4KGksIGosIGspO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGh2YWwgPSBoaXN0b1toaXN0b2luZGV4XSB8fCAwO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIG50b3QgKz0gaHZhbDtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByc3VtICs9IChodmFsICogKGkgKyAwLjUpICogbXVsdCk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZ3N1bSArPSAoaHZhbCAqIChqICsgMC41KSAqIG11bHQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGJzdW0gKz0gKGh2YWwgKiAoayArIDAuNSkgKiBtdWx0KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobnRvdCkge1xuICAgICAgICAgICAgICAgICAgICB2Ym94Ll9hdmcgPSBbfn4ocnN1bSAvIG50b3QpLCB+fiAoZ3N1bSAvIG50b3QpLCB+fiAoYnN1bSAvIG50b3QpXTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvL2NvbnNvbGUubG9nKCdlbXB0eSBib3gnKTtcbiAgICAgICAgICAgICAgICAgICAgdmJveC5fYXZnID0gW35+KG11bHQgKiAodmJveC5yMSArIHZib3gucjIgKyAxKSAvIDIpLCB+fiAobXVsdCAqICh2Ym94LmcxICsgdmJveC5nMiArIDEpIC8gMiksIH5+IChtdWx0ICogKHZib3guYjEgKyB2Ym94LmIyICsgMSkgLyAyKV07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHZib3guX2F2ZztcbiAgICAgICAgfSxcbiAgICAgICAgY29udGFpbnM6IGZ1bmN0aW9uKHBpeGVsKSB7XG4gICAgICAgICAgICB2YXIgdmJveCA9IHRoaXMsXG4gICAgICAgICAgICAgICAgcnZhbCA9IHBpeGVsWzBdID4+IHJzaGlmdDtcbiAgICAgICAgICAgIGd2YWwgPSBwaXhlbFsxXSA+PiByc2hpZnQ7XG4gICAgICAgICAgICBidmFsID0gcGl4ZWxbMl0gPj4gcnNoaWZ0O1xuICAgICAgICAgICAgcmV0dXJuIChydmFsID49IHZib3gucjEgJiYgcnZhbCA8PSB2Ym94LnIyICYmXG4gICAgICAgICAgICAgICAgZ3ZhbCA+PSB2Ym94LmcxICYmIGd2YWwgPD0gdmJveC5nMiAmJlxuICAgICAgICAgICAgICAgIGJ2YWwgPj0gdmJveC5iMSAmJiBidmFsIDw9IHZib3guYjIpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIC8vIENvbG9yIG1hcFxuXG4gICAgZnVuY3Rpb24gQ01hcCgpIHtcbiAgICAgICAgdGhpcy52Ym94ZXMgPSBuZXcgUFF1ZXVlKGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgIHJldHVybiBwdi5uYXR1cmFsT3JkZXIoXG4gICAgICAgICAgICAgICAgYS52Ym94LmNvdW50KCkgKiBhLnZib3gudm9sdW1lKCksXG4gICAgICAgICAgICAgICAgYi52Ym94LmNvdW50KCkgKiBiLnZib3gudm9sdW1lKClcbiAgICAgICAgICAgIClcbiAgICAgICAgfSk7O1xuICAgIH1cbiAgICBDTWFwLnByb3RvdHlwZSA9IHtcbiAgICAgICAgcHVzaDogZnVuY3Rpb24odmJveCkge1xuICAgICAgICAgICAgdGhpcy52Ym94ZXMucHVzaCh7XG4gICAgICAgICAgICAgICAgdmJveDogdmJveCxcbiAgICAgICAgICAgICAgICBjb2xvcjogdmJveC5hdmcoKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sXG4gICAgICAgIHBhbGV0dGU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmJveGVzLm1hcChmdW5jdGlvbih2Yikge1xuICAgICAgICAgICAgICAgIHJldHVybiB2Yi5jb2xvclxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sXG4gICAgICAgIHNpemU6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudmJveGVzLnNpemUoKTtcbiAgICAgICAgfSxcbiAgICAgICAgbWFwOiBmdW5jdGlvbihjb2xvcikge1xuICAgICAgICAgICAgdmFyIHZib3hlcyA9IHRoaXMudmJveGVzO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB2Ym94ZXMuc2l6ZSgpOyBpKyspIHtcbiAgICAgICAgICAgICAgICBpZiAodmJveGVzLnBlZWsoaSkudmJveC5jb250YWlucyhjb2xvcikpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHZib3hlcy5wZWVrKGkpLmNvbG9yO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLm5lYXJlc3QoY29sb3IpO1xuICAgICAgICB9LFxuICAgICAgICBuZWFyZXN0OiBmdW5jdGlvbihjb2xvcikge1xuICAgICAgICAgICAgdmFyIHZib3hlcyA9IHRoaXMudmJveGVzLFxuICAgICAgICAgICAgICAgIGQxLCBkMiwgcENvbG9yO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB2Ym94ZXMuc2l6ZSgpOyBpKyspIHtcbiAgICAgICAgICAgICAgICBkMiA9IE1hdGguc3FydChcbiAgICAgICAgICAgICAgICAgICAgTWF0aC5wb3coY29sb3JbMF0gLSB2Ym94ZXMucGVlayhpKS5jb2xvclswXSwgMikgK1xuICAgICAgICAgICAgICAgICAgICBNYXRoLnBvdyhjb2xvclsxXSAtIHZib3hlcy5wZWVrKGkpLmNvbG9yWzFdLCAyKSArXG4gICAgICAgICAgICAgICAgICAgIE1hdGgucG93KGNvbG9yWzJdIC0gdmJveGVzLnBlZWsoaSkuY29sb3JbMl0sIDIpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgICBpZiAoZDIgPCBkMSB8fCBkMSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIGQxID0gZDI7XG4gICAgICAgICAgICAgICAgICAgIHBDb2xvciA9IHZib3hlcy5wZWVrKGkpLmNvbG9yO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBwQ29sb3I7XG4gICAgICAgIH0sXG4gICAgICAgIGZvcmNlYnc6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgLy8gWFhYOiB3b24ndCAgd29yayB5ZXRcbiAgICAgICAgICAgIHZhciB2Ym94ZXMgPSB0aGlzLnZib3hlcztcbiAgICAgICAgICAgIHZib3hlcy5zb3J0KGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcHYubmF0dXJhbE9yZGVyKHB2LnN1bShhLmNvbG9yKSwgcHYuc3VtKGIuY29sb3IpKVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIGZvcmNlIGRhcmtlc3QgY29sb3IgdG8gYmxhY2sgaWYgZXZlcnl0aGluZyA8IDVcbiAgICAgICAgICAgIHZhciBsb3dlc3QgPSB2Ym94ZXNbMF0uY29sb3I7XG4gICAgICAgICAgICBpZiAobG93ZXN0WzBdIDwgNSAmJiBsb3dlc3RbMV0gPCA1ICYmIGxvd2VzdFsyXSA8IDUpXG4gICAgICAgICAgICAgICAgdmJveGVzWzBdLmNvbG9yID0gWzAsIDAsIDBdO1xuXG4gICAgICAgICAgICAvLyBmb3JjZSBsaWdodGVzdCBjb2xvciB0byB3aGl0ZSBpZiBldmVyeXRoaW5nID4gMjUxXG4gICAgICAgICAgICB2YXIgaWR4ID0gdmJveGVzLmxlbmd0aCAtIDEsXG4gICAgICAgICAgICAgICAgaGlnaGVzdCA9IHZib3hlc1tpZHhdLmNvbG9yO1xuICAgICAgICAgICAgaWYgKGhpZ2hlc3RbMF0gPiAyNTEgJiYgaGlnaGVzdFsxXSA+IDI1MSAmJiBoaWdoZXN0WzJdID4gMjUxKVxuICAgICAgICAgICAgICAgIHZib3hlc1tpZHhdLmNvbG9yID0gWzI1NSwgMjU1LCAyNTVdO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIC8vIGhpc3RvICgxLWQgYXJyYXksIGdpdmluZyB0aGUgbnVtYmVyIG9mIHBpeGVscyBpblxuICAgIC8vIGVhY2ggcXVhbnRpemVkIHJlZ2lvbiBvZiBjb2xvciBzcGFjZSksIG9yIG51bGwgb24gZXJyb3JcblxuICAgIGZ1bmN0aW9uIGdldEhpc3RvKHBpeGVscykge1xuICAgICAgICB2YXIgaGlzdG9zaXplID0gMSA8PCAoMyAqIHNpZ2JpdHMpLFxuICAgICAgICAgICAgaGlzdG8gPSBuZXcgQXJyYXkoaGlzdG9zaXplKSxcbiAgICAgICAgICAgIGluZGV4LCBydmFsLCBndmFsLCBidmFsO1xuICAgICAgICBwaXhlbHMuZm9yRWFjaChmdW5jdGlvbihwaXhlbCkge1xuICAgICAgICAgICAgcnZhbCA9IHBpeGVsWzBdID4+IHJzaGlmdDtcbiAgICAgICAgICAgIGd2YWwgPSBwaXhlbFsxXSA+PiByc2hpZnQ7XG4gICAgICAgICAgICBidmFsID0gcGl4ZWxbMl0gPj4gcnNoaWZ0O1xuICAgICAgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KHJ2YWwsIGd2YWwsIGJ2YWwpO1xuICAgICAgICAgICAgaGlzdG9baW5kZXhdID0gKGhpc3RvW2luZGV4XSB8fCAwKSArIDE7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gaGlzdG87XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gdmJveEZyb21QaXhlbHMocGl4ZWxzLCBoaXN0bykge1xuICAgICAgICB2YXIgcm1pbiA9IDEwMDAwMDAsXG4gICAgICAgICAgICBybWF4ID0gMCxcbiAgICAgICAgICAgIGdtaW4gPSAxMDAwMDAwLFxuICAgICAgICAgICAgZ21heCA9IDAsXG4gICAgICAgICAgICBibWluID0gMTAwMDAwMCxcbiAgICAgICAgICAgIGJtYXggPSAwLFxuICAgICAgICAgICAgcnZhbCwgZ3ZhbCwgYnZhbDtcbiAgICAgICAgLy8gZmluZCBtaW4vbWF4XG4gICAgICAgIHBpeGVscy5mb3JFYWNoKGZ1bmN0aW9uKHBpeGVsKSB7XG4gICAgICAgICAgICBydmFsID0gcGl4ZWxbMF0gPj4gcnNoaWZ0O1xuICAgICAgICAgICAgZ3ZhbCA9IHBpeGVsWzFdID4+IHJzaGlmdDtcbiAgICAgICAgICAgIGJ2YWwgPSBwaXhlbFsyXSA+PiByc2hpZnQ7XG4gICAgICAgICAgICBpZiAocnZhbCA8IHJtaW4pIHJtaW4gPSBydmFsO1xuICAgICAgICAgICAgZWxzZSBpZiAocnZhbCA+IHJtYXgpIHJtYXggPSBydmFsO1xuICAgICAgICAgICAgaWYgKGd2YWwgPCBnbWluKSBnbWluID0gZ3ZhbDtcbiAgICAgICAgICAgIGVsc2UgaWYgKGd2YWwgPiBnbWF4KSBnbWF4ID0gZ3ZhbDtcbiAgICAgICAgICAgIGlmIChidmFsIDwgYm1pbikgYm1pbiA9IGJ2YWw7XG4gICAgICAgICAgICBlbHNlIGlmIChidmFsID4gYm1heCkgYm1heCA9IGJ2YWw7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gbmV3IFZCb3gocm1pbiwgcm1heCwgZ21pbiwgZ21heCwgYm1pbiwgYm1heCwgaGlzdG8pO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIG1lZGlhbkN1dEFwcGx5KGhpc3RvLCB2Ym94KSB7XG4gICAgICAgIGlmICghdmJveC5jb3VudCgpKSByZXR1cm47XG5cbiAgICAgICAgdmFyIHJ3ID0gdmJveC5yMiAtIHZib3gucjEgKyAxLFxuICAgICAgICAgICAgZ3cgPSB2Ym94LmcyIC0gdmJveC5nMSArIDEsXG4gICAgICAgICAgICBidyA9IHZib3guYjIgLSB2Ym94LmIxICsgMSxcbiAgICAgICAgICAgIG1heHcgPSBwdi5tYXgoW3J3LCBndywgYnddKTtcbiAgICAgICAgLy8gb25seSBvbmUgcGl4ZWwsIG5vIHNwbGl0XG4gICAgICAgIGlmICh2Ym94LmNvdW50KCkgPT0gMSkge1xuICAgICAgICAgICAgcmV0dXJuIFt2Ym94LmNvcHkoKV1cbiAgICAgICAgfVxuICAgICAgICAvKiBGaW5kIHRoZSBwYXJ0aWFsIHN1bSBhcnJheXMgYWxvbmcgdGhlIHNlbGVjdGVkIGF4aXMuICovXG4gICAgICAgIHZhciB0b3RhbCA9IDAsXG4gICAgICAgICAgICBwYXJ0aWFsc3VtID0gW10sXG4gICAgICAgICAgICBsb29rYWhlYWRzdW0gPSBbXSxcbiAgICAgICAgICAgIGksIGosIGssIHN1bSwgaW5kZXg7XG4gICAgICAgIGlmIChtYXh3ID09IHJ3KSB7XG4gICAgICAgICAgICBmb3IgKGkgPSB2Ym94LnIxOyBpIDw9IHZib3gucjI7IGkrKykge1xuICAgICAgICAgICAgICAgIHN1bSA9IDA7XG4gICAgICAgICAgICAgICAgZm9yIChqID0gdmJveC5nMTsgaiA8PSB2Ym94LmcyOyBqKyspIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChrID0gdmJveC5iMTsgayA8PSB2Ym94LmIyOyBrKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChpLCBqLCBrKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1bSArPSAoaGlzdG9baW5kZXhdIHx8IDApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRvdGFsICs9IHN1bTtcbiAgICAgICAgICAgICAgICBwYXJ0aWFsc3VtW2ldID0gdG90YWw7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobWF4dyA9PSBndykge1xuICAgICAgICAgICAgZm9yIChpID0gdmJveC5nMTsgaSA8PSB2Ym94LmcyOyBpKyspIHtcbiAgICAgICAgICAgICAgICBzdW0gPSAwO1xuICAgICAgICAgICAgICAgIGZvciAoaiA9IHZib3gucjE7IGogPD0gdmJveC5yMjsgaisrKSB7XG4gICAgICAgICAgICAgICAgICAgIGZvciAoayA9IHZib3guYjE7IGsgPD0gdmJveC5iMjsgaysrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgoaiwgaSwgayk7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdW0gKz0gKGhpc3RvW2luZGV4XSB8fCAwKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0b3RhbCArPSBzdW07XG4gICAgICAgICAgICAgICAgcGFydGlhbHN1bVtpXSA9IHRvdGFsO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgeyAvKiBtYXh3ID09IGJ3ICovXG4gICAgICAgICAgICBmb3IgKGkgPSB2Ym94LmIxOyBpIDw9IHZib3guYjI7IGkrKykge1xuICAgICAgICAgICAgICAgIHN1bSA9IDA7XG4gICAgICAgICAgICAgICAgZm9yIChqID0gdmJveC5yMTsgaiA8PSB2Ym94LnIyOyBqKyspIHtcbiAgICAgICAgICAgICAgICAgICAgZm9yIChrID0gdmJveC5nMTsgayA8PSB2Ym94LmcyOyBrKyspIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChqLCBrLCBpKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHN1bSArPSAoaGlzdG9baW5kZXhdIHx8IDApO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRvdGFsICs9IHN1bTtcbiAgICAgICAgICAgICAgICBwYXJ0aWFsc3VtW2ldID0gdG90YWw7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcGFydGlhbHN1bS5mb3JFYWNoKGZ1bmN0aW9uKGQsIGkpIHtcbiAgICAgICAgICAgIGxvb2thaGVhZHN1bVtpXSA9IHRvdGFsIC0gZFxuICAgICAgICB9KTtcblxuICAgICAgICBmdW5jdGlvbiBkb0N1dChjb2xvcikge1xuICAgICAgICAgICAgdmFyIGRpbTEgPSBjb2xvciArICcxJyxcbiAgICAgICAgICAgICAgICBkaW0yID0gY29sb3IgKyAnMicsXG4gICAgICAgICAgICAgICAgbGVmdCwgcmlnaHQsIHZib3gxLCB2Ym94MiwgZDIsIGNvdW50MiA9IDA7XG4gICAgICAgICAgICBmb3IgKGkgPSB2Ym94W2RpbTFdOyBpIDw9IHZib3hbZGltMl07IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChwYXJ0aWFsc3VtW2ldID4gdG90YWwgLyAyKSB7XG4gICAgICAgICAgICAgICAgICAgIHZib3gxID0gdmJveC5jb3B5KCk7XG4gICAgICAgICAgICAgICAgICAgIHZib3gyID0gdmJveC5jb3B5KCk7XG4gICAgICAgICAgICAgICAgICAgIGxlZnQgPSBpIC0gdmJveFtkaW0xXTtcbiAgICAgICAgICAgICAgICAgICAgcmlnaHQgPSB2Ym94W2RpbTJdIC0gaTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxlZnQgPD0gcmlnaHQpXG4gICAgICAgICAgICAgICAgICAgICAgICBkMiA9IE1hdGgubWluKHZib3hbZGltMl0gLSAxLCB+fiAoaSArIHJpZ2h0IC8gMikpO1xuICAgICAgICAgICAgICAgICAgICBlbHNlIGQyID0gTWF0aC5tYXgodmJveFtkaW0xXSwgfn4gKGkgLSAxIC0gbGVmdCAvIDIpKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gYXZvaWQgMC1jb3VudCBib3hlc1xuICAgICAgICAgICAgICAgICAgICB3aGlsZSAoIXBhcnRpYWxzdW1bZDJdKSBkMisrO1xuICAgICAgICAgICAgICAgICAgICBjb3VudDIgPSBsb29rYWhlYWRzdW1bZDJdO1xuICAgICAgICAgICAgICAgICAgICB3aGlsZSAoIWNvdW50MiAmJiBwYXJ0aWFsc3VtW2QyIC0gMV0pIGNvdW50MiA9IGxvb2thaGVhZHN1bVstLWQyXTtcbiAgICAgICAgICAgICAgICAgICAgLy8gc2V0IGRpbWVuc2lvbnNcbiAgICAgICAgICAgICAgICAgICAgdmJveDFbZGltMl0gPSBkMjtcbiAgICAgICAgICAgICAgICAgICAgdmJveDJbZGltMV0gPSB2Ym94MVtkaW0yXSArIDE7XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCd2Ym94IGNvdW50czonLCB2Ym94LmNvdW50KCksIHZib3gxLmNvdW50KCksIHZib3gyLmNvdW50KCkpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW3Zib3gxLCB2Ym94Ml07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgIH1cbiAgICAgICAgLy8gZGV0ZXJtaW5lIHRoZSBjdXQgcGxhbmVzXG4gICAgICAgIHJldHVybiBtYXh3ID09IHJ3ID8gZG9DdXQoJ3InKSA6XG4gICAgICAgICAgICBtYXh3ID09IGd3ID8gZG9DdXQoJ2cnKSA6XG4gICAgICAgICAgICBkb0N1dCgnYicpO1xuICAgIH1cblxuICAgIGZ1bmN0aW9uIHF1YW50aXplKHBpeGVscywgbWF4Y29sb3JzKSB7XG4gICAgICAgIC8vIHNob3J0LWNpcmN1aXRcbiAgICAgICAgaWYgKCFwaXhlbHMubGVuZ3RoIHx8IG1heGNvbG9ycyA8IDIgfHwgbWF4Y29sb3JzID4gMjU2KSB7XG4gICAgICAgICAgICAvLyBjb25zb2xlLmxvZygnd3JvbmcgbnVtYmVyIG9mIG1heGNvbG9ycycpO1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gWFhYOiBjaGVjayBjb2xvciBjb250ZW50IGFuZCBjb252ZXJ0IHRvIGdyYXlzY2FsZSBpZiBpbnN1ZmZpY2llbnRcblxuICAgICAgICB2YXIgaGlzdG8gPSBnZXRIaXN0byhwaXhlbHMpLFxuICAgICAgICAgICAgaGlzdG9zaXplID0gMSA8PCAoMyAqIHNpZ2JpdHMpO1xuXG4gICAgICAgIC8vIGNoZWNrIHRoYXQgd2UgYXJlbid0IGJlbG93IG1heGNvbG9ycyBhbHJlYWR5XG4gICAgICAgIHZhciBuQ29sb3JzID0gMDtcbiAgICAgICAgaGlzdG8uZm9yRWFjaChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIG5Db2xvcnMrK1xuICAgICAgICB9KTtcbiAgICAgICAgaWYgKG5Db2xvcnMgPD0gbWF4Y29sb3JzKSB7XG4gICAgICAgICAgICAvLyBYWFg6IGdlbmVyYXRlIHRoZSBuZXcgY29sb3JzIGZyb20gdGhlIGhpc3RvIGFuZCByZXR1cm5cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGdldCB0aGUgYmVnaW5uaW5nIHZib3ggZnJvbSB0aGUgY29sb3JzXG4gICAgICAgIHZhciB2Ym94ID0gdmJveEZyb21QaXhlbHMocGl4ZWxzLCBoaXN0byksXG4gICAgICAgICAgICBwcSA9IG5ldyBQUXVldWUoZnVuY3Rpb24oYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBwdi5uYXR1cmFsT3JkZXIoYS5jb3VudCgpLCBiLmNvdW50KCkpXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgcHEucHVzaCh2Ym94KTtcblxuICAgICAgICAvLyBpbm5lciBmdW5jdGlvbiB0byBkbyB0aGUgaXRlcmF0aW9uXG5cbiAgICAgICAgZnVuY3Rpb24gaXRlcihsaCwgdGFyZ2V0KSB7XG4gICAgICAgICAgICB2YXIgbmNvbG9ycyA9IDEsXG4gICAgICAgICAgICAgICAgbml0ZXJzID0gMCxcbiAgICAgICAgICAgICAgICB2Ym94O1xuICAgICAgICAgICAgd2hpbGUgKG5pdGVycyA8IG1heEl0ZXJhdGlvbnMpIHtcbiAgICAgICAgICAgICAgICB2Ym94ID0gbGgucG9wKCk7XG4gICAgICAgICAgICAgICAgaWYgKCF2Ym94LmNvdW50KCkpIHsgLyoganVzdCBwdXQgaXQgYmFjayAqL1xuICAgICAgICAgICAgICAgICAgICBsaC5wdXNoKHZib3gpO1xuICAgICAgICAgICAgICAgICAgICBuaXRlcnMrKztcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIGRvIHRoZSBjdXRcbiAgICAgICAgICAgICAgICB2YXIgdmJveGVzID0gbWVkaWFuQ3V0QXBwbHkoaGlzdG8sIHZib3gpLFxuICAgICAgICAgICAgICAgICAgICB2Ym94MSA9IHZib3hlc1swXSxcbiAgICAgICAgICAgICAgICAgICAgdmJveDIgPSB2Ym94ZXNbMV07XG5cbiAgICAgICAgICAgICAgICBpZiAoIXZib3gxKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKFwidmJveDEgbm90IGRlZmluZWQ7IHNob3VsZG4ndCBoYXBwZW4hXCIpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGxoLnB1c2godmJveDEpO1xuICAgICAgICAgICAgICAgIGlmICh2Ym94MikgeyAvKiB2Ym94MiBjYW4gYmUgbnVsbCAqL1xuICAgICAgICAgICAgICAgICAgICBsaC5wdXNoKHZib3gyKTtcbiAgICAgICAgICAgICAgICAgICAgbmNvbG9ycysrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobmNvbG9ycyA+PSB0YXJnZXQpIHJldHVybjtcbiAgICAgICAgICAgICAgICBpZiAobml0ZXJzKysgPiBtYXhJdGVyYXRpb25zKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKFwiaW5maW5pdGUgbG9vcDsgcGVyaGFwcyB0b28gZmV3IHBpeGVscyFcIik7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBmaXJzdCBzZXQgb2YgY29sb3JzLCBzb3J0ZWQgYnkgcG9wdWxhdGlvblxuICAgICAgICBpdGVyKHBxLCBmcmFjdEJ5UG9wdWxhdGlvbnMgKiBtYXhjb2xvcnMpO1xuICAgICAgICAvLyBjb25zb2xlLmxvZyhwcS5zaXplKCksIHBxLmRlYnVnKCkubGVuZ3RoLCBwcS5kZWJ1ZygpLnNsaWNlKCkpO1xuXG4gICAgICAgIC8vIFJlLXNvcnQgYnkgdGhlIHByb2R1Y3Qgb2YgcGl4ZWwgb2NjdXBhbmN5IHRpbWVzIHRoZSBzaXplIGluIGNvbG9yIHNwYWNlLlxuICAgICAgICB2YXIgcHEyID0gbmV3IFBRdWV1ZShmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgICAgICByZXR1cm4gcHYubmF0dXJhbE9yZGVyKGEuY291bnQoKSAqIGEudm9sdW1lKCksIGIuY291bnQoKSAqIGIudm9sdW1lKCkpXG4gICAgICAgIH0pO1xuICAgICAgICB3aGlsZSAocHEuc2l6ZSgpKSB7XG4gICAgICAgICAgICBwcTIucHVzaChwcS5wb3AoKSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBuZXh0IHNldCAtIGdlbmVyYXRlIHRoZSBtZWRpYW4gY3V0cyB1c2luZyB0aGUgKG5waXggKiB2b2wpIHNvcnRpbmcuXG4gICAgICAgIGl0ZXIocHEyLCBtYXhjb2xvcnMgLSBwcTIuc2l6ZSgpKTtcblxuICAgICAgICAvLyBjYWxjdWxhdGUgdGhlIGFjdHVhbCBjb2xvcnNcbiAgICAgICAgdmFyIGNtYXAgPSBuZXcgQ01hcCgpO1xuICAgICAgICB3aGlsZSAocHEyLnNpemUoKSkge1xuICAgICAgICAgICAgY21hcC5wdXNoKHBxMi5wb3AoKSk7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gY21hcDtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgICBxdWFudGl6ZTogcXVhbnRpemVcbiAgICB9XG59KSgpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IE1NQ1EucXVhbnRpemVcbiIsIi8vIENvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLlxuLy9cbi8vIFBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhXG4vLyBjb3B5IG9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlXG4vLyBcIlNvZnR3YXJlXCIpLCB0byBkZWFsIGluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmdcbi8vIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzIHRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCxcbi8vIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsIGNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXRcbi8vIHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXMgZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZVxuLy8gZm9sbG93aW5nIGNvbmRpdGlvbnM6XG4vL1xuLy8gVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWRcbi8vIGluIGFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuLy9cbi8vIFRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1Ncbi8vIE9SIElNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0Zcbi8vIE1FUkNIQU5UQUJJTElUWSwgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU5cbi8vIE5PIEVWRU5UIFNIQUxMIFRIRSBBVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLFxuLy8gREFNQUdFUyBPUiBPVEhFUiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SXG4vLyBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSwgT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFXG4vLyBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU4gVEhFIFNPRlRXQVJFLlxuXG4ndXNlIHN0cmljdCc7XG5cbi8vIElmIG9iai5oYXNPd25Qcm9wZXJ0eSBoYXMgYmVlbiBvdmVycmlkZGVuLCB0aGVuIGNhbGxpbmdcbi8vIG9iai5oYXNPd25Qcm9wZXJ0eShwcm9wKSB3aWxsIGJyZWFrLlxuLy8gU2VlOiBodHRwczovL2dpdGh1Yi5jb20vam95ZW50L25vZGUvaXNzdWVzLzE3MDdcbmZ1bmN0aW9uIGhhc093blByb3BlcnR5KG9iaiwgcHJvcCkge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwgcHJvcCk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ocXMsIHNlcCwgZXEsIG9wdGlvbnMpIHtcbiAgc2VwID0gc2VwIHx8ICcmJztcbiAgZXEgPSBlcSB8fCAnPSc7XG4gIHZhciBvYmogPSB7fTtcblxuICBpZiAodHlwZW9mIHFzICE9PSAnc3RyaW5nJyB8fCBxcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gb2JqO1xuICB9XG5cbiAgdmFyIHJlZ2V4cCA9IC9cXCsvZztcbiAgcXMgPSBxcy5zcGxpdChzZXApO1xuXG4gIHZhciBtYXhLZXlzID0gMTAwMDtcbiAgaWYgKG9wdGlvbnMgJiYgdHlwZW9mIG9wdGlvbnMubWF4S2V5cyA9PT0gJ251bWJlcicpIHtcbiAgICBtYXhLZXlzID0gb3B0aW9ucy5tYXhLZXlzO1xuICB9XG5cbiAgdmFyIGxlbiA9IHFzLmxlbmd0aDtcbiAgLy8gbWF4S2V5cyA8PSAwIG1lYW5zIHRoYXQgd2Ugc2hvdWxkIG5vdCBsaW1pdCBrZXlzIGNvdW50XG4gIGlmIChtYXhLZXlzID4gMCAmJiBsZW4gPiBtYXhLZXlzKSB7XG4gICAgbGVuID0gbWF4S2V5cztcbiAgfVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuOyArK2kpIHtcbiAgICB2YXIgeCA9IHFzW2ldLnJlcGxhY2UocmVnZXhwLCAnJTIwJyksXG4gICAgICAgIGlkeCA9IHguaW5kZXhPZihlcSksXG4gICAgICAgIGtzdHIsIHZzdHIsIGssIHY7XG5cbiAgICBpZiAoaWR4ID49IDApIHtcbiAgICAgIGtzdHIgPSB4LnN1YnN0cigwLCBpZHgpO1xuICAgICAgdnN0ciA9IHguc3Vic3RyKGlkeCArIDEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBrc3RyID0geDtcbiAgICAgIHZzdHIgPSAnJztcbiAgICB9XG5cbiAgICBrID0gZGVjb2RlVVJJQ29tcG9uZW50KGtzdHIpO1xuICAgIHYgPSBkZWNvZGVVUklDb21wb25lbnQodnN0cik7XG5cbiAgICBpZiAoIWhhc093blByb3BlcnR5KG9iaiwgaykpIHtcbiAgICAgIG9ialtrXSA9IHY7XG4gICAgfSBlbHNlIGlmIChpc0FycmF5KG9ialtrXSkpIHtcbiAgICAgIG9ialtrXS5wdXNoKHYpO1xuICAgIH0gZWxzZSB7XG4gICAgICBvYmpba10gPSBbb2JqW2tdLCB2XTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gb2JqO1xufTtcblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uICh4cykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHhzKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG4iLCIvLyBDb3B5cmlnaHQgSm95ZW50LCBJbmMuIGFuZCBvdGhlciBOb2RlIGNvbnRyaWJ1dG9ycy5cbi8vXG4vLyBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYVxuLy8gY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuLy8gXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4vLyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4vLyBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0XG4vLyBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGVcbi8vIGZvbGxvd2luZyBjb25kaXRpb25zOlxuLy9cbi8vIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkXG4vLyBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbi8vXG4vLyBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTXG4vLyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4vLyBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOXG4vLyBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSxcbi8vIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUlxuLy8gT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRVxuLy8gVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgc3RyaW5naWZ5UHJpbWl0aXZlID0gZnVuY3Rpb24odikge1xuICBzd2l0Y2ggKHR5cGVvZiB2KSB7XG4gICAgY2FzZSAnc3RyaW5nJzpcbiAgICAgIHJldHVybiB2O1xuXG4gICAgY2FzZSAnYm9vbGVhbic6XG4gICAgICByZXR1cm4gdiA/ICd0cnVlJyA6ICdmYWxzZSc7XG5cbiAgICBjYXNlICdudW1iZXInOlxuICAgICAgcmV0dXJuIGlzRmluaXRlKHYpID8gdiA6ICcnO1xuXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiAnJztcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvYmosIHNlcCwgZXEsIG5hbWUpIHtcbiAgc2VwID0gc2VwIHx8ICcmJztcbiAgZXEgPSBlcSB8fCAnPSc7XG4gIGlmIChvYmogPT09IG51bGwpIHtcbiAgICBvYmogPSB1bmRlZmluZWQ7XG4gIH1cblxuICBpZiAodHlwZW9mIG9iaiA9PT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gbWFwKG9iamVjdEtleXMob2JqKSwgZnVuY3Rpb24oaykge1xuICAgICAgdmFyIGtzID0gZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShrKSkgKyBlcTtcbiAgICAgIGlmIChpc0FycmF5KG9ialtrXSkpIHtcbiAgICAgICAgcmV0dXJuIG1hcChvYmpba10sIGZ1bmN0aW9uKHYpIHtcbiAgICAgICAgICByZXR1cm4ga3MgKyBlbmNvZGVVUklDb21wb25lbnQoc3RyaW5naWZ5UHJpbWl0aXZlKHYpKTtcbiAgICAgICAgfSkuam9pbihzZXApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIGtzICsgZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShvYmpba10pKTtcbiAgICAgIH1cbiAgICB9KS5qb2luKHNlcCk7XG5cbiAgfVxuXG4gIGlmICghbmFtZSkgcmV0dXJuICcnO1xuICByZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KHN0cmluZ2lmeVByaW1pdGl2ZShuYW1lKSkgKyBlcSArXG4gICAgICAgICBlbmNvZGVVUklDb21wb25lbnQoc3RyaW5naWZ5UHJpbWl0aXZlKG9iaikpO1xufTtcblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5IHx8IGZ1bmN0aW9uICh4cykge1xuICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHhzKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn07XG5cbmZ1bmN0aW9uIG1hcCAoeHMsIGYpIHtcbiAgaWYgKHhzLm1hcCkgcmV0dXJuIHhzLm1hcChmKTtcbiAgdmFyIHJlcyA9IFtdO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IHhzLmxlbmd0aDsgaSsrKSB7XG4gICAgcmVzLnB1c2goZih4c1tpXSwgaSkpO1xuICB9XG4gIHJldHVybiByZXM7XG59XG5cbnZhciBvYmplY3RLZXlzID0gT2JqZWN0LmtleXMgfHwgZnVuY3Rpb24gKG9iaikge1xuICB2YXIgcmVzID0gW107XG4gIGZvciAodmFyIGtleSBpbiBvYmopIHtcbiAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eS5jYWxsKG9iaiwga2V5KSkgcmVzLnB1c2goa2V5KTtcbiAgfVxuICByZXR1cm4gcmVzO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuZXhwb3J0cy5kZWNvZGUgPSBleHBvcnRzLnBhcnNlID0gcmVxdWlyZSgnLi9kZWNvZGUnKTtcbmV4cG9ydHMuZW5jb2RlID0gZXhwb3J0cy5zdHJpbmdpZnkgPSByZXF1aXJlKCcuL2VuY29kZScpO1xuIiwiVmlicmFudCA9IHJlcXVpcmUoJy4vdmlicmFudCcpXG5WaWJyYW50LkRlZmF1bHRPcHRzLkltYWdlID0gcmVxdWlyZSgnLi9pbWFnZS9icm93c2VyJylcblxubW9kdWxlLmV4cG9ydHMgPSBWaWJyYW50XG4iLCJ3aW5kb3cuVmlicmFudCA9IFZpYnJhbnQgPSByZXF1aXJlKCcuL2Jyb3dzZXInKVxuIiwibW9kdWxlLmV4cG9ydHMgPSAociwgZywgYiwgYSkgLT5cclxuICBhID49IDEyNSBhbmQgbm90IChyID4gMjUwIGFuZCBnID4gMjUwIGFuZCBiID4gMjUwKVxyXG4iLCJtb2R1bGUuZXhwb3J0cy5EZWZhdWx0ID0gcmVxdWlyZSgnLi9kZWZhdWx0JylcclxuIiwiU3dhdGNoID0gcmVxdWlyZSgnLi4vc3dhdGNoJylcclxudXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwnKVxyXG5HZW5lcmF0b3IgPSByZXF1aXJlKCcuL2luZGV4JylcclxuXHJcbkRlZmF1bHRPcHRzID1cclxuICB0YXJnZXREYXJrTHVtYTogMC4yNlxyXG4gIG1heERhcmtMdW1hOiAwLjQ1XHJcbiAgbWluTGlnaHRMdW1hOiAwLjU1XHJcbiAgdGFyZ2V0TGlnaHRMdW1hOiAwLjc0XHJcbiAgbWluTm9ybWFsTHVtYTogMC4zXHJcbiAgdGFyZ2V0Tm9ybWFsTHVtYTogMC41XHJcbiAgbWF4Tm9ybWFsTHVtYTogMC43XHJcbiAgdGFyZ2V0TXV0ZXNTYXR1cmF0aW9uOiAwLjNcclxuICBtYXhNdXRlc1NhdHVyYXRpb246IDAuNFxyXG4gIHRhcmdldFZpYnJhbnRTYXR1cmF0aW9uOiAxLjBcclxuICBtaW5WaWJyYW50U2F0dXJhdGlvbjogMC4zNVxyXG4gIHdlaWdodFNhdHVyYXRpb246IDNcclxuICB3ZWlnaHRMdW1hOiA2XHJcbiAgd2VpZ2h0UG9wdWxhdGlvbjogMVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBEZWZhdWx0R2VuZXJhdG9yIGV4dGVuZHMgR2VuZXJhdG9yXHJcbiAgSGlnaGVzdFBvcHVsYXRpb246IDBcclxuICBjb25zdHJ1Y3RvcjogKG9wdHMpIC0+XHJcbiAgICBAb3B0cyA9IHV0aWwuZGVmYXVsdHMob3B0cywgRGVmYXVsdE9wdHMpXHJcbiAgICBAVmlicmFudFN3YXRjaCA9IG51bGxcclxuICAgIEBMaWdodFZpYnJhbnRTd2F0Y2ggPSBudWxsXHJcbiAgICBARGFya1ZpYnJhbnRTd2F0Y2ggPSBudWxsXHJcbiAgICBATXV0ZWRTd2F0Y2ggPSBudWxsXHJcbiAgICBATGlnaHRNdXRlZFN3YXRjaCA9IG51bGxcclxuICAgIEBEYXJrTXV0ZWRTd2F0Y2ggPSBudWxsXHJcblxyXG4gIGdlbmVyYXRlOiAoQHN3YXRjaGVzKSAtPlxyXG4gICAgQG1heFBvcHVsYXRpb24gPSBAZmluZE1heFBvcHVsYXRpb25cclxuXHJcbiAgICBAZ2VuZXJhdGVWYXJhdGlvbkNvbG9ycygpXHJcbiAgICBAZ2VuZXJhdGVFbXB0eVN3YXRjaGVzKClcclxuXHJcbiAgZ2V0VmlicmFudFN3YXRjaDogLT5cclxuICAgIEBWaWJyYW50U3dhdGNoXHJcblxyXG4gIGdldExpZ2h0VmlicmFudFN3YXRjaDogLT5cclxuICAgIEBMaWdodFZpYnJhbnRTd2F0Y2hcclxuXHJcbiAgZ2V0RGFya1ZpYnJhbnRTd2F0Y2g6IC0+XHJcbiAgICBARGFya1ZpYnJhbnRTd2F0Y2hcclxuXHJcbiAgZ2V0TXV0ZWRTd2F0Y2g6IC0+XHJcbiAgICBATXV0ZWRTd2F0Y2hcclxuXHJcbiAgZ2V0TGlnaHRNdXRlZFN3YXRjaDogLT5cclxuICAgIEBMaWdodE11dGVkU3dhdGNoXHJcblxyXG4gIGdldERhcmtNdXRlZFN3YXRjaDogLT5cclxuICAgIEBEYXJrTXV0ZWRTd2F0Y2hcclxuXHJcbiAgZ2VuZXJhdGVWYXJhdGlvbkNvbG9yczogLT5cclxuICAgIEBWaWJyYW50U3dhdGNoID0gQGZpbmRDb2xvclZhcmlhdGlvbihAb3B0cy50YXJnZXROb3JtYWxMdW1hLCBAb3B0cy5taW5Ob3JtYWxMdW1hLCBAb3B0cy5tYXhOb3JtYWxMdW1hLFxyXG4gICAgICBAb3B0cy50YXJnZXRWaWJyYW50U2F0dXJhdGlvbiwgQG9wdHMubWluVmlicmFudFNhdHVyYXRpb24sIDEpO1xyXG5cclxuICAgIEBMaWdodFZpYnJhbnRTd2F0Y2ggPSBAZmluZENvbG9yVmFyaWF0aW9uKEBvcHRzLnRhcmdldExpZ2h0THVtYSwgQG9wdHMubWluTGlnaHRMdW1hLCAxLFxyXG4gICAgICBAb3B0cy50YXJnZXRWaWJyYW50U2F0dXJhdGlvbiwgQG9wdHMubWluVmlicmFudFNhdHVyYXRpb24sIDEpO1xyXG5cclxuICAgIEBEYXJrVmlicmFudFN3YXRjaCA9IEBmaW5kQ29sb3JWYXJpYXRpb24oQG9wdHMudGFyZ2V0RGFya0x1bWEsIDAsIEBvcHRzLm1heERhcmtMdW1hLFxyXG4gICAgICBAb3B0cy50YXJnZXRWaWJyYW50U2F0dXJhdGlvbiwgQG9wdHMubWluVmlicmFudFNhdHVyYXRpb24sIDEpO1xyXG5cclxuICAgIEBNdXRlZFN3YXRjaCA9IEBmaW5kQ29sb3JWYXJpYXRpb24oQG9wdHMudGFyZ2V0Tm9ybWFsTHVtYSwgQG9wdHMubWluTm9ybWFsTHVtYSwgQG9wdHMubWF4Tm9ybWFsTHVtYSxcclxuICAgICAgQG9wdHMudGFyZ2V0TXV0ZXNTYXR1cmF0aW9uLCAwLCBAb3B0cy5tYXhNdXRlc1NhdHVyYXRpb24pO1xyXG5cclxuICAgIEBMaWdodE11dGVkU3dhdGNoID0gQGZpbmRDb2xvclZhcmlhdGlvbihAb3B0cy50YXJnZXRMaWdodEx1bWEsIEBvcHRzLm1pbkxpZ2h0THVtYSwgMSxcclxuICAgICAgQG9wdHMudGFyZ2V0TXV0ZXNTYXR1cmF0aW9uLCAwLCBAb3B0cy5tYXhNdXRlc1NhdHVyYXRpb24pO1xyXG5cclxuICAgIEBEYXJrTXV0ZWRTd2F0Y2ggPSBAZmluZENvbG9yVmFyaWF0aW9uKEBvcHRzLnRhcmdldERhcmtMdW1hLCAwLCBAb3B0cy5tYXhEYXJrTHVtYSxcclxuICAgICAgQG9wdHMudGFyZ2V0TXV0ZXNTYXR1cmF0aW9uLCAwLCBAb3B0cy5tYXhNdXRlc1NhdHVyYXRpb24pO1xyXG5cclxuICBnZW5lcmF0ZUVtcHR5U3dhdGNoZXM6IC0+XHJcbiAgICBpZiBAVmlicmFudFN3YXRjaCBpcyBudWxsXHJcbiAgICAgICMgSWYgd2UgZG8gbm90IGhhdmUgYSB2aWJyYW50IGNvbG9yLi4uXHJcbiAgICAgIGlmIEBEYXJrVmlicmFudFN3YXRjaCBpc250IG51bGxcclxuICAgICAgICAjIC4uLmJ1dCB3ZSBkbyBoYXZlIGEgZGFyayB2aWJyYW50LCBnZW5lcmF0ZSB0aGUgdmFsdWUgYnkgbW9kaWZ5aW5nIHRoZSBsdW1hXHJcbiAgICAgICAgaHNsID0gQERhcmtWaWJyYW50U3dhdGNoLmdldEhzbCgpXHJcbiAgICAgICAgaHNsWzJdID0gQG9wdHMudGFyZ2V0Tm9ybWFsTHVtYVxyXG4gICAgICAgIEBWaWJyYW50U3dhdGNoID0gbmV3IFN3YXRjaCB1dGlsLmhzbFRvUmdiKGhzbFswXSwgaHNsWzFdLCBoc2xbMl0pLCAwXHJcblxyXG4gICAgaWYgQERhcmtWaWJyYW50U3dhdGNoIGlzIG51bGxcclxuICAgICAgIyBJZiB3ZSBkbyBub3QgaGF2ZSBhIHZpYnJhbnQgY29sb3IuLi5cclxuICAgICAgaWYgQFZpYnJhbnRTd2F0Y2ggaXNudCBudWxsXHJcbiAgICAgICAgIyAuLi5idXQgd2UgZG8gaGF2ZSBhIGRhcmsgdmlicmFudCwgZ2VuZXJhdGUgdGhlIHZhbHVlIGJ5IG1vZGlmeWluZyB0aGUgbHVtYVxyXG4gICAgICAgIGhzbCA9IEBWaWJyYW50U3dhdGNoLmdldEhzbCgpXHJcbiAgICAgICAgaHNsWzJdID0gQG9wdHMudGFyZ2V0RGFya0x1bWFcclxuICAgICAgICBARGFya1ZpYnJhbnRTd2F0Y2ggPSBuZXcgU3dhdGNoIHV0aWwuaHNsVG9SZ2IoaHNsWzBdLCBoc2xbMV0sIGhzbFsyXSksIDBcclxuXHJcbiAgZmluZE1heFBvcHVsYXRpb246IC0+XHJcbiAgICBwb3B1bGF0aW9uID0gMFxyXG4gICAgcG9wdWxhdGlvbiA9IE1hdGgubWF4KHBvcHVsYXRpb24sIHN3YXRjaC5nZXRQb3B1bGF0aW9uKCkpIGZvciBzd2F0Y2ggaW4gQHN3YXRjaGVzXHJcbiAgICBwb3B1bGF0aW9uXHJcblxyXG4gIGZpbmRDb2xvclZhcmlhdGlvbjogKHRhcmdldEx1bWEsIG1pbkx1bWEsIG1heEx1bWEsIHRhcmdldFNhdHVyYXRpb24sIG1pblNhdHVyYXRpb24sIG1heFNhdHVyYXRpb24pIC0+XHJcbiAgICBtYXggPSBudWxsXHJcbiAgICBtYXhWYWx1ZSA9IDBcclxuXHJcbiAgICBmb3Igc3dhdGNoIGluIEBzd2F0Y2hlc1xyXG4gICAgICBzYXQgPSBzd2F0Y2guZ2V0SHNsKClbMV07XHJcbiAgICAgIGx1bWEgPSBzd2F0Y2guZ2V0SHNsKClbMl1cclxuXHJcbiAgICAgIGlmIHNhdCA+PSBtaW5TYXR1cmF0aW9uIGFuZCBzYXQgPD0gbWF4U2F0dXJhdGlvbiBhbmRcclxuICAgICAgICBsdW1hID49IG1pbkx1bWEgYW5kIGx1bWEgPD0gbWF4THVtYSBhbmRcclxuICAgICAgICBub3QgQGlzQWxyZWFkeVNlbGVjdGVkKHN3YXRjaClcclxuICAgICAgICAgIHZhbHVlID0gQGNyZWF0ZUNvbXBhcmlzb25WYWx1ZSBzYXQsIHRhcmdldFNhdHVyYXRpb24sIGx1bWEsIHRhcmdldEx1bWEsXHJcbiAgICAgICAgICAgIHN3YXRjaC5nZXRQb3B1bGF0aW9uKCksIEBIaWdoZXN0UG9wdWxhdGlvblxyXG4gICAgICAgICAgaWYgbWF4IGlzIG51bGwgb3IgdmFsdWUgPiBtYXhWYWx1ZVxyXG4gICAgICAgICAgICBtYXggPSBzd2F0Y2hcclxuICAgICAgICAgICAgbWF4VmFsdWUgPSB2YWx1ZVxyXG5cclxuICAgIG1heFxyXG5cclxuICBjcmVhdGVDb21wYXJpc29uVmFsdWU6IChzYXR1cmF0aW9uLCB0YXJnZXRTYXR1cmF0aW9uLFxyXG4gICAgICBsdW1hLCB0YXJnZXRMdW1hLCBwb3B1bGF0aW9uLCBtYXhQb3B1bGF0aW9uKSAtPlxyXG4gICAgQHdlaWdodGVkTWVhbihcclxuICAgICAgQGludmVydERpZmYoc2F0dXJhdGlvbiwgdGFyZ2V0U2F0dXJhdGlvbiksIEBvcHRzLndlaWdodFNhdHVyYXRpb24sXHJcbiAgICAgIEBpbnZlcnREaWZmKGx1bWEsIHRhcmdldEx1bWEpLCBAb3B0cy53ZWlnaHRMdW1hLFxyXG4gICAgICBwb3B1bGF0aW9uIC8gbWF4UG9wdWxhdGlvbiwgQG9wdHMud2VpZ2h0UG9wdWxhdGlvblxyXG4gICAgKVxyXG5cclxuICBpbnZlcnREaWZmOiAodmFsdWUsIHRhcmdldFZhbHVlKSAtPlxyXG4gICAgMSAtIE1hdGguYWJzIHZhbHVlIC0gdGFyZ2V0VmFsdWVcclxuXHJcbiAgd2VpZ2h0ZWRNZWFuOiAodmFsdWVzLi4uKSAtPlxyXG4gICAgc3VtID0gMFxyXG4gICAgc3VtV2VpZ2h0ID0gMFxyXG4gICAgaSA9IDBcclxuICAgIHdoaWxlIGkgPCB2YWx1ZXMubGVuZ3RoXHJcbiAgICAgIHZhbHVlID0gdmFsdWVzW2ldXHJcbiAgICAgIHdlaWdodCA9IHZhbHVlc1tpICsgMV1cclxuICAgICAgc3VtICs9IHZhbHVlICogd2VpZ2h0XHJcbiAgICAgIHN1bVdlaWdodCArPSB3ZWlnaHRcclxuICAgICAgaSArPSAyXHJcbiAgICBzdW0gLyBzdW1XZWlnaHRcclxuXHJcbiAgaXNBbHJlYWR5U2VsZWN0ZWQ6IChzd2F0Y2gpIC0+XHJcbiAgICBAVmlicmFudFN3YXRjaCBpcyBzd2F0Y2ggb3IgQERhcmtWaWJyYW50U3dhdGNoIGlzIHN3YXRjaCBvclxyXG4gICAgICBATGlnaHRWaWJyYW50U3dhdGNoIGlzIHN3YXRjaCBvciBATXV0ZWRTd2F0Y2ggaXMgc3dhdGNoIG9yXHJcbiAgICAgIEBEYXJrTXV0ZWRTd2F0Y2ggaXMgc3dhdGNoIG9yIEBMaWdodE11dGVkU3dhdGNoIGlzIHN3YXRjaFxyXG4iLCJtb2R1bGUuZXhwb3J0cyA9XHJcbmNsYXNzIEdlbmVyYXRvclxyXG4gIGdlbmVyYXRlOiAoc3dhdGNoZXMpIC0+XHJcblxyXG4gIGdldFZpYnJhbnRTd2F0Y2g6IC0+XHJcblxyXG4gIGdldExpZ2h0VmlicmFudFN3YXRjaDogLT5cclxuXHJcbiAgZ2V0RGFya1ZpYnJhbnRTd2F0Y2g6IC0+XHJcblxyXG4gIGdldE11dGVkU3dhdGNoOiAtPlxyXG5cclxuICBnZXRMaWdodE11dGVkU3dhdGNoOiAtPlxyXG5cclxuICBnZXREYXJrTXV0ZWRTd2F0Y2g6IC0+XHJcblxyXG5tb2R1bGUuZXhwb3J0cy5EZWZhdWx0ID0gcmVxdWlyZSgnLi9kZWZhdWx0JylcclxuIiwiSW1hZ2UgPSByZXF1aXJlKCcuL2luZGV4JylcblVybCA9IHJlcXVpcmUoJ3VybCcpXG5cbmlzUmVsYXRpdmVVcmwgPSAodXJsKSAtPlxuICB1ID0gVXJsLnBhcnNlKHVybClcblxuICB1LnByb3RvY29sID09IG51bGwgJiYgdS5ob3N0ID09IG51bGwgJiYgdS5wb3J0ID09IG51bGxcblxuaXNTYW1lT3JpZ2luID0gKGEsIGIpIC0+XG4gIHVhID0gVXJsLnBhcnNlKGEpXG4gIHViID0gVXJsLnBhcnNlKGIpXG5cbiAgIyBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9TZWN1cml0eS9TYW1lLW9yaWdpbl9wb2xpY3lcbiAgdWEucHJvdG9jb2wgPT0gdWIucHJvdG9jb2wgJiYgdWEuaG9zdG5hbWUgPT0gdWIuaG9zdG5hbWUgJiYgdWEucG9ydCA9PSB1Yi5wb3J0XG5cbm1vZHVsZS5leHBvcnRzID1cbmNsYXNzIEJyb3dzZXJJbWFnZSBleHRlbmRzIEltYWdlXG5cbiAgY29uc3RydWN0b3I6IChwYXRoLCBjYikgLT5cbiAgICBpZiB0eXBlb2YgcGF0aCA9PSAnb2JqZWN0JyBhbmQgcGF0aCBpbnN0YW5jZW9mIEhUTUxJbWFnZUVsZW1lbnRcbiAgICAgIEBpbWcgPSBwYXRoXG4gICAgICBpZiBub3QgaXNSZWxhdGl2ZVVybChwYXRoKSAmJiBub3QgaXNTYW1lT3JpZ2luKHdpbmRvdy5sb2NhdGlvbi5ocmVmLCBwYXRoKVxuICAgICAgICBAaW1nLmNyb3NzT3JpZ2luID0gJ2Fub255bW91cydcbiAgICAgIHBhdGggPSBAaW1nLnNyY1xuICAgIGVsc2VcbiAgICAgIEBpbWcgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpbWcnKVxuICAgICAgaWYgbm90IGlzUmVsYXRpdmVVcmwocGF0aCkgJiYgbm90IGlzU2FtZU9yaWdpbih3aW5kb3cubG9jYXRpb24uaHJlZiwgcGF0aClcbiAgICAgICAgQGltZy5jcm9zc09yaWdpbiA9ICdhbm9ueW1vdXMnXG4gICAgICBAaW1nLnNyYyA9IHBhdGhcblxuICAgIEBpbWcub25sb2FkID0gPT5cbiAgICAgIEBfaW5pdENhbnZhcygpXG4gICAgICBjYj8obnVsbCwgQClcblxuICAgICMgQWxyZWF5ZCBsb2FkZWRcbiAgICBpZiBAaW1nLmNvbXBsZXRlXG4gICAgICBAaW1nLm9ubG9hZCgpXG5cbiAgICBAaW1nLm9uZXJyb3IgPSAoZSkgPT5cbiAgICAgIGVyciA9IG5ldyBFcnJvcihcIkZhaWwgdG8gbG9hZCBpbWFnZTogXCIgKyBwYXRoKTtcbiAgICAgIGVyci5yYXcgPSBlO1xuICAgICAgY2I/KGVycilcblxuXG4gIF9pbml0Q2FudmFzOiAtPlxuICAgIEBjYW52YXMgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdjYW52YXMnKVxuICAgIEBjb250ZXh0ID0gQGNhbnZhcy5nZXRDb250ZXh0KCcyZCcpXG4gICAgQHdpZHRoID0gQGNhbnZhcy53aWR0aCA9IEBpbWcud2lkdGhcbiAgICBAaGVpZ2h0ID0gQGNhbnZhcy5oZWlnaHQgPSBAaW1nLmhlaWdodFxuICAgIEBjb250ZXh0LmRyYXdJbWFnZSBAaW1nLCAwLCAwLCBAd2lkdGgsIEBoZWlnaHRcblxuICBjbGVhcjogLT5cbiAgICBAY29udGV4dC5jbGVhclJlY3QgMCwgMCwgQHdpZHRoLCBAaGVpZ2h0XG5cbiAgZ2V0V2lkdGg6IC0+XG4gICAgQHdpZHRoXG5cbiAgZ2V0SGVpZ2h0OiAtPlxuICAgIEBoZWlnaHRcblxuICByZXNpemU6ICh3LCBoLCByKSAtPlxuICAgIEB3aWR0aCA9IEBjYW52YXMud2lkdGggPSB3XG4gICAgQGhlaWdodCA9IEBjYW52YXMuaGVpZ2h0ID0gaFxuICAgIEBjb250ZXh0LnNjYWxlKHIsIHIpXG4gICAgQGNvbnRleHQuZHJhd0ltYWdlIEBpbWcsIDAsIDBcblxuICB1cGRhdGU6IChpbWFnZURhdGEpIC0+XG4gICAgQGNvbnRleHQucHV0SW1hZ2VEYXRhIGltYWdlRGF0YSwgMCwgMFxuXG4gIGdldFBpeGVsQ291bnQ6IC0+XG4gICAgQHdpZHRoICogQGhlaWdodFxuXG4gIGdldEltYWdlRGF0YTogLT5cbiAgICBAY29udGV4dC5nZXRJbWFnZURhdGEgMCwgMCwgQHdpZHRoLCBAaGVpZ2h0XG5cbiAgcmVtb3ZlQ2FudmFzOiAtPlxuICAgIEBjYW52YXMucGFyZW50Tm9kZS5yZW1vdmVDaGlsZCBAY2FudmFzXG4iLCJtb2R1bGUuZXhwb3J0cyA9XG5jbGFzcyBJbWFnZVxuICBjbGVhcjogLT5cblxuICB1cGRhdGU6IChpbWFnZURhdGEpIC0+XG5cbiAgZ2V0V2lkdGg6IC0+XG5cbiAgZ2V0SGVpZ2h0OiAtPlxuXG4gIHNjYWxlRG93bjogKG9wdHMpIC0+XG4gICAgd2lkdGggPSBAZ2V0V2lkdGgoKVxuICAgIGhlaWdodCA9IEBnZXRIZWlnaHQoKVxuXG4gICAgcmF0aW8gPSAxXG4gICAgaWYgb3B0cy5tYXhEaW1lbnNpb24/XG4gICAgICBtYXhTaWRlID0gTWF0aC5tYXgod2lkdGgsIGhlaWdodClcbiAgICAgIGlmIG1heFNpZGUgPiBvcHRzLm1heERpbWVuc2lvblxuICAgICAgICByYXRpbyA9IG9wdHMubWF4RGltZW5zaW9uIC8gbWF4U2lkZVxuICAgIGVsc2VcbiAgICAgIHJhdGlvID0gMSAvIG9wdHMucXVhbGl0eVxuXG4gICAgaWYgcmF0aW8gPCAxXG4gICAgICBAcmVzaXplIHdpZHRoICogcmF0aW8sIGhlaWdodCAqIHJhdGlvLCByYXRpb1xuXG4gIHJlc2l6ZTogKHcsIGgsIHIpIC0+XG5cblxuICBnZXRQaXhlbENvdW50OiAtPlxuXG4gIGdldEltYWdlRGF0YTogLT5cblxuICByZW1vdmVDYW52YXM6IC0+XG4iLCIjIFNJR0JJVFMgPSA1XHJcbiMgUlNISUZUID0gOCAtIFNJR0JJVFNcclxuI1xyXG4jIGdldENvbG9ySW5kZXggPSAociwgZywgYikgLT5cclxuIyAgIChyPDwoMipTSUdCSVRTKSkgKyAoZyA8PCBTSUdCSVRTKSArIGJcclxuXHJcbntnZXRDb2xvckluZGV4LCBTSUdCSVRTLCBSU0hJRlR9ID0gdXRpbCA9IHJlcXVpcmUoJy4uLy4uL3V0aWwnKVxyXG5Td2F0Y2ggPSByZXF1aXJlKCcuLi8uLi9zd2F0Y2gnKVxyXG5WQm94ID0gcmVxdWlyZSgnLi92Ym94JylcclxuUFF1ZXVlID0gcmVxdWlyZSgnLi9wcXVldWUnKVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPVxyXG5jbGFzcyBNTUNRXHJcbiAgQERlZmF1bHRPcHRzOlxyXG4gICAgbWF4SXRlcmF0aW9uczogMTAwMFxyXG4gICAgZnJhY3RCeVBvcHVsYXRpb25zOiAwLjc1XHJcblxyXG4gIGNvbnN0cnVjdG9yOiAob3B0cykgLT5cclxuICAgIEBvcHRzID0gdXRpbC5kZWZhdWx0cyBvcHRzLCBAY29uc3RydWN0b3IuRGVmYXVsdE9wdHNcclxuICBxdWFudGl6ZTogKHBpeGVscywgb3B0cykgLT5cclxuICAgIGlmIHBpeGVscy5sZW5ndGggPT0gMCBvciBvcHRzLmNvbG9yQ291bnQgPCAyIG9yIG9wdHMuY29sb3JDb3VudCA+IDI1NlxyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJXcm9uZyBNTUNRIHBhcmFtZXRlcnNcIilcclxuXHJcbiAgICBzaG91bGRJZ25vcmUgPSAtPiBmYWxzZVxyXG5cclxuICAgIGlmIEFycmF5LmlzQXJyYXkob3B0cy5maWx0ZXJzKSBhbmQgb3B0cy5maWx0ZXJzLmxlbmd0aCA+IDBcclxuICAgICAgc2hvdWxkSWdub3JlID0gKHIsIGcsIGIsIGEpIC0+XHJcbiAgICAgICAgZm9yIGYgaW4gb3B0cy5maWx0ZXJzXHJcbiAgICAgICAgICBpZiBub3QgZihyLCBnLCBiLCBhKSB0aGVuIHJldHVybiB0cnVlXHJcbiAgICAgICAgcmV0dXJuIGZhbHNlXHJcblxyXG5cclxuICAgIHZib3ggPSBWQm94LmJ1aWxkKHBpeGVscywgc2hvdWxkSWdub3JlKVxyXG4gICAgaGlzdCA9IHZib3guaGlzdFxyXG4gICAgY29sb3JDb3VudCA9IE9iamVjdC5rZXlzKGhpc3QpLmxlbmd0aFxyXG4gICAgcHEgPSBuZXcgUFF1ZXVlIChhLCBiKSAtPiBhLmNvdW50KCkgLSBiLmNvdW50KClcclxuXHJcbiAgICBwcS5wdXNoKHZib3gpXHJcblxyXG4gICAgIyBmaXJzdCBzZXQgb2YgY29sb3JzLCBzb3J0ZWQgYnkgcG9wdWxhdGlvblxyXG4gICAgQF9zcGxpdEJveGVzKHBxLCBAb3B0cy5mcmFjdEJ5UG9wdWxhdGlvbnMgKiBvcHRzLmNvbG9yQ291bnQpXHJcblxyXG4gICAgIyBSZS1vcmRlclxyXG4gICAgcHEyID0gbmV3IFBRdWV1ZSAoYSwgYikgLT4gYS5jb3VudCgpICogYS52b2x1bWUoKSAtIGIuY291bnQoKSAqIGIudm9sdW1lKClcclxuICAgIHBxMi5jb250ZW50cyA9IHBxLmNvbnRlbnRzXHJcblxyXG4gICAgIyBuZXh0IHNldCAtIGdlbmVyYXRlIHRoZSBtZWRpYW4gY3V0cyB1c2luZyB0aGUgKG5waXggKiB2b2wpIHNvcnRpbmcuXHJcbiAgICBAX3NwbGl0Qm94ZXMocHEyLCBvcHRzLmNvbG9yQ291bnQgLSBwcTIuc2l6ZSgpKVxyXG5cclxuICAgICMgY2FsY3VsYXRlIHRoZSBhY3R1YWwgY29sb3JzXHJcbiAgICBzd2F0Y2hlcyA9IFtdXHJcbiAgICBAdmJveGVzID0gW11cclxuICAgIHdoaWxlIHBxMi5zaXplKClcclxuICAgICAgdiA9IHBxMi5wb3AoKVxyXG4gICAgICBjb2xvciA9IHYuYXZnKClcclxuICAgICAgaWYgbm90IHNob3VsZElnbm9yZT8oY29sb3JbMF0sIGNvbG9yWzFdLCBjb2xvclsyXSwgMjU1KVxyXG4gICAgICAgIEB2Ym94ZXMucHVzaCB2XHJcbiAgICAgICAgc3dhdGNoZXMucHVzaCBuZXcgU3dhdGNoIGNvbG9yLCB2LmNvdW50KClcclxuXHJcbiAgICBzd2F0Y2hlc1xyXG5cclxuICBfc3BsaXRCb3hlczogKHBxLCB0YXJnZXQpIC0+XHJcbiAgICBjb2xvckNvdW50ID0gMVxyXG4gICAgaXRlcmF0aW9uID0gMFxyXG4gICAgbWF4SXRlcmF0aW9ucyA9IEBvcHRzLm1heEl0ZXJhdGlvbnNcclxuICAgIHdoaWxlIGl0ZXJhdGlvbiA8IG1heEl0ZXJhdGlvbnNcclxuICAgICAgaXRlcmF0aW9uKytcclxuICAgICAgdmJveCA9IHBxLnBvcCgpXHJcbiAgICAgIGlmICF2Ym94LmNvdW50KClcclxuICAgICAgICBjb250aW51ZVxyXG5cclxuICAgICAgW3Zib3gxLCB2Ym94Ml0gPSB2Ym94LnNwbGl0KClcclxuXHJcbiAgICAgIHBxLnB1c2godmJveDEpXHJcbiAgICAgIGlmIHZib3gyXHJcbiAgICAgICAgcHEucHVzaCh2Ym94MilcclxuICAgICAgICBjb2xvckNvdW50KytcclxuICAgICAgaWYgY29sb3JDb3VudCA+PSB0YXJnZXQgb3IgaXRlcmF0aW9uID4gbWF4SXRlcmF0aW9uc1xyXG4gICAgICAgIHJldHVyblxyXG4iLCJtb2R1bGUuZXhwb3J0cyA9XHJcbmNsYXNzIFBRdWV1ZVxyXG4gIGNvbnN0cnVjdG9yOiAoQGNvbXBhcmF0b3IpIC0+XHJcbiAgICBAY29udGVudHMgPSBbXVxyXG4gICAgQHNvcnRlZCA9IGZhbHNlXHJcblxyXG4gIF9zb3J0OiAtPlxyXG4gICAgQGNvbnRlbnRzLnNvcnQoQGNvbXBhcmF0b3IpXHJcbiAgICBAc29ydGVkID0gdHJ1ZVxyXG5cclxuICBwdXNoOiAobykgLT5cclxuICAgIEBjb250ZW50cy5wdXNoIG9cclxuICAgIEBzb3J0ZWQgPSBmYWxzZVxyXG5cclxuICBwZWVrOiAoaW5kZXgpIC0+XHJcbiAgICBpZiBub3QgQHNvcnRlZFxyXG4gICAgICBAX3NvcnQoKVxyXG4gICAgaW5kZXggPz0gQGNvbnRlbnRzLmxlbmd0aCAtIDFcclxuICAgIEBjb250ZW50c1tpbmRleF1cclxuXHJcbiAgcG9wOiAtPlxyXG4gICAgaWYgbm90IEBzb3J0ZWRcclxuICAgICAgQF9zb3J0KClcclxuICAgIEBjb250ZW50cy5wb3AoKVxyXG5cclxuICBzaXplOiAtPlxyXG4gICAgQGNvbnRlbnRzLmxlbmd0aFxyXG5cclxuICBtYXA6IChmKSAtPlxyXG4gICAgaWYgbm90IEBzb3J0ZWRcclxuICAgICAgQF9zb3J0KClcclxuICAgIEBjb250ZW50cy5tYXAoZilcclxuIiwie2dldENvbG9ySW5kZXgsIFNJR0JJVFMsIFJTSElGVH0gPSB1dGlsID0gcmVxdWlyZSgnLi4vLi4vdXRpbCcpXHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9XHJcbmNsYXNzIFZCb3hcclxuICBAYnVpbGQ6IChwaXhlbHMsIHNob3VsZElnbm9yZSkgLT5cclxuICAgIGhuID0gMTw8KDMqU0lHQklUUylcclxuICAgIGhpc3QgPSBuZXcgVWludDMyQXJyYXkoaG4pXHJcbiAgICBybWF4ID0gZ21heCA9IGJtYXggPSAwXHJcbiAgICBybWluID0gZ21pbiA9IGJtaW4gPSBOdW1iZXIuTUFYX1ZBTFVFXHJcbiAgICBuID0gcGl4ZWxzLmxlbmd0aCAvIDRcclxuICAgIGkgPSAwXHJcblxyXG4gICAgd2hpbGUgaSA8IG5cclxuICAgICAgb2Zmc2V0ID0gaSAqIDRcclxuICAgICAgaSsrXHJcbiAgICAgIHIgPSBwaXhlbHNbb2Zmc2V0ICsgMF1cclxuICAgICAgZyA9IHBpeGVsc1tvZmZzZXQgKyAxXVxyXG4gICAgICBiID0gcGl4ZWxzW29mZnNldCArIDJdXHJcbiAgICAgIGEgPSBwaXhlbHNbb2Zmc2V0ICsgM11cclxuICAgICAgIyBUT0RPOiB1c2UgcmVzdWx0IGZyb20gaGlzdFxyXG4gICAgICBpZiBzaG91bGRJZ25vcmUociwgZywgYiwgYSkgdGhlbiBjb250aW51ZVxyXG5cclxuICAgICAgciA9IHIgPj4gUlNISUZUXHJcbiAgICAgIGcgPSBnID4+IFJTSElGVFxyXG4gICAgICBiID0gYiA+PiBSU0hJRlRcclxuXHJcblxyXG4gICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYilcclxuICAgICAgaGlzdFtpbmRleF0gKz0gMVxyXG5cclxuICAgICAgaWYgciA+IHJtYXhcclxuICAgICAgICBybWF4ID0gclxyXG4gICAgICBpZiByIDwgcm1pblxyXG4gICAgICAgIHJtaW4gPSByXHJcbiAgICAgIGlmIGcgPiBnbWF4XHJcbiAgICAgICAgZ21heCA9IGdcclxuICAgICAgaWYgZyA8IGdtaW5cclxuICAgICAgICBnbWluID0gZ1xyXG4gICAgICBpZiBiID4gYm1heFxyXG4gICAgICAgIGJtYXggPSBiXHJcbiAgICAgIGlmIGIgPCBibWluXHJcbiAgICAgICAgYm1pbiA9IGJcclxuXHJcbiAgICBuZXcgVkJveChybWluLCBybWF4LCBnbWluLCBnbWF4LCBibWluLCBibWF4LCBoaXN0KVxyXG5cclxuICBjb25zdHJ1Y3RvcjogKEByMSwgQHIyLCBAZzEsIEBnMiwgQGIxLCBAYjIsIEBoaXN0KSAtPlxyXG4gICAgIyBAX2luaXRCb3goKVxyXG5cclxuICBpbnZhbGlkYXRlOiAtPlxyXG4gICAgZGVsZXRlIEBfY291bnRcclxuICAgIGRlbGV0ZSBAX2F2Z1xyXG4gICAgZGVsZXRlIEBfdm9sdW1lXHJcblxyXG4gIHZvbHVtZTogLT5cclxuICAgIGlmIG5vdCBAX3ZvbHVtZT9cclxuICAgICAgQF92b2x1bWUgPSAoQHIyIC0gQHIxICsgMSkgKiAoQGcyIC0gQGcxICsgMSkgKiAoQGIyIC0gQGIxICsgMSlcclxuICAgIEBfdm9sdW1lXHJcblxyXG4gIGNvdW50OiAtPlxyXG4gICAgaWYgbm90IEBfY291bnQ/XHJcbiAgICAgIGhpc3QgPSBAaGlzdFxyXG4gICAgICBjID0gMFxyXG4gICAgICBgXHJcbiAgICAgIGZvciAodmFyIHIgPSB0aGlzLnIxOyByIDw9IHRoaXMucjI7IHIrKykge1xyXG4gICAgICAgIGZvciAodmFyIGcgPSB0aGlzLmcxOyBnIDw9IHRoaXMuZzI7IGcrKykge1xyXG4gICAgICAgICAgZm9yICh2YXIgYiA9IHRoaXMuYjE7IGIgPD0gdGhpcy5iMjsgYisrKSB7XHJcbiAgICAgICAgICAgIHZhciBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYik7XHJcbiAgICAgICAgICAgIGMgKz0gaGlzdFtpbmRleF07XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGBcclxuICAgICAgIyBmb3IgciBpbiBbQHIxLi5AcjJdXHJcbiAgICAgICMgICBmb3IgZyBpbiBbQGcxLi5AZzJdXHJcbiAgICAgICMgICAgIGZvciBiIGluIFtAYjEuLkBiMl1cclxuICAgICAgIyAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYilcclxuICAgICAgIyAgICAgICBjICs9IGhpc3RbaW5kZXhdXHJcbiAgICAgIEBfY291bnQgPSBjXHJcbiAgICBAX2NvdW50XHJcblxyXG4gIGNsb25lOiAtPlxyXG4gICAgbmV3IFZCb3goQHIxLCBAcjIsIEBnMSwgQGcyLCBAYjEsIEBiMiwgQGhpc3QpXHJcblxyXG4gIGF2ZzogLT5cclxuICAgIGlmIG5vdCBAX2F2Zz9cclxuICAgICAgaGlzdCA9IEBoaXN0XHJcbiAgICAgIG50b3QgPSAwXHJcbiAgICAgIG11bHQgPSAxIDw8ICg4IC0gU0lHQklUUylcclxuICAgICAgcnN1bSA9IGdzdW0gPSBic3VtID0gMFxyXG4gICAgICBgXHJcbiAgICAgIGZvciAodmFyIHIgPSB0aGlzLnIxOyByIDw9IHRoaXMucjI7IHIrKykge1xyXG4gICAgICAgIGZvciAodmFyIGcgPSB0aGlzLmcxOyBnIDw9IHRoaXMuZzI7IGcrKykge1xyXG4gICAgICAgICAgZm9yICh2YXIgYiA9IHRoaXMuYjE7IGIgPD0gdGhpcy5iMjsgYisrKSB7XHJcbiAgICAgICAgICAgIHZhciBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYik7XHJcbiAgICAgICAgICAgIHZhciBoID0gaGlzdFtpbmRleF07XHJcbiAgICAgICAgICAgIG50b3QgKz0gaDtcclxuICAgICAgICAgICAgcnN1bSArPSAoaCAqIChyICsgMC41KSAqIG11bHQpO1xyXG4gICAgICAgICAgICBnc3VtICs9IChoICogKGcgKyAwLjUpICogbXVsdCk7XHJcbiAgICAgICAgICAgIGJzdW0gKz0gKGggKiAoYiArIDAuNSkgKiBtdWx0KTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgYFxyXG4gICAgICAjIE5PVEU6IENvZmZlZVNjcmlwdCB3aWxsIHNjcmV3IHRoaW5ncyB1cCB3aGVuIEByMSA+IEByMlxyXG4gICAgICAjIGZvciByIGluIFtAcjEuLkByMl1cclxuICAgICAgIyAgIGZvciBnIGluIFtAZzEuLkBnMl1cclxuICAgICAgIyAgICAgZm9yIGIgaW4gW0BiMS4uQGIyXVxyXG4gICAgICAjICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChyLCBnLCBiKVxyXG4gICAgICAjICAgICAgIGggPSBoaXN0W2luZGV4XVxyXG4gICAgICAjICAgICAgIG50b3QgKz0gaFxyXG4gICAgICAjICAgICAgIHJzdW0gKz0gKGggKiAociArIDAuNSkgKiBtdWx0KVxyXG4gICAgICAjICAgICAgIGdzdW0gKz0gKGggKiAoZyArIDAuNSkgKiBtdWx0KVxyXG4gICAgICAjICAgICAgIGJzdW0gKz0gKGggKiAoYiArIDAuNSkgKiBtdWx0KVxyXG5cclxuICAgICAgaWYgbnRvdFxyXG4gICAgICAgIEBfYXZnID0gW1xyXG4gICAgICAgICAgfn4ocnN1bSAvIG50b3QpXHJcbiAgICAgICAgICB+fihnc3VtIC8gbnRvdClcclxuICAgICAgICAgIH5+KGJzdW0gLyBudG90KVxyXG4gICAgICAgIF1cclxuICAgICAgZWxzZVxyXG4gICAgICAgIEBfYXZnID0gW1xyXG4gICAgICAgICAgfn4obXVsdCAqIChAcjEgKyBAcjIgKyAxKSAvIDIpXHJcbiAgICAgICAgICB+fihtdWx0ICogKEBnMSArIEBnMiArIDEpIC8gMilcclxuICAgICAgICAgIH5+KG11bHQgKiAoQGIxICsgQGIyICsgMSkgLyAyKVxyXG4gICAgICAgIF1cclxuICAgIEBfYXZnXHJcblxyXG4gIHNwbGl0OiAtPlxyXG4gICAgaGlzdCA9IEBoaXN0XHJcbiAgICBpZiAhQGNvdW50KClcclxuICAgICAgcmV0dXJuIG51bGxcclxuICAgIGlmIEBjb3VudCgpID09IDFcclxuICAgICAgcmV0dXJuIFtAY2xvbmUoKV1cclxuXHJcbiAgICBydyA9IEByMiAtIEByMSArIDFcclxuICAgIGd3ID0gQGcyIC0gQGcxICsgMVxyXG4gICAgYncgPSBAYjIgLSBAYjEgKyAxXHJcblxyXG4gICAgbWF4dyA9IE1hdGgubWF4KHJ3LCBndywgYncpXHJcbiAgICBhY2NTdW0gPSBudWxsXHJcbiAgICBzdW0gPSB0b3RhbCA9IDBcclxuXHJcbiAgICBtYXhkID0gbnVsbFxyXG4gICAgc3dpdGNoIG1heHdcclxuICAgICAgd2hlbiByd1xyXG4gICAgICAgIG1heGQgPSAncidcclxuICAgICAgICBhY2NTdW0gPSBuZXcgVWludDMyQXJyYXkoQHIyICsgMSlcclxuICAgICAgICBgXHJcbiAgICAgICAgZm9yICh2YXIgciA9IHRoaXMucjE7IHIgPD0gdGhpcy5yMjsgcisrKSB7XHJcbiAgICAgICAgICBzdW0gPSAwXHJcbiAgICAgICAgICBmb3IgKHZhciBnID0gdGhpcy5nMTsgZyA8PSB0aGlzLmcyOyBnKyspIHtcclxuICAgICAgICAgICAgZm9yICh2YXIgYiA9IHRoaXMuYjE7IGIgPD0gdGhpcy5iMjsgYisrKSB7XHJcbiAgICAgICAgICAgICAgdmFyIGluZGV4ID0gZ2V0Q29sb3JJbmRleChyLCBnLCBiKTtcclxuICAgICAgICAgICAgICBzdW0gKz0gaGlzdFtpbmRleF07XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgIH1cclxuICAgICAgICAgIHRvdGFsICs9IHN1bTtcclxuICAgICAgICAgIGFjY1N1bVtyXSA9IHRvdGFsO1xyXG4gICAgICAgIH1cclxuICAgICAgICBgXHJcbiAgICAgICAgIyBmb3IgciBpbiBbQHIxLi5AcjJdXHJcbiAgICAgICAgIyAgIHN1bSA9IDBcclxuICAgICAgICAjICAgZm9yIGcgaW4gW0BnMS4uQGcyXVxyXG4gICAgICAgICMgICAgIGZvciBiIGluIFtAYjEuLkBiMl1cclxuICAgICAgICAjICAgICAgIGluZGV4ID0gZ2V0Q29sb3JJbmRleChyLCBnLCBiKVxyXG4gICAgICAgICMgICAgICAgc3VtICs9IGhpc3RbaW5kZXhdXHJcbiAgICAgICAgIyAgIHRvdGFsICs9IHN1bVxyXG4gICAgICAgICMgICBhY2NTdW1bcl0gPSB0b3RhbFxyXG4gICAgICB3aGVuIGd3XHJcbiAgICAgICAgbWF4ZCA9ICdnJ1xyXG4gICAgICAgIGFjY1N1bSA9IG5ldyBVaW50MzJBcnJheShAZzIgKyAxKVxyXG4gICAgICAgIGBcclxuICAgICAgICBmb3IgKHZhciBnID0gdGhpcy5nMTsgZyA8PSB0aGlzLmcyOyBnKyspIHtcclxuICAgICAgICAgIHN1bSA9IDBcclxuICAgICAgICAgIGZvciAodmFyIHIgPSB0aGlzLnIxOyByIDw9IHRoaXMucjI7IHIrKykge1xyXG4gICAgICAgICAgICBmb3IgKHZhciBiID0gdGhpcy5iMTsgYiA8PSB0aGlzLmIyOyBiKyspIHtcclxuICAgICAgICAgICAgICB2YXIgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpO1xyXG4gICAgICAgICAgICAgIHN1bSArPSBoaXN0W2luZGV4XTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgdG90YWwgKz0gc3VtO1xyXG4gICAgICAgICAgYWNjU3VtW2ddID0gdG90YWw7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGBcclxuICAgICAgICAjIGZvciBnIGluIFtAZzEuLkBnMl1cclxuICAgICAgICAjICAgc3VtID0gMFxyXG4gICAgICAgICMgICBmb3IgciBpbiBbQHIxLi5AcjJdXHJcbiAgICAgICAgIyAgICAgZm9yIGIgaW4gW0BiMS4uQGIyXVxyXG4gICAgICAgICMgICAgICAgaW5kZXggPSBnZXRDb2xvckluZGV4KHIsIGcsIGIpXHJcbiAgICAgICAgIyAgICAgICBzdW0gKz0gaGlzdFtpbmRleF1cclxuICAgICAgICAjICAgdG90YWwgKz0gc3VtXHJcbiAgICAgICAgIyAgIGFjY1N1bVtnXSA9IHRvdGFsXHJcbiAgICAgIHdoZW4gYndcclxuICAgICAgICBtYXhkID0gJ2InXHJcbiAgICAgICAgYWNjU3VtID0gbmV3IFVpbnQzMkFycmF5KEBiMiArIDEpXHJcbiAgICAgICAgYFxyXG4gICAgICAgIGZvciAodmFyIGIgPSB0aGlzLmIxOyBiIDw9IHRoaXMuYjI7IGIrKykge1xyXG4gICAgICAgICAgc3VtID0gMFxyXG4gICAgICAgICAgZm9yICh2YXIgciA9IHRoaXMucjE7IHIgPD0gdGhpcy5yMjsgcisrKSB7XHJcbiAgICAgICAgICAgIGZvciAodmFyIGcgPSB0aGlzLmcxOyBnIDw9IHRoaXMuZzI7IGcrKykge1xyXG4gICAgICAgICAgICAgIHZhciBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYik7XHJcbiAgICAgICAgICAgICAgc3VtICs9IGhpc3RbaW5kZXhdO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICB0b3RhbCArPSBzdW07XHJcbiAgICAgICAgICBhY2NTdW1bYl0gPSB0b3RhbDtcclxuICAgICAgICB9XHJcbiAgICAgICAgYFxyXG4gICAgICAgICMgZm9yIGIgaW4gW0BiMS4uQGIyXVxyXG4gICAgICAgICMgICBzdW0gPSAwXHJcbiAgICAgICAgIyAgIGZvciByIGluIFtAcjEuLkByMl1cclxuICAgICAgICAjICAgICBmb3IgZyBpbiBbQGcxLi5AZzJdXHJcbiAgICAgICAgIyAgICAgICBpbmRleCA9IGdldENvbG9ySW5kZXgociwgZywgYilcclxuICAgICAgICAjICAgICAgIHN1bSArPSBoaXN0W2luZGV4XVxyXG4gICAgICAgICMgICB0b3RhbCArPSBzdW1cclxuICAgICAgICAjICAgYWNjU3VtW2JdID0gdG90YWxcclxuXHJcbiAgICBzcGxpdFBvaW50ID0gLTFcclxuICAgIHJldmVyc2VTdW0gPSBuZXcgVWludDMyQXJyYXkoYWNjU3VtLmxlbmd0aClcclxuICAgIGZvciBpIGluIFswLi5hY2NTdW0ubGVuZ3RoLTFdXHJcbiAgICAgIGQgPSBhY2NTdW1baV1cclxuICAgICAgaWYgc3BsaXRQb2ludCA8IDAgJiYgZCA+IHRvdGFsIC8gMlxyXG4gICAgICAgIHNwbGl0UG9pbnQgPSBpXHJcbiAgICAgIHJldmVyc2VTdW1baV0gPSB0b3RhbCAtIGRcclxuXHJcbiAgICB2Ym94ID0gdGhpc1xyXG4gICAgZG9DdXQgPSAoZCkgLT5cclxuICAgICAgZGltMSA9IGQgKyBcIjFcIlxyXG4gICAgICBkaW0yID0gZCArIFwiMlwiXHJcbiAgICAgIGQxID0gdmJveFtkaW0xXVxyXG4gICAgICBkMiA9IHZib3hbZGltMl1cclxuICAgICAgdmJveDEgPSB2Ym94LmNsb25lKClcclxuICAgICAgdmJveDIgPSB2Ym94LmNsb25lKClcclxuICAgICAgbGVmdCA9IHNwbGl0UG9pbnQgLSBkMVxyXG4gICAgICByaWdodCA9IGQyIC0gc3BsaXRQb2ludFxyXG4gICAgICBpZiBsZWZ0IDw9IHJpZ2h0XHJcbiAgICAgICAgZDIgPSBNYXRoLm1pbihkMiAtIDEsIH5+IChzcGxpdFBvaW50ICsgcmlnaHQgLyAyKSlcclxuICAgICAgICBkMiA9IE1hdGgubWF4KDAsIGQyKVxyXG4gICAgICBlbHNlXHJcbiAgICAgICAgZDIgPSBNYXRoLm1heChkMSwgfn4gKHNwbGl0UG9pbnQgLSAxIC0gbGVmdCAvIDIpKVxyXG4gICAgICAgIGQyID0gTWF0aC5taW4odmJveFtkaW0yXSwgZDIpXHJcblxyXG5cclxuICAgICAgd2hpbGUgIWFjY1N1bVtkMl1cclxuICAgICAgICBkMisrXHJcblxyXG5cclxuICAgICAgYzIgPSByZXZlcnNlU3VtW2QyXVxyXG4gICAgICB3aGlsZSAhYzIgYW5kIGFjY1N1bVtkMiAtIDFdXHJcbiAgICAgICAgYzIgPSByZXZlcnNlU3VtWy0tZDJdXHJcblxyXG4gICAgICB2Ym94MVtkaW0yXSA9IGQyXHJcbiAgICAgIHZib3gyW2RpbTFdID0gZDIgKyAxXHJcbiAgICAgICMgdmJveC5pbnZhbGlkYXRlKClcclxuXHJcbiAgICAgIHJldHVybiBbdmJveDEsIHZib3gyXVxyXG5cclxuICAgIGRvQ3V0IG1heGRcclxuXHJcbiAgY29udGFpbnM6IChwKSAtPlxyXG4gICAgciA9IHBbMF0+PlJTSElGVFxyXG4gICAgZyA9IHBbMV0+PlJTSElGVFxyXG4gICAgYiA9IHBbMl0+PlJTSElGVFxyXG5cclxuICAgIHIgPj0gQHIxIGFuZCByIDw9IEByMiBhbmQgZyA+PSBAZzEgYW5kIGcgPD0gQGcyIGFuZCBiID49IEBiMSBhbmQgYiA8PSBAYjJcclxuIiwibW9kdWxlLmV4cG9ydHMgPVxuY2xhc3MgUXVhbnRpemVyXG4gIGluaXRpYWxpemU6IChwaXhlbHMsIG9wdHMpIC0+XG5cbiAgZ2V0UXVhbnRpemVkQ29sb3JzOiAtPlxuXG5tb2R1bGUuZXhwb3J0cy5NTUNRID0gcmVxdWlyZSgnLi9tbWNxJylcbiIsIlN3YXRjaCA9IHJlcXVpcmUoJy4uL3N3YXRjaCcpXHJcblF1YW50aXplciA9IHJlcXVpcmUoJy4vaW5kZXgnKVxyXG5NTUNRSW1wbCA9IHJlcXVpcmUoJy4vaW1wbC9tbWNxJylcclxuXHJcbm1vZHVsZS5leHBvcnRzID1cclxuY2xhc3MgTU1DUSBleHRlbmRzIFF1YW50aXplclxyXG4gIGluaXRpYWxpemU6IChwaXhlbHMsIEBvcHRzKSAtPlxyXG4gICAgbW1jcSA9IG5ldyBNTUNRSW1wbCgpXHJcbiAgICBAc3dhdGNoZXMgPSBtbWNxLnF1YW50aXplIHBpeGVscywgQG9wdHNcclxuXHJcbiAgZ2V0UXVhbnRpemVkQ29sb3JzOiAtPlxyXG4gICAgQHN3YXRjaGVzXHJcbiIsInV0aWwgPSByZXF1aXJlKCcuL3V0aWwnKVxuIyMjXG4gIEZyb20gVmlicmFudC5qcyBieSBKYXJpIFp3YXJ0c1xuICBQb3J0ZWQgdG8gbm9kZS5qcyBieSBBS0Zpc2hcblxuICBTd2F0Y2ggY2xhc3NcbiMjI1xubW9kdWxlLmV4cG9ydHMgPVxuY2xhc3MgU3dhdGNoXG4gIGhzbDogdW5kZWZpbmVkXG4gIHJnYjogdW5kZWZpbmVkXG4gIHBvcHVsYXRpb246IDFcbiAgeWlxOiAwXG5cbiAgY29uc3RydWN0b3I6IChyZ2IsIHBvcHVsYXRpb24pIC0+XG4gICAgQHJnYiA9IHJnYlxuICAgIEBwb3B1bGF0aW9uID0gcG9wdWxhdGlvblxuXG4gIGdldEhzbDogLT5cbiAgICBpZiBub3QgQGhzbFxuICAgICAgQGhzbCA9IHV0aWwucmdiVG9Ic2wgQHJnYlswXSwgQHJnYlsxXSwgQHJnYlsyXVxuICAgIGVsc2UgQGhzbFxuXG4gIGdldFBvcHVsYXRpb246IC0+XG4gICAgQHBvcHVsYXRpb25cblxuICBnZXRSZ2I6IC0+XG4gICAgQHJnYlxuXG4gIGdldEhleDogLT5cbiAgICB1dGlsLnJnYlRvSGV4KEByZ2JbMF0sIEByZ2JbMV0sIEByZ2JbMl0pXG5cbiAgZ2V0VGl0bGVUZXh0Q29sb3I6IC0+XG4gICAgQF9lbnN1cmVUZXh0Q29sb3JzKClcbiAgICBpZiBAeWlxIDwgMjAwIHRoZW4gXCIjZmZmXCIgZWxzZSBcIiMwMDBcIlxuXG4gIGdldEJvZHlUZXh0Q29sb3I6IC0+XG4gICAgQF9lbnN1cmVUZXh0Q29sb3JzKClcbiAgICBpZiBAeWlxIDwgMTUwIHRoZW4gXCIjZmZmXCIgZWxzZSBcIiMwMDBcIlxuXG4gIF9lbnN1cmVUZXh0Q29sb3JzOiAtPlxuICAgIGlmIG5vdCBAeWlxIHRoZW4gQHlpcSA9IChAcmdiWzBdICogMjk5ICsgQHJnYlsxXSAqIDU4NyArIEByZ2JbMl0gKiAxMTQpIC8gMTAwMFxuIiwiREVMVEFFOTQgPVxuICBOQTogMFxuICBQRVJGRUNUOiAxXG4gIENMT1NFOiAyXG4gIEdPT0Q6IDEwXG4gIFNJTUlMQVI6IDUwXG5cblNJR0JJVFMgPSA1XG5SU0hJRlQgPSA4IC0gU0lHQklUU1xuXG5cblxubW9kdWxlLmV4cG9ydHMgPVxuICBjbG9uZTogKG8pIC0+XG4gICAgaWYgdHlwZW9mIG8gPT0gJ29iamVjdCdcbiAgICAgIGlmIEFycmF5LmlzQXJyYXkgb1xuICAgICAgICByZXR1cm4gby5tYXAgKHYpID0+IHRoaXMuY2xvbmUgdlxuICAgICAgZWxzZVxuICAgICAgICBfbyA9IHt9XG4gICAgICAgIGZvciBrZXksIHZhbHVlIG9mIG9cbiAgICAgICAgICBfb1trZXldID0gdGhpcy5jbG9uZSB2YWx1ZVxuICAgICAgICByZXR1cm4gX29cbiAgICBvXG5cbiAgZGVmYXVsdHM6ICgpIC0+XG4gICAgbyA9IHt9XG4gICAgZm9yIF9vIGluIGFyZ3VtZW50c1xuICAgICAgZm9yIGtleSwgdmFsdWUgb2YgX29cbiAgICAgICAgaWYgbm90IG9ba2V5XT8gdGhlbiBvW2tleV0gPSB0aGlzLmNsb25lIHZhbHVlXG5cbiAgICBvXG5cbiAgaGV4VG9SZ2I6IChoZXgpIC0+XG4gICAgbSA9IC9eIz8oW2EtZlxcZF17Mn0pKFthLWZcXGRdezJ9KShbYS1mXFxkXXsyfSkkL2kuZXhlYyhoZXgpXG4gICAgaWYgbT9cbiAgICAgIHJldHVybiBbbVsxXSwgbVsyXSwgbVszXV0ubWFwIChzKSAtPiBwYXJzZUludChzLCAxNilcbiAgICByZXR1cm4gbnVsbFxuXG4gIHJnYlRvSGV4OiAociwgZywgYikgLT5cbiAgICBcIiNcIiArICgoMSA8PCAyNCkgKyAociA8PCAxNikgKyAoZyA8PCA4KSArIGIpLnRvU3RyaW5nKDE2KS5zbGljZSgxLCA3KVxuXG4gIHJnYlRvSHNsOiAociwgZywgYikgLT5cbiAgICByIC89IDI1NVxuICAgIGcgLz0gMjU1XG4gICAgYiAvPSAyNTVcbiAgICBtYXggPSBNYXRoLm1heChyLCBnLCBiKVxuICAgIG1pbiA9IE1hdGgubWluKHIsIGcsIGIpXG4gICAgaCA9IHVuZGVmaW5lZFxuICAgIHMgPSB1bmRlZmluZWRcbiAgICBsID0gKG1heCArIG1pbikgLyAyXG4gICAgaWYgbWF4ID09IG1pblxuICAgICAgaCA9IHMgPSAwXG4gICAgICAjIGFjaHJvbWF0aWNcbiAgICBlbHNlXG4gICAgICBkID0gbWF4IC0gbWluXG4gICAgICBzID0gaWYgbCA+IDAuNSB0aGVuIGQgLyAoMiAtIG1heCAtIG1pbikgZWxzZSBkIC8gKG1heCArIG1pbilcbiAgICAgIHN3aXRjaCBtYXhcbiAgICAgICAgd2hlbiByXG4gICAgICAgICAgaCA9IChnIC0gYikgLyBkICsgKGlmIGcgPCBiIHRoZW4gNiBlbHNlIDApXG4gICAgICAgIHdoZW4gZ1xuICAgICAgICAgIGggPSAoYiAtIHIpIC8gZCArIDJcbiAgICAgICAgd2hlbiBiXG4gICAgICAgICAgaCA9IChyIC0gZykgLyBkICsgNFxuICAgICAgaCAvPSA2XG4gICAgW2gsIHMsIGxdXG5cbiAgaHNsVG9SZ2I6IChoLCBzLCBsKSAtPlxuICAgIHIgPSB1bmRlZmluZWRcbiAgICBnID0gdW5kZWZpbmVkXG4gICAgYiA9IHVuZGVmaW5lZFxuXG4gICAgaHVlMnJnYiA9IChwLCBxLCB0KSAtPlxuICAgICAgaWYgdCA8IDBcbiAgICAgICAgdCArPSAxXG4gICAgICBpZiB0ID4gMVxuICAgICAgICB0IC09IDFcbiAgICAgIGlmIHQgPCAxIC8gNlxuICAgICAgICByZXR1cm4gcCArIChxIC0gcCkgKiA2ICogdFxuICAgICAgaWYgdCA8IDEgLyAyXG4gICAgICAgIHJldHVybiBxXG4gICAgICBpZiB0IDwgMiAvIDNcbiAgICAgICAgcmV0dXJuIHAgKyAocSAtIHApICogKDIgLyAzIC0gdCkgKiA2XG4gICAgICBwXG5cbiAgICBpZiBzID09IDBcbiAgICAgIHIgPSBnID0gYiA9IGxcbiAgICAgICMgYWNocm9tYXRpY1xuICAgIGVsc2VcbiAgICAgIHEgPSBpZiBsIDwgMC41IHRoZW4gbCAqICgxICsgcykgZWxzZSBsICsgcyAtIChsICogcylcbiAgICAgIHAgPSAyICogbCAtIHFcbiAgICAgIHIgPSBodWUycmdiKHAsIHEsIGggKyAxIC8gMylcbiAgICAgIGcgPSBodWUycmdiKHAsIHEsIGgpXG4gICAgICBiID0gaHVlMnJnYihwLCBxLCBoIC0gKDEgLyAzKSlcbiAgICBbXG4gICAgICByICogMjU1XG4gICAgICBnICogMjU1XG4gICAgICBiICogMjU1XG4gICAgXVxuXG4gIHJnYlRvWHl6OiAociwgZywgYikgLT5cbiAgICByIC89IDI1NVxuICAgIGcgLz0gMjU1XG4gICAgYiAvPSAyNTVcbiAgICByID0gaWYgciA+IDAuMDQwNDUgdGhlbiBNYXRoLnBvdygociArIDAuMDA1KSAvIDEuMDU1LCAyLjQpIGVsc2UgciAvIDEyLjkyXG4gICAgZyA9IGlmIGcgPiAwLjA0MDQ1IHRoZW4gTWF0aC5wb3coKGcgKyAwLjAwNSkgLyAxLjA1NSwgMi40KSBlbHNlIGcgLyAxMi45MlxuICAgIGIgPSBpZiBiID4gMC4wNDA0NSB0aGVuIE1hdGgucG93KChiICsgMC4wMDUpIC8gMS4wNTUsIDIuNCkgZWxzZSBiIC8gMTIuOTJcblxuICAgIHIgKj0gMTAwXG4gICAgZyAqPSAxMDBcbiAgICBiICo9IDEwMFxuXG4gICAgeCA9IHIgKiAwLjQxMjQgKyBnICogMC4zNTc2ICsgYiAqIDAuMTgwNVxuICAgIHkgPSByICogMC4yMTI2ICsgZyAqIDAuNzE1MiArIGIgKiAwLjA3MjJcbiAgICB6ID0gciAqIDAuMDE5MyArIGcgKiAwLjExOTIgKyBiICogMC45NTA1XG5cbiAgICBbeCwgeSwgel1cblxuICB4eXpUb0NJRUxhYjogKHgsIHksIHopIC0+XG4gICAgUkVGX1ggPSA5NS4wNDdcbiAgICBSRUZfWSA9IDEwMFxuICAgIFJFRl9aID0gMTA4Ljg4M1xuXG4gICAgeCAvPSBSRUZfWFxuICAgIHkgLz0gUkVGX1lcbiAgICB6IC89IFJFRl9aXG5cbiAgICB4ID0gaWYgeCA+IDAuMDA4ODU2IHRoZW4gTWF0aC5wb3coeCwgMS8zKSBlbHNlIDcuNzg3ICogeCArIDE2IC8gMTE2XG4gICAgeSA9IGlmIHkgPiAwLjAwODg1NiB0aGVuIE1hdGgucG93KHksIDEvMykgZWxzZSA3Ljc4NyAqIHkgKyAxNiAvIDExNlxuICAgIHogPSBpZiB6ID4gMC4wMDg4NTYgdGhlbiBNYXRoLnBvdyh6LCAxLzMpIGVsc2UgNy43ODcgKiB6ICsgMTYgLyAxMTZcblxuICAgIEwgPSAxMTYgKiB5IC0gMTZcbiAgICBhID0gNTAwICogKHggLSB5KVxuICAgIGIgPSAyMDAgKiAoeSAtIHopXG5cbiAgICBbTCwgYSwgYl1cblxuICByZ2JUb0NJRUxhYjogKHIsIGcsIGIpIC0+XG4gICAgW3gsIHksIHpdID0gdGhpcy5yZ2JUb1h5eiByLCBnLCBiXG4gICAgdGhpcy54eXpUb0NJRUxhYiB4LCB5LCB6XG5cbiAgZGVsdGFFOTQ6IChsYWIxLCBsYWIyKSAtPlxuICAgICMgV2VpZ2h0c1xuICAgIFdFSUdIVF9MID0gMVxuICAgIFdFSUdIVF9DID0gMVxuICAgIFdFSUdIVF9IID0gMVxuXG4gICAgW0wxLCBhMSwgYjFdID0gbGFiMVxuICAgIFtMMiwgYTIsIGIyXSA9IGxhYjJcbiAgICBkTCA9IEwxIC0gTDJcbiAgICBkYSA9IGExIC0gYTJcbiAgICBkYiA9IGIxIC0gYjJcblxuICAgIHhDMSA9IE1hdGguc3FydCBhMSAqIGExICsgYjEgKiBiMVxuICAgIHhDMiA9IE1hdGguc3FydCBhMiAqIGEyICsgYjIgKiBiMlxuXG4gICAgeERMID0gTDIgLSBMMVxuICAgIHhEQyA9IHhDMiAtIHhDMVxuICAgIHhERSA9IE1hdGguc3FydCBkTCAqIGRMICsgZGEgKiBkYSArIGRiICogZGJcblxuICAgIGlmIE1hdGguc3FydCh4REUpID4gTWF0aC5zcXJ0KE1hdGguYWJzKHhETCkpICsgTWF0aC5zcXJ0KE1hdGguYWJzKHhEQykpXG4gICAgICB4REggPSBNYXRoLnNxcnQgeERFICogeERFIC0geERMICogeERMIC0geERDICogeERDXG4gICAgZWxzZVxuICAgICAgeERIID0gMFxuXG4gICAgeFNDID0gMSArIDAuMDQ1ICogeEMxXG4gICAgeFNIID0gMSArIDAuMDE1ICogeEMxXG5cbiAgICB4REwgLz0gV0VJR0hUX0xcbiAgICB4REMgLz0gV0VJR0hUX0MgKiB4U0NcbiAgICB4REggLz0gV0VJR0hUX0ggKiB4U0hcblxuICAgIE1hdGguc3FydCB4REwgKiB4REwgKyB4REMgKiB4REMgKyB4REggKiB4REhcblxuICByZ2JEaWZmOiAocmdiMSwgcmdiMikgLT5cbiAgICBsYWIxID0gQHJnYlRvQ0lFTGFiLmFwcGx5IEAsIHJnYjFcbiAgICBsYWIyID0gQHJnYlRvQ0lFTGFiLmFwcGx5IEAsIHJnYjJcbiAgICBAZGVsdGFFOTQgbGFiMSwgbGFiMlxuXG4gIGhleERpZmY6IChoZXgxLCBoZXgyKSAtPlxuICAgICMgY29uc29sZS5sb2cgXCJDb21wYXJlICN7aGV4MX0gI3toZXgyfVwiXG4gICAgcmdiMSA9IEBoZXhUb1JnYiBoZXgxXG4gICAgcmdiMiA9IEBoZXhUb1JnYiBoZXgyXG4gICAgIyBjb25zb2xlLmxvZyByZ2IxXG4gICAgIyBjb25zb2xlLmxvZyByZ2IyXG4gICAgQHJnYkRpZmYgcmdiMSwgcmdiMlxuXG4gIERFTFRBRTk0X0RJRkZfU1RBVFVTOiBERUxUQUU5NFxuXG4gIGdldENvbG9yRGlmZlN0YXR1czogKGQpIC0+XG4gICAgaWYgZCA8IERFTFRBRTk0Lk5BXG4gICAgICByZXR1cm4gXCJOL0FcIlxuICAgICMgTm90IHBlcmNlcHRpYmxlIGJ5IGh1bWFuIGV5ZXNcbiAgICBpZiBkIDw9IERFTFRBRTk0LlBFUkZFQ1RcbiAgICAgIHJldHVybiBcIlBlcmZlY3RcIlxuICAgICMgUGVyY2VwdGlibGUgdGhyb3VnaCBjbG9zZSBvYnNlcnZhdGlvblxuICAgIGlmIGQgPD0gREVMVEFFOTQuQ0xPU0VcbiAgICAgIHJldHVybiBcIkNsb3NlXCJcbiAgICAjIFBlcmNlcHRpYmxlIGF0IGEgZ2xhbmNlXG4gICAgaWYgZCA8PSBERUxUQUU5NC5HT09EXG4gICAgICByZXR1cm4gXCJHb29kXCJcbiAgICAjIENvbG9ycyBhcmUgbW9yZSBzaW1pbGFyIHRoYW4gb3Bwb3NpdGVcbiAgICBpZiBkIDwgREVMVEFFOTQuU0lNSUxBUlxuICAgICAgcmV0dXJuIFwiU2ltaWxhclwiXG4gICAgcmV0dXJuIFwiV3JvbmdcIlxuXG4gIFNJR0JJVFM6IFNJR0JJVFNcbiAgUlNISUZUOiBSU0hJRlRcbiAgZ2V0Q29sb3JJbmRleDogKHIsIGcsIGIpIC0+XG4gICAgKHI8PCgyKlNJR0JJVFMpKSArIChnIDw8IFNJR0JJVFMpICsgYlxuIiwiIyMjXG4gIEZyb20gVmlicmFudC5qcyBieSBKYXJpIFp3YXJ0c1xuICBQb3J0ZWQgdG8gbm9kZS5qcyBieSBBS0Zpc2hcblxuICBDb2xvciBhbGdvcml0aG0gY2xhc3MgdGhhdCBmaW5kcyB2YXJpYXRpb25zIG9uIGNvbG9ycyBpbiBhbiBpbWFnZS5cblxuICBDcmVkaXRzXG4gIC0tLS0tLS0tXG4gIExva2VzaCBEaGFrYXIgKGh0dHA6Ly93d3cubG9rZXNoZGhha2FyLmNvbSkgLSBDcmVhdGVkIENvbG9yVGhpZWZcbiAgR29vZ2xlIC0gUGFsZXR0ZSBzdXBwb3J0IGxpYnJhcnkgaW4gQW5kcm9pZFxuIyMjXG5Td2F0Y2ggPSByZXF1aXJlKCcuL3N3YXRjaCcpXG51dGlsID0gcmVxdWlyZSgnLi91dGlsJylcbkRlZmF1bHRHZW5lcmF0b3IgPSByZXF1aXJlKCcuL2dlbmVyYXRvcicpLkRlZmF1bHRcbkZpbHRlciA9IHJlcXVpcmUoJy4vZmlsdGVyJylcblxubW9kdWxlLmV4cG9ydHMgPVxuY2xhc3MgVmlicmFudFxuICBARGVmYXVsdE9wdHM6XG4gICAgY29sb3JDb3VudDogNjRcbiAgICBxdWFsaXR5OiA1XG4gICAgZ2VuZXJhdG9yOiBuZXcgRGVmYXVsdEdlbmVyYXRvcigpXG4gICAgSW1hZ2U6IG51bGxcbiAgICBRdWFudGl6ZXI6IHJlcXVpcmUoJy4vcXVhbnRpemVyJykuTU1DUVxuICAgIGZpbHRlcnM6IFtdXG5cbiAgQGZyb206IChzcmMpIC0+XG4gICAgbmV3IEJ1aWxkZXIoc3JjKVxuXG4gIHF1YW50aXplOiByZXF1aXJlKCdxdWFudGl6ZScpXG5cbiAgX3N3YXRjaGVzOiBbXVxuXG4gIGNvbnN0cnVjdG9yOiAoQHNvdXJjZUltYWdlLCBvcHRzID0ge30pIC0+XG4gICAgQG9wdHMgPSB1dGlsLmRlZmF1bHRzKG9wdHMsIEBjb25zdHJ1Y3Rvci5EZWZhdWx0T3B0cylcbiAgICBAZ2VuZXJhdG9yID0gQG9wdHMuZ2VuZXJhdG9yXG5cbiAgZ2V0UGFsZXR0ZTogKGNiKSAtPlxuICAgIGltYWdlID0gbmV3IEBvcHRzLkltYWdlIEBzb3VyY2VJbWFnZSwgKGVyciwgaW1hZ2UpID0+XG4gICAgICBpZiBlcnI/IHRoZW4gcmV0dXJuIGNiKGVycilcbiAgICAgIHRyeVxuICAgICAgICBAX3Byb2Nlc3MgaW1hZ2UsIEBvcHRzXG4gICAgICAgIGNiIG51bGwsIEBzd2F0Y2hlcygpXG4gICAgICBjYXRjaCBlcnJvclxuICAgICAgICByZXR1cm4gY2IoZXJyb3IpXG5cbiAgZ2V0U3dhdGNoZXM6IChjYikgLT5cbiAgICBAZ2V0UGFsZXR0ZSBjYlxuXG4gIF9wcm9jZXNzOiAoaW1hZ2UsIG9wdHMpIC0+XG4gICAgaW1hZ2Uuc2NhbGVEb3duKEBvcHRzKVxuICAgIGltYWdlRGF0YSA9IGltYWdlLmdldEltYWdlRGF0YSgpXG5cbiAgICBxdWFudGl6ZXIgPSBuZXcgQG9wdHMuUXVhbnRpemVyKClcbiAgICBxdWFudGl6ZXIuaW5pdGlhbGl6ZShpbWFnZURhdGEuZGF0YSwgQG9wdHMpXG5cbiAgICBzd2F0Y2hlcyA9IHF1YW50aXplci5nZXRRdWFudGl6ZWRDb2xvcnMoKVxuXG4gICAgQGdlbmVyYXRvci5nZW5lcmF0ZShzd2F0Y2hlcylcbiAgICAjIENsZWFuIHVwXG4gICAgaW1hZ2UucmVtb3ZlQ2FudmFzKClcblxuICBzd2F0Y2hlczogPT5cbiAgICBWaWJyYW50OiAgICAgIEBnZW5lcmF0b3IuZ2V0VmlicmFudFN3YXRjaCgpXG4gICAgTXV0ZWQ6ICAgICAgICBAZ2VuZXJhdG9yLmdldE11dGVkU3dhdGNoKClcbiAgICBEYXJrVmlicmFudDogIEBnZW5lcmF0b3IuZ2V0RGFya1ZpYnJhbnRTd2F0Y2goKVxuICAgIERhcmtNdXRlZDogICAgQGdlbmVyYXRvci5nZXREYXJrTXV0ZWRTd2F0Y2goKVxuICAgIExpZ2h0VmlicmFudDogQGdlbmVyYXRvci5nZXRMaWdodFZpYnJhbnRTd2F0Y2goKVxuICAgIExpZ2h0TXV0ZWQ6ICAgQGdlbmVyYXRvci5nZXRMaWdodE11dGVkU3dhdGNoKClcblxubW9kdWxlLmV4cG9ydHMuQnVpbGRlciA9XG5jbGFzcyBCdWlsZGVyXG4gIGNvbnN0cnVjdG9yOiAoQHNyYywgQG9wdHMgPSB7fSkgLT5cbiAgICBAb3B0cy5maWx0ZXJzID0gdXRpbC5jbG9uZSBWaWJyYW50LkRlZmF1bHRPcHRzLmZpbHRlcnNcblxuICBtYXhDb2xvckNvdW50OiAobikgLT5cbiAgICBAb3B0cy5jb2xvckNvdW50ID0gblxuICAgIEBcblxuICBtYXhEaW1lbnNpb246IChkKSAtPlxuICAgIEBvcHRzLm1heERpbWVuc2lvbiA9IGRcbiAgICBAXG5cbiAgYWRkRmlsdGVyOiAoZikgLT5cbiAgICBpZiB0eXBlb2YgZiA9PSAnZnVuY3Rpb24nXG4gICAgICBAb3B0cy5maWx0ZXJzLnB1c2ggZlxuICAgIEBcblxuICByZW1vdmVGaWx0ZXI6IChmKSAtPlxuICAgIGlmIChpID0gQG9wdHMuZmlsdGVycy5pbmRleE9mKGYpKSA+IDBcbiAgICAgIEBvcHRzLmZpbHRlcnMuc3BsaWNlKGkpXG4gICAgQFxuXG4gIGNsZWFyRmlsdGVyczogLT5cbiAgICBAb3B0cy5maWx0ZXJzID0gW11cbiAgICBAXG5cbiAgcXVhbGl0eTogKHEpIC0+XG4gICAgQG9wdHMucXVhbGl0eSA9IHFcbiAgICBAXG5cbiAgdXNlSW1hZ2U6IChpbWFnZSkgLT5cbiAgICBAb3B0cy5JbWFnZSA9IGltYWdlXG4gICAgQFxuXG4gIHVzZUdlbmVyYXRvcjogKGdlbmVyYXRvcikgLT5cbiAgICBAb3B0cy5nZW5lcmF0b3IgPSBnZW5lcmF0b3JcbiAgICBAXG5cbiAgdXNlUXVhbnRpemVyOiAocXVhbnRpemVyKSAtPlxuICAgIEBvcHRzLlF1YW50aXplciA9IHF1YW50aXplclxuICAgIEBcblxuICBidWlsZDogLT5cbiAgICBpZiBub3QgQHY/XG4gICAgICBAdiA9IG5ldyBWaWJyYW50KEBzcmMsIEBvcHRzKVxuICAgIEB2XG5cbiAgZ2V0U3dhdGNoZXM6IChjYikgLT5cbiAgICBAYnVpbGQoKS5nZXRQYWxldHRlIGNiXG5cbiAgZ2V0UGFsZXR0ZTogKGNiKSAtPlxuICAgIEBidWlsZCgpLmdldFBhbGV0dGUgY2JcblxuICBmcm9tOiAoc3JjKSAtPlxuICAgIG5ldyBWaWJyYW50KHNyYywgQG9wdHMpXG5cbm1vZHVsZS5leHBvcnRzLlV0aWwgPSB1dGlsXG5tb2R1bGUuZXhwb3J0cy5Td2F0Y2ggPSBTd2F0Y2hcbm1vZHVsZS5leHBvcnRzLlF1YW50aXplciA9IHJlcXVpcmUoJy4vcXVhbnRpemVyLycpXG5tb2R1bGUuZXhwb3J0cy5HZW5lcmF0b3IgPSByZXF1aXJlKCcuL2dlbmVyYXRvci8nKVxubW9kdWxlLmV4cG9ydHMuRmlsdGVyID0gcmVxdWlyZSgnLi9maWx0ZXIvJylcbiJdfQ==
