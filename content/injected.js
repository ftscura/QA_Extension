(function() {
    const SOURCE = 'qa_extension_injected';

    function safeSerialize(value) {
        if (typeof value === 'string') return value;

        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    function emit(channel, payload) {
        window.postMessage({
            source: SOURCE,
            payload: {
                channel,
                ...payload,
                url: window.location.href,
                timestamp: Date.now()
            }
        }, '*');
    }

    function emitConsole(level, title, message) {
        emit('console', {
            level,
            title,
            message
        });
    }

    function emitNetwork(payload) {
        emit('network', payload);
    }

    function wrapConsoleMethod(methodName, levelLabel) {
        const original = console[methodName];
        console[methodName] = function(...args) {
            var errorArg = args.find(function(arg) {
                return arg instanceof Error;
            });
            original.apply(console, args);
            emitConsole(
                levelLabel,
                `Console ${levelLabel}`,
                args.map((arg) => safeSerialize(arg)).join(' ')
            );
        };
    }

    wrapConsoleMethod('error', 'error');

    window.addEventListener('error', function(event) {
        emitConsole(
            'error',
            'Uncaught Exception',
            event.message || 'Unknown error'
        );
    });

    window.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason;
        emitConsole(
            'error',
            'Unhandled Promise Rejection',
            reason ? safeSerialize(reason) : 'Unknown rejection'
        );
    });

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
        window.fetch = async function(...args) {
            const startedAt = Date.now();
            const requestUrl = args[0] instanceof Request ? args[0].url : String(args[0] || '');
            const requestMethod = args[0] instanceof Request
                ? args[0].method || 'GET'
                : (args[1] && args[1].method) || 'GET';

            try {
                const response = await originalFetch.apply(this, args);
                if (!response.ok) {
                    let responseBody = '';
                    try {
                        responseBody = await response.clone().text();
                    } catch (error) {
                        responseBody = '';
                    }

                    emitNetwork({
                        method: requestMethod,
                        status: response.status,
                        statusText: response.statusText || '',
                        url: requestUrl,
                        type: response.type || 'fetch',
                        responseBody: responseBody.slice(0, 2000),
                        responseMimeType: response.headers.get('content-type') || '',
                        duration: Date.now() - startedAt
                    });
                }

                return response;
            } catch (error) {
                emitNetwork({
                    method: requestMethod,
                    status: 0,
                    statusText: 'Request failed',
                    url: requestUrl,
                    type: 'fetch',
                    responseBody: safeSerialize(error),
                    responseMimeType: 'text/plain',
                    duration: Date.now() - startedAt,
                    failed: true
                });
                throw error;
            }
        };
    }

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this.__qa_method = method || 'GET';
        this.__qa_url = url || '';
        return originalXhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        const startedAt = Date.now();
        this.addEventListener('loadend', function() {
            const status = Number(this.status || 0);
            if (status >= 400 || status === 0) {
                emitNetwork({
                    method: this.__qa_method || 'GET',
                    status,
                    statusText: this.statusText || (status === 0 ? 'Request failed' : ''),
                    url: this.__qa_url || '',
                    type: 'xhr',
                    responseBody: String(this.responseText || '').slice(0, 2000),
                    responseMimeType: this.getResponseHeader('content-type') || '',
                    duration: Date.now() - startedAt,
                    failed: status === 0
                });
            }
        });

        return originalXhrSend.apply(this, arguments);
    };
})();
