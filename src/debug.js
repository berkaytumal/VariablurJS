window.DEBUG = process.env.NODE_ENV == 'development';
console.log("mode", process.env.NODE_ENV)

const debug = {
    log: window.DEBUG ? console.log : () => {},
    warn: window.DEBUG ? console.warn : () => {},
    error: window.DEBUG ? console.error : () => {},
    info: window.DEBUG ? console.info : () => {}
}

export default debug;
export { debug };
// Example usage
// window.DEBUG = true; // Enable debug mode
// debug.log('This is a log message');
// debug.warn('This is a warning message');
