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

    function emitConsole(level, title, message, stack, source) {
        window.postMessage({
            source: SOURCE,
            payload: {
                channel: 'console',
                level,
                title,
                message,
                stack: stack || '',
                source: source || '',
                url: window.location.href,
                timestamp: Date.now()
            }
        }, '*');
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
                args.map((arg) => safeSerialize(arg)).join(' '),
                errorArg && errorArg.stack ? errorArg.stack : '',
                ''
            );
        };
    }

    wrapConsoleMethod('error', 'error');

    window.addEventListener('error', function(event) {
        emitConsole(
            'error',
            'Uncaught Exception',
            event.message || 'Unknown error',
            event.error && event.error.stack ? event.error.stack : '',
            event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : ''
        );
    });

    window.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason;
        emitConsole(
            'error',
            'Unhandled Promise Rejection',
            reason ? safeSerialize(reason) : 'Unknown rejection',
            reason && reason.stack ? reason.stack : '',
            ''
        );
    });
})();
