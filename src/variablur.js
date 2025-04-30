// variablur: Variable blur and filter utility for web overlays
// (c) 2025 berkaytumal. MIT License.
import debug from "./debug";
import parseCalcRelative from './calc.js';
function calcBlurPerLayer(totalPx, layers) {
    if (layers <= 0) throw new Error("layers must be > 0");
    return totalPx / Math.sqrt(layers);
}
function exponentialBlurLayers(totalPx, layers, base = 2) {
    if (layers <= 0) throw new Error("layers must be > 0");

    // Step 1: Build weights (starting at 1, then exponential)
    const weights = Array.from({ length: layers }, (_, i) => Math.pow(base, i));
    const weightSquaresSum = weights.reduce((sum, w) => sum + w * w, 0);

    // Step 2: Calculate scale so total blur equals totalPx
    const scale = totalPx / Math.sqrt(weightSquaresSum);

    // Step 3: Apply scale to each weight
    return weights.map(w => w * scale);
}
function calculateMask(i, n, direction, offset, el, invert = false) {
    const step = 100 / n;
    const cl = v => Math.max(0, Math.min(100, v));
    const dir = (direction || "bottom").toLowerCase();
    const size = (dir === "left" || dir === "right") ? el.clientWidth : el.clientHeight;
    let scale = offset / size;
    if (invert) scale = 1 - scale; // Invert the scale if requested
    const shift = 1 - scale;
    const a = cl((i - 1) * step) * scale + 100 * shift;
    const c = cl((i + 1) * step) * scale + 100 * shift;
    const d = cl((i + 2) * step) * scale + 100 * shift;
    const gradientDir = {
        top: "to top",
        left: "to left",
        right: "to right",
        bottom: "to bottom"
    }[dir] || "to bottom";
    return `linear-gradient(${gradientDir},rgba(0,0,0,1) ${a}%,rgba(0,0,0,1) ${c}%,rgba(0,0,0,0) ${d}%)`;
}
const filterConverter = {
    fromString: (str) => {
        // Matches filter functions and their arguments, e.g. blur(20px)
        const regex = /([a-zA-Z]+)\(([^)]+)\)/g;
        const result = [];
        let match;
        while ((match = regex.exec(str)) !== null) {
            const name = match[1];
            const args = match[2].trim();
            // Try to split value and unit, e.g. 20px => 20, "px"
            const numUnit = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(args);
            if (numUnit) {
                const value = parseFloat(numUnit[1]);
                const unit = numUnit[2] || undefined;
                if (unit) {
                    result.push([name, value, unit]);
                } else {
                    result.push([name, value]);
                }
            } else {
                // fallback: just push as string
                result.push([name, args]);
            }
        }
        return result;
    },
    toString: (arr) => {
        return arr.map(([name, value, unit]) => {
            if (unit) {
                return `${name}(${value}${unit})`;
            } else {
                return `${name}(${value})`;
            }
        }).join(" ");
    }
}
const CSS_VARIABLES = [
    '--variablur-filter',
    '--variablur-direction',
    '--variablur-offset',
    "--variablur-layers",
    "--variablur-color"
]; // Add more variables as needed
const attachedElements = new WeakSet();
const attachedElementsList = new Set(); // Track all attached elements for iteration
const resizeObservers = new WeakMap();

function hasAnyVariablurCSS(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(node);
    return CSS_VARIABLES.some(variable => {
        const val = style.getPropertyValue(variable).trim();
        if (!val) return false;
        // Walk up ancestors to see if any ancestor has the same value
        let parent = node.parentElement;
        while (parent) {
            const parentVal = window.getComputedStyle(parent).getPropertyValue(variable).trim();
            if (parentVal === val) return false; // Inherited, not set here
            if (parentVal) break; // Found a different value up the tree
            parent = parent.parentElement;
        }
        return true; // Not inherited, set here
    });
}

function attach(el) {
    if (!attachedElements.has(el)) {
        debug.log('Attaching element:', el);
        attachedElements.add(el);
        attachedElementsList.add(el); // Add to iterable set
        update(el);

        // Add ResizeObserver
        const ro = new ResizeObserver(() => update(el));
        ro.observe(el);
        resizeObservers.set(el, ro);
    }
}

function detach(el) {
    if (attachedElements.has(el)) {
        debug.log('Detaching element:', el);
        attachedElements.delete(el);
        attachedElementsList.delete(el); // Remove from iterable set
        // Disconnect ResizeObserver if present
        const ro = resizeObservers.get(el);
        if (ro) {
            ro.disconnect();
            resizeObservers.delete(el);
        }
        // Optionally clean up here
    }
}

function update(el) {
    var variablurContainer = el.querySelector('.backdrop-container');
    if (window.getComputedStyle(el).position === 'static') {
        debug.warn('Element has static position:', el);
        el.style.position = 'relative';
    }
    if (!variablurContainer) {
        // Prevent infinite loop: only create if not already present
        if (!el.querySelector('.backdrop-container')) {
            debug.log('No backdrop container found for element:', el, 'creating one.');
            var variablurContainer = document.createElement('div');
            variablurContainer.classList.add('backdrop-container');
            variablurContainer.style.position = 'absolute';
            variablurContainer.style.top = '0';
            variablurContainer.style.left = '0';
            variablurContainer.style.width = '100%';
            variablurContainer.style.height = '100%';
            variablurContainer.style.pointerEvents = 'none';
            variablurContainer.style.zIndex = '-1';
            variablurContainer.style.overflow = 'hidden';
            el.appendChild(variablurContainer);
            debug.log('Backdrop container created:', variablurContainer);
        }
    }
    const variablurFilter = getComputedStyle(el).getPropertyValue('--variablur-filter').trim();
    const variablurDirection = getComputedStyle(el).getPropertyValue('--variablur-direction').trim();
    const variablurOffset = getComputedStyle(el).getPropertyValue('--variablur-offset').trim();
    const variablurLayers = getComputedStyle(el).getPropertyValue('--variablur-layers').trim();
    const variablurColor = getComputedStyle(el).getPropertyValue('--variablur-color').trim();
    const filter = filterConverter.fromString(variablurFilter);
    const direction = ["top", "bottom", "left", "right"].some(n => n == variablurDirection) ? variablurDirection : "bottom";
    const offset = (() => {
        return parseCalcRelative(variablurOffset, el, (direction == "left" || direction == "right") ? 0 : 1);
    })();
    const layers = parseInt(variablurLayers) || 5;
    const color = variablurColor || "transparent";
    if (variablurContainer.childNodes.length > layers + 1) {
        if (window.DEBUG) debug.warn('Too many layers in backdrop container:', variablurContainer.childNodes.length, 'max:', layers);
        while (variablurContainer.childNodes.length > layers + 1) {
            variablurContainer.removeChild(variablurContainer.lastChild);
        }
    } else if (variablurContainer.childNodes.length < layers + 1) {
        if (window.DEBUG) debug.warn('Not enough layers in backdrop container:', variablurContainer.childNodes.length, 'max:', layers);
        while (variablurContainer.childNodes.length < layers + 1) {
            const newLayer = document.createElement('div');
            newLayer.classList.add('backdrop-layer');
            newLayer.style.position = 'absolute';
            newLayer.style.top = '0';
            newLayer.style.left = '0';
            newLayer.style.width = '100%';
            newLayer.style.height = '100%';
            newLayer.style.pointerEvents = 'none';
            newLayer.style.maskImage = 'linear-gradient(to bottom, black, black)';
            newLayer.style.setProperty('-webkit-mask-image', 'linear-gradient(to bottom, black, black)');
            variablurContainer.appendChild(newLayer);
        }
    }
    // Implement your update logic here
    // For demonstration:
    Array.from(variablurContainer.children).forEach((layer, i) => {
        if (i == layers) {
            layer.style.backdropFilter = filterConverter.toString(filter.filter(([name, value, unit]) =>
                name != "blur"
            ));
            const size = (direction === "left" || direction === "right") ? el.clientWidth : el.clientHeight;
            let scale = offset / size; // changed from 1 - (offset / size) to offset / size
            layer.style.maskImage = `linear-gradient(to ${direction}, black ${scale * 100}%, transparent 100%)`;
            layer.style.setProperty('-webkit-mask-image', `linear-gradient(to ${direction}, black ${scale * 100}%, transparent 100%)`);
            layer.style.backgroundColor = color;
        } else {
            var filterLayer = filter.map(([name, value, unit]) => {
                if (name === "blur") {
                    // Distribute blur across layers
                    // Use exponentialBlurLayers for more realistic stacking
                    const totalPx = value;
                    const blurs = exponentialBlurLayers(totalPx, layers);
                    return [name, blurs[layers - i - 1] || 0, unit];
                } else {
                    return [name, value, unit];
                }
            })

            layer.style.backdropFilter = filterConverter.toString(filterLayer.filter(([name, value, unit]) =>
                name == "blur"
            ));
            layer.style.setProperty('-webkit-backdrop-filter', layer.style.backdropFilter);

            layer.style.maskImage = calculateMask(i, layers + 1, direction, offset, el, true);
            layer.style.setProperty('-webkit-mask-image', calculateMask(i, layers + 1, direction, offset, el, true));

        }

        // Offset calculation

    });
    if (window.DEBUG) {
        debug.log('Updating element:', el);
        debug.log('direction:', direction);
    }
}

// Export main functions for npm/ESM/CommonJS
const variablur = {
    calcBlurPerLayer,
    exponentialBlurLayers,
    calculateMask,
    filterConverter,
    CSS_VARIABLES,
    attach,
    detach,
    update,
    hasAnyVariablurCSS,
    startPolling,
    stopPolling
};

// Store last known CSS variable values for each element
const lastCSSVars = new WeakMap();
const POLL_INTERVAL = 200; // ms, adjust as needed

let pollingActive = false;
let pollingHandle = null;

function startPolling() {
    if (!pollingActive) {
        pollingActive = true;
        pollCSSVariables();
    }
}

function stopPolling() {
    pollingActive = false;
    if (pollingHandle) {
        cancelAnimationFrame(pollingHandle);
        pollingHandle = null;
    }
}

function pollCSSVariables() {
    attachedElementsList.forEach(el => {
        const style = window.getComputedStyle(el);
        const prev = lastCSSVars.get(el) || {};
        let changed = false;
        const current = {};
        for (const variable of CSS_VARIABLES) {
            const val = style.getPropertyValue(variable).trim();
            current[variable] = val;
            if (prev[variable] !== val) {
                changed = true;
            }
        }
        if (changed) {
            lastCSSVars.set(el, current);
            update(el);
        }
    });
    if (pollingActive) {
        pollingHandle = requestAnimationFrame(pollCSSVariables);
    }
}

// Only run DOM code in browser environments
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Attach existing elements before polling starts
    function attachExistingElements(root = document.body) {
        if (hasAnyVariablurCSS(root)) attach(root);
        root.querySelectorAll('*').forEach(el => {
            if (hasAnyVariablurCSS(el)) attach(el);
        });
    }
    attachExistingElements();
    debug.log("polling started");

    // Start polling for CSS variable changes
    startPolling();
}

// Export for CommonJS and ESM
if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = variablur;
} else if (typeof define === 'function' && define.amd) {
    define(function () { return variablur; });
} else {
    window.variablur = variablur;
}
