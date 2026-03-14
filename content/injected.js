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

    function emitConsole(level, title, message, stack) {
        window.postMessage({
            source: SOURCE,
            payload: {
                channel: 'console',
                level,
                title,
                message,
                stack: stack || '',
                url: window.location.href,
                timestamp: Date.now()
            }
        }, '*');
    }

    function wrapConsoleMethod(methodName, levelLabel) {
        const original = console[methodName];
        console[methodName] = function(...args) {
            original.apply(console, args);
            emitConsole(
                levelLabel,
                `Console ${levelLabel}`,
                args.map((arg) => safeSerialize(arg)).join(' '),
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
            event.error && event.error.stack ? event.error.stack : ''
        );
    });

    window.addEventListener('unhandledrejection', function(event) {
        const reason = event.reason;
        emitConsole(
            'error',
            'Unhandled Promise Rejection',
            reason ? safeSerialize(reason) : 'Unknown rejection',
            reason && reason.stack ? reason.stack : ''
        );
    });
})();
