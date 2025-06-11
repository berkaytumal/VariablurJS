// variablur: Variable blur and filter utility for web overlays
// (c) 2025 berkaytumal. MIT License.

import debug from "./debug.js";
import parseCalcRelative from './calc.js';

const CSS_VARIABLES = [
    '--variablur-filter',
    '--variablur-direction',
    '--variablur-offset',
    '--variablur-layers',
    '--variablur-color',
    '--variablur-glass-refraction',
    '--variablur-glass-offset'
];

// --- Utility Functions ---

function calcBlurPerLayer(totalPx, layers) {
    if (layers <= 0) throw new Error("layers must be > 0");
    return totalPx / Math.sqrt(layers);
}

function exponentialBlurLayers(totalPx, layers, base = 2) {
    if (layers <= 0) throw new Error("layers must be > 0");
    const weights = Array.from({ length: layers }, (_, i) => Math.pow(base, i));
    const weightSquaresSum = weights.reduce((sum, w) => sum + w * w, 0);
    const scale = totalPx / Math.sqrt(weightSquaresSum);
    return weights.map(w => w * scale);
}

function calculateMask(i, n, direction, offset, el, invert = false) {
    const step = 100 / n;
    const clamp = v => Math.max(0, Math.min(100, v));
    const dir = (direction || "bottom").toLowerCase();
    const size = (dir === "left" || dir === "right") ? el.clientWidth : el.clientHeight;
    let scale = offset / size;
    if (invert) scale = 1 - scale;
    const shift = 1 - scale;
    const a = clamp((i - 1) * step) * scale + 100 * shift;
    const c = clamp((i + 1) * step) * scale + 100 * shift;
    const d = clamp((i + 2) * step) * scale + 100 * shift;
    const gradientDir = {
        top: "to top",
        left: "to left",
        right: "to right",
        bottom: "to bottom"
    }[dir] || "to bottom";
    return `linear-gradient(${gradientDir},rgba(0,0,0,1) ${a}%,rgba(0,0,0,1) ${c}%,rgba(0,0,0,0) ${d}%)`;
}

const filterConverter = {
    fromString(str) {
        // Matches filter functions and their arguments, e.g. blur(20px)
        const regex = /([a-zA-Z]+)\(([^)]+)\)/g;
        const result = [];
        let match;
        while ((match = regex.exec(str)) !== null) {
            const name = match[1];
            const args = match[2].trim();
            const numUnit = /^(-?\d*\.?\d+)([a-z%]*)$/.exec(args);
            if (numUnit) {
                const value = parseFloat(numUnit[1]);
                const unit = numUnit[2] || undefined;
                result.push(unit ? [name, value, unit] : [name, value]);
            } else {
                result.push([name, args]);
            }
        }
        return result;
    },
    toString(arr) {
        return arr.map(([name, value, unit]) =>
            unit ? `${name}(${value}${unit})` : `${name}(${value})`
        ).join(" ");
    }
};

// --- State ---

const attachedElements = new WeakSet();
const attachedElementsList = new Set();
const resizeObservers = new WeakMap();
const lastCSSVars = new WeakMap();

// Track last filterId per element for cleanup
const lastGlassFilterId = new WeakMap();

let pollingActive = false;
let pollingHandle = null;

// Per-element polling
const elementPollingHandles = new WeakMap();
let globalPollingActive = false;

// --- Core Functions ---

function hasAnyVariablurCSS(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(node);
    return CSS_VARIABLES.some(variable => {
        const val = style.getPropertyValue(variable).trim();
        if (!val) return false;
        let parent = node.parentElement;
        while (parent) {
            const parentVal = window.getComputedStyle(parent).getPropertyValue(variable).trim();
            if (parentVal === val) return false; // Inherited, not set here
            if (parentVal) break;
            parent = parent.parentElement;
        }
        return true;
    });
}

function attach(el) {
    if (!attachedElements.has(el)) {
        debug.log('Attaching element:', el);
        attachedElements.add(el);
        attachedElementsList.add(el);
        update(el);
        const ro = new ResizeObserver(() => update(el));
        ro.observe(el);
        resizeObservers.set(el, ro);
        startElementPolling(el);
    }
    // Always check children, even if el was already attached
    el.querySelectorAll('*').forEach(child => {
        if (hasAnyVariablurCSS(child) && !attachedElements.has(child)) {
            attach(child);
        }
    });
}

function detach(el) {
    if (attachedElements.has(el)) {
        debug.log('Detaching element:', el);
        attachedElements.delete(el);
        attachedElementsList.delete(el);
        const ro = resizeObservers.get(el);
        if (ro) {
            ro.disconnect();
            resizeObservers.delete(el);
        }
        stopElementPolling(el);
    }
}

function update(el) {
    let variablurContainer = el.querySelector('.backdrop-container');
    if (window.getComputedStyle(el).position === 'static') {
        debug.warn('Element has static position:', el);
        el.style.position = 'relative';
    }
    if (!variablurContainer) {
        if (!el.querySelector('.backdrop-container')) {
            debug.log('No backdrop container found for element:', el, 'creating one.');
            variablurContainer = document.createElement('div');
            variablurContainer.classList.add('backdrop-container');
            Object.assign(variablurContainer.style, {
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: '-1',
                overflow: 'hidden'
            });
            el.appendChild(variablurContainer);
            debug.log('Backdrop container created:', variablurContainer);
        }
    }
    const style = getComputedStyle(el);
    const variablurFilter = style.getPropertyValue('--variablur-filter').trim();
    const variablurDirection = style.getPropertyValue('--variablur-direction').trim();
    const variablurOffset = style.getPropertyValue('--variablur-offset').trim();
    const variablurLayers = style.getPropertyValue('--variablur-layers').trim();
    const variablurColor = style.getPropertyValue('--variablur-color').trim();
    const variablurGlassRefraction = style.getPropertyValue('--variablur-glass-refraction').trim();
    const variablurGlassOffset = style.getPropertyValue('--variablur-glass-offset').trim();

    const filter = filterConverter.fromString(variablurFilter);
    const direction = ["top", "bottom", "left", "right"].includes(variablurDirection) ? variablurDirection : "bottom";
    const offset = parseCalcRelative(variablurOffset, el, (direction === "left" || direction === "right") ? 0 : 1);
    const layers = parseInt(variablurLayers) || 5;
    const color = variablurColor || "transparent";

    // Ensure correct number of layers
    while (variablurContainer.childNodes.length > layers + 1) {
        variablurContainer.removeChild(variablurContainer.lastChild);
    }
    while (variablurContainer.childNodes.length < layers + 1) {
        const newLayer = document.createElement('div');
        newLayer.classList.add('backdrop-layer');
        Object.assign(newLayer.style, {
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
        });
        newLayer.style.maskImage = 'linear-gradient(to bottom, black, black)';
        newLayer.style.setProperty('-webkit-mask-image', 'linear-gradient(to bottom, black, black)');
        variablurContainer.appendChild(newLayer);
    }

    // Update each layer
    Array.from(variablurContainer.children).forEach((layer, i) => {
        if (i === layers) {
            // Top layer, for brightness/contrast/etc.
            layer.style.backdropFilter = filterConverter.toString(filter.filter(([name]) => name !== "blur"));
            layer.style.setProperty('-webkit-backdrop-filter', layer.style.backdropFilter);
            const size = (direction === "left" || direction === "right") ? el.clientWidth : el.clientHeight;
            const scale = offset / size;
            layer.style.maskImage = `linear-gradient(to ${direction}, black ${scale * 100}%, transparent 100%)`;
            layer.style.setProperty('-webkit-mask-image', `linear-gradient(to ${direction}, black ${scale * 100}%, transparent 100%)`);
            layer.style.backgroundColor = color;
            // Glass refraction effect using backdrop-filter
            if (variablurGlassRefraction) {
                const refractionIntensity = parseFloat(variablurGlassRefraction) || 1.0;
                const glassOffset = parseFloat(variablurGlassOffset) || 0;
                
                // Create a distortion effect using backdrop-filter
                const distortionFilter = `hue-rotate(${refractionIntensity * 5}deg) saturate(${1 + refractionIntensity * 0.1}) brightness(${1 + glassOffset * 0.1})`;
                
                // Add glass distortion to existing backdrop filter
                const currentFilter = layer.style.backdropFilter || '';
                if (currentFilter && !currentFilter.includes('hue-rotate')) {
                    layer.style.backdropFilter = `${currentFilter} ${distortionFilter}`;
                    layer.style.setProperty('-webkit-backdrop-filter', `${currentFilter} ${distortionFilter}`);
                } else if (!currentFilter) {
                    layer.style.backdropFilter = distortionFilter;
                    layer.style.setProperty('-webkit-backdrop-filter', distortionFilter);
                }
            }
        } else {
            // Variable blur gradient layers
            const filterLayer = filter.map(([name, value, unit]) => {
                if (name === "blur") {
                    const totalPx = value;
                    const blurs = exponentialBlurLayers(totalPx, layers);
                    return [name, blurs[layers - i - 1] || 0, unit];
                }
                return [name, value, unit];
            });
            layer.style.backdropFilter = filterConverter.toString(filterLayer.filter(([name]) => name === "blur"));
            layer.style.setProperty('-webkit-backdrop-filter', layer.style.backdropFilter);
            layer.style.maskImage = calculateMask(i, layers + 1, direction, offset, el, true);
            layer.style.setProperty('-webkit-mask-image', calculateMask(i, layers + 1, direction, offset, el, true));
            layer.style.backgroundColor = "";
        }
    });

    if (window.DEBUG) {
        debug.log('Updating element:', el);
        debug.log('direction:', direction);
    }
}

// --- Polling Mechanism ---

function pollCSSVariables() {
    attachedElementsList.forEach(el => {
        const style = window.getComputedStyle(el);
        const prev = lastCSSVars.get(el) || {};
        let changed = false;
        const current = {};
        for (const variable of CSS_VARIABLES) {
            const val = style.getPropertyValue(variable).trim();
            current[variable] = val;
            if (prev[variable] !== val) changed = true;
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

function pollElementCSSVariables(el) {
    if (!attachedElements.has(el)) return;
    const style = window.getComputedStyle(el);
    const prev = lastCSSVars.get(el) || {};
    let changed = false;
    const current = {};
    for (const variable of CSS_VARIABLES) {
        const val = style.getPropertyValue(variable).trim();
        current[variable] = val;
        if (prev[variable] !== val) changed = true;
    }
    if (changed) {
        lastCSSVars.set(el, current);
        update(el);
    }
    if (elementPollingHandles.has(el)) {
        const handle = requestAnimationFrame(() => pollElementCSSVariables(el));
        elementPollingHandles.set(el, handle);
    }
}

function startPolling() {
    // Stop all per-element polling
    attachedElementsList.forEach(el => {
        const handle = elementPollingHandles.get(el);
        if (handle) {
            cancelAnimationFrame(handle);
            elementPollingHandles.delete(el);
        }
    });
    pollingActive = true;
    globalPollingActive = true;
    pollCSSVariables();
}

function stopPolling() {
    pollingActive = false;
    globalPollingActive = false;
    if (pollingHandle) {
        cancelAnimationFrame(pollingHandle);
        pollingHandle = null;
    }
}

function startElementPolling(el) {
    if (globalPollingActive) return; // Don't start per-element polling if global polling is active
    if (!elementPollingHandles.has(el)) {
        const handle = requestAnimationFrame(() => pollElementCSSVariables(el));
        elementPollingHandles.set(el, handle);
    }
}

function stopElementPolling(el) {
    const handle = elementPollingHandles.get(el);
    if (handle) {
        cancelAnimationFrame(handle);
        elementPollingHandles.delete(el);
    }
}

// --- Glass Refraction SVG Filter ---

function calculateRefractionMap(refraction, width, height, radius) {
    // Generate a simple Perlin-like noise bitmap as a data URL for displacement
    width = width || 100;
    height = height || 100;
    const scale = Math.max(0, Math.min(1, parseFloat(refraction) / 10));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgb(127,127,127)'; // Neutral gray for displacement
    ctx.fillRect(0, 0, width, height); // Fill with red to ensure we have a base color


    // Get bitmap data as array of color bits (Uint8ClampedArray)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return imageData;
}

function createGlassSVGFilter(el, refraction) {
    const width = el ? el.offsetWidth : 100;
    const height = el ? el.offsetHeight : 100;
    const filterId = `variablur-glass-${Math.abs(String(refraction).split('').reduce((a, c) => a + c.charCodeAt(0), 0))}-${width}x${height}`;
    // calculateRefractionMap now returns ImageData, so we need to convert it to a data URL
    const imageData = calculateRefractionMap(0, width, height, Math.min(width, height) / 2);

    // Convert ImageData to data URL
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    const mapUrl = canvas.toDataURL();

    // SVG filter string using feImage for displacement map
    const svgString = `
      <filter id="${filterId}" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox">
        <feImage result="map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" xlink:href="${mapUrl}"/>
        <feDisplacementMap in2="map" in="SourceGraphic" scale="100" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
    `;
    return { svgString, filterId };
}

// --- Initialization ---

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    function attachExistingElements(root = document.body) {
        if (hasAnyVariablurCSS(root)) attach(root);
        root.querySelectorAll('*').forEach(el => {
            if (hasAnyVariablurCSS(el)) attach(el);
        });
    }
    attachExistingElements();
    debug.log("polling started");
    startPolling();
}

// --- Export ---

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
    stopPolling,
    createGlassSVGFilter,
    calculateRefractionMap
};

if (typeof module !== 'undefined' && typeof module.exports !== 'undefined') {
    module.exports = variablur;
} else if (typeof window !== 'undefined') {
    window.variablur = variablur;
}

export default variablur;