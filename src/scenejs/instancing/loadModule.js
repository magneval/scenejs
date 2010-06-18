/**
 * Backend module that services the SceneJS.Instance node to manage the asynchronous cross-domain
 * load and caching of remotely-stored scene fragments.
 *
 * Uses the memory management backend to mediate cache management.
 *
 *  @private
 */
var SceneJS_loadModule = new (function() {
    var parsers = {};
    var time = (new Date()).getTime();
    var jsonpStrategy = null;
    var defaultLoadTimeoutSecs = 180;
    var assets = {};
    var pInterval;

    SceneJS_eventModule.addListener(
            SceneJS_eventModule.TIME_UPDATED,
            function(t) {
                time = t;
            });

    SceneJS_eventModule.addListener(
            SceneJS_eventModule.INIT,
            function() {
                assets = {};
                if (!pInterval) {
                    pInterval = setInterval("SceneJS_loadModule._updateSceneJSLoads()", 100);
                }
            });

    SceneJS_eventModule.addListener(
            SceneJS_eventModule.RESET,
            function() {
                assets = {};
                if (!pInterval) {
                    pInterval = setInterval("SceneJS_loadModule._updateSceneJSLoads()", 100);
                }
            });

    /**
     * Periodically called to update statii of assets, reaps those that have failed
     * @private
     */
    this._updateSceneJSLoads = function() {
        var asset;
        for (var url in assets) {
            if (assets.hasOwnProperty(url)) {
                asset = assets[url];
                if (asset) {
                    asset.poll();
                    if (asset.status == SceneJS.Asset.STATUS_ERROR
                            || asset.status == SceneJS.Asset.STATUS_TIMED_OUT) {
                        assets[url] = null;
                    }
                }
            }
        }
    };

    /** Registers a parser function to handle a file of the given extension type
     */
    this.registerParser = function (fileExtension, parser) {
        parsers[fileExtension.toLowerCase()] = parser;
    };

    function getParserForURL(url) {
        var ext = url.split('.').pop();
        if (!ext) {
            return defaultParser;
        }
        return parsers[ext.toLowerCase()] || defaultParser;
    }

    function defaultParser(cfg) {
        if (cfg.data._render) {  // Cross-domain JSONP
            return cfg.data;
        }
//        if (data.error) {
//            cfg.onError(cfg.data.error);
//        }
        try {
            var evalData = eval(cfg.data);  // Same-domain
            if (evalData.error) {           // TODO: This is specific to the old SceneJS proxy - remove?
                cfg.onError(evalData.error);
            }
            return evalData;
        } catch (e) {
            cfg.onError(new SceneJS.ParseException("Error parsing response: " + e));
        }
    }

    this.setLoadTimeoutSecs = function(loadTimeoutSecs) {
        defaultLoadTimeoutSecs = loadTimeoutSecs || 180;
    };

    /** Attempts to get currently-loaded asset, which may have been evicted
     */
    this.getAsset = function(uri) {
        var asset = assets[uri];
        if (asset) {
            asset.lastUsed = time;
            return asset.assetNode;
        }
        return null;
    };

    /**
     * Triggers asynchronous JSONP load of asset, creates new process and handle; callback
     * will fire with new child for the  client asset node. The asset node will have to then call assetLoaded
     * to notify the backend that the asset has loaded and allow backend to kill the process.
     *
     * JSON does not handle errors, so the best we can do is manage timeouts withing SceneJS's process management.
     *
     * @private
     * @uri Location of asset
     * @loadTimeoutSecs Seconds after which response and parsing times out
     * @onLoaded Callback through which processed asset data is returned
     * @onTimeout Callback invoked when no response from proxy
     * @onError Callback invoked when error reported by proxy
     */
    this.loadAsset = function(uri, loadTimeoutSecs, onLoaded, onTimeout, onError) {
        uri = getBaseURL(uri);
        var asset = assets[uri];
        if (asset) {
            if (asset.status == SceneJS.Asset.STATUS_LOADING) {
                asset.addListener({ onLoaded : onLoaded, onTimeout: onTimeout, onError : onError });
            }
            return uri;
        }
        assets[uri] = new SceneJS.Asset({
            time: time,
            timeoutSecs: loadTimeoutSecs || defaultLoadTimeoutSecs,
            uri: uri,
            jsonpStrategy: jsonpStrategy,
            parser: getParserForURL(uri),
            onLoaded: onLoaded,
            onTimeout: onTimeout,
            onError: onError
        });
        return uri;
    };

    function getBaseURL(url) {
        var i = url.indexOf("#");
        return (i == -1) ? url : url.substr(0, i);
    }

    /**
     * @private
     */
    this.setJSONPStrategy = function(strategy) {
        jsonpStrategy = strategy;
    };

})();

/**
 * Configures SceneJS with a strategy to allow it to use a particular Web service to proxy cross-domain requests
 * by nodes such as {@link SceneJS.Instance} when their URIs are not in the local domain. As shown in the example below,
 * the strategy must implement two methods, one to create the request URL and another to extract a string of data
 * from the response.
 * <p><b>Example strategy- </b>specifying a JSONP handler for the Yahoo! Query Language (YQL) API:</p>
 * <pre><code>
 * SceneJS.setJSONPStrategy({
 *          request : function(url, format, callback) {
 *                  return "http://query.yahooapis.com/v1/public/yql?q=select%20*%20from%20" + format + "%20where%20url='"
 *                                   + url + "'&format=" + format + "&callback=" + callback;
 *           },
 *
 *          response : function(data) {
 *                  return data.results[0];
 *          }
 *  });
 * </code></pre>
 * @param strategy {{request:function(url:String, format:String, callback:String), String response: function(data:String) }}
 */
SceneJS.setJSONPStrategy = function(strategy) {
    SceneJS_loadModule.setJSONPStrategy(strategy);
};


SceneJS.Asset = function(cfg) {
    this.timeoutSecs = cfg.timeoutSecs;
    this.lastUsed = cfg.time;
    this.uri = cfg.uri;
    this._listeners = [];
    this._jsonpStrategy = cfg.jsonpStrategy;
    this._parser = cfg.parser;
    this.assetNode = null;
    this.exception = null;
    this.addListener({ onLoaded: cfg.onLoaded, onError: cfg.onError, onTimeout: cfg.onTimeout });
    this.status = SceneJS.Asset.STATUS_LOADING;
    this._load();
};

SceneJS.Asset.STATUS_LOADING = 0;
SceneJS.Asset.STATUS_LOADED = 1;
SceneJS.Asset.STATUS_ERROR = 2;
SceneJS.Asset.STATUS_TIMED_OUT = 3;

SceneJS.Asset.prototype._load = function() {
    var description = this._jsonpStrategy
            ? "Instancing scene content cross-domain from " + this.uri
            : "Instancing scene content at local domain " + this.uri;
    SceneJS_loggingModule.debug(description);
    var self = this;
    this._process = SceneJS_processModule.createProcess({
        onTimeout: function() {  // process killed automatically on timeout
            self._handleTimeout();
        },
        description: description,
        timeoutSecs: this.timeoutSecs
    });
    if (this._jsonpStrategy) {
        this._loadCrossDomain();
    } else {
        this._loadLocal();
    }
};

SceneJS.Asset.prototype._loadCrossDomain = function() {
    var format = this._parser.serverParams ? (this._parser.serverParams.format || "json") : "json";
    var callbackName = "callback" + this._process.id;
    var fullUri = this._jsonpStrategy.request(this.uri, format, callbackName);
    var head = document.getElementsByTagName("head")[0];
    var script = document.createElement("script");
    script.type = "text/javascript";
    var self = this;
    window[callbackName] = function(data) {
        window[callbackName] = undefined;   // Remove callback
        try {
            delete window[callbackName];
        } catch(e) {
        }
        head.removeChild(script);          // Remove script
        self.assetNode = self._parser.parse({
            uri: self.uri,
            data: data,
            onError: function(msg) { ////////// TODO: Needed?
                self._handleException(new SceneJS.EmptyResponseException(msg));
            }
        });
        if (!self.assetNode) {
            self._handleException(new SceneJS.InternalException("parser returned null result"));
        } else {
            self._handleSuccess();
        }
    };
    head.appendChild(script);
    script.src = fullUri;  // Sends request
};

SceneJS.Asset.prototype._loadLocal = function() {
    var request;
    try {
        request = new XMLHttpRequest();
        var self = this;
        request.onreadystatechange = function() {
            if (request.readyState == 4) {
                if (!request.responseText) {
                    self.handleError(new SceneJS.EmptyResponseException("response content is empty"));
                } else {
                    self._assetNode = self._parser.parse({
                        data: request.responseText,
                        onError: function(msg) { ////////// TODO: Needed?
                            self._handleException(new SceneJS.EmptyResponseException(msg));
                        }
                    });
                    if (!self._assetNode) {
                        self._handleException(new SceneJS.InternalException("parser returned null result"));
                    } else {
                        self._handleSuccess();
                    }
                }
            }
        };
        request.open("GET", this._url, true);
        request.send(null);
    }
    catch (e) {
        this._handleException(new SceneJS.HttpException(request.status + " - " + e.toString()));
    }
};

SceneJS.Asset.prototype.addListener = function(listener) {
    this._listeners.push(listener);
};

SceneJS.Asset.prototype._handleException = function(e) {
    this.status = SceneJS.Asset.STATUS_ERROR;
    this.exception = e;
    if (this._process) {
        SceneJS_processModule.killProcess(this._process);
    }
};

SceneJS.Asset.prototype._handleSuccess = function() {
    this.status = SceneJS.Asset.STATUS_LOADED;
    SceneJS_processModule.killProcess(this._process);
};

SceneJS.Asset.prototype._handleTimeout = function() {
    this.status = SceneJS.Asset.STATUS_TIMED_OUT;
    if (this._jsonpStrategy) {
        SceneJS_loggingModule.error(
                "Load failed - timed out waiting for a reply from JSONP proxy for content at uri: " + this.uri);
    } else {
        SceneJS_loggingModule.error(
                "Load failed - timed out waiting for content at uri: " + this.uri);
    }
};

SceneJS.Asset.prototype.poll = function() {
    if (this.status == SceneJS.Asset.STATUS_LOADING) {
        return;
    }
    var listener;
    while (this._listeners.length > 0) {  // Removes listeners
        listener = this._listeners.pop();
        switch (this.status) {
            case SceneJS.Asset.STATUS_LOADED:
                if (listener.onLoaded) {
                    listener.onLoaded(this.assetNode);
                }
                break;
            case SceneJS.Asset.STATUS_ERROR:
                if (listener.onError) {
                    listener.onError(this.exception);
                }
                break;
            case SceneJS.Asset.STATUS_TIMED_OUT:
                if (listener.onTimeout) {
                    listener.onTimeout();
                }
                break;
        }
    }
};