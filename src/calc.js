import debug from "./debug.js";
function parseCalcRelative(calcString, element, direction = 0) {
    const rect = element.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    function preprocess(str) {
        str = str.trim();

        // remove outer calc() if present
        if (str.startsWith('calc(') && str.endsWith(')')) {
            str = str.slice(5, -1);
        }

        // replace width/height keywords based on direction
        if (direction === 0) {
            str = str.replace(/\bwidth\b/g, width);
            str = str.replace(/\bheight\b/g, height);
        } else {
            str = str.replace(/\bwidth\b/g, height);
            str = str.replace(/\bheight\b/g, width);
        }

        // replace percentages relative to width or height based on direction
        str = str.replace(/([\d.]+)%/g, (_, p1) =>
            direction === 0
                ? `(${p1} / 100) * width`
                : `(${p1} / 100) * height`
        );

        // add *1 for px values so math engine works
        str = str.replace(/([\d.]+)px/g, (_, p1) => `${p1} * 1`);

        return str;
    }

    function safeEval(expression) {
        try {
            // eslint-disable-next-line no-new-func
            return new Function('width', 'height', `return (${expression});`)(width, height);
        } catch (e) {
            debug.error('calc() evaluation failed:', e);
            return null;
        }
    }

    const cleanExpr = preprocess(calcString);
    return safeEval(cleanExpr);
}
export { parseCalcRelative };
export default parseCalcRelative;
// Example usage
// const element = document.querySelector('.my-element');
// const calcString = 'calc(50% + 20px)';
// const result = parseCalcRelative(calcString, element);
// debug.log(result); // Outputs the calculated value based on the element's dimensions
// Note: This function assumes that the element is already in the DOM and has dimensions.
// It also assumes that the calcString is a valid CSS calc() expression :)
