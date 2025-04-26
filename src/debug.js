window.DEBUG = process.env.NODE_ENV == 'development';
console.log("mode", process.env.NODE_ENV)
const debug = {
    log: (...args) => {
        if (window.DEBUG) {
            console.log(...args);
        }
    },
    warn: (...args) => {
        if (window.DEBUG) {
            console.warn(...args);
        }
    },
    error: (...args) => {
        if (window.DEBUG) {
            console.error(...args);
        }
    },
    info: (...args) => {
        if (window.DEBUG) {
            console.info(...args);
        }
    }
}
export default debug;
export { debug };
// Example usage
// window.DEBUG = true; // Enable debug mode
// debug.log('This is a log message');
// debug.warn('This is a warning message');