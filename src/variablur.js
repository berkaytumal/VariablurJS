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

// Track blob URLs per element for cleanup
const elementBlobUrls = new WeakMap();

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

        // Clean up blob URLs
        const blobUrls = elementBlobUrls.get(el);
        if (blobUrls) {
            blobUrls.forEach(url => URL.revokeObjectURL(url));
            elementBlobUrls.delete(el);
        }

        // Clean up backdrop container and SVG filters
        const backdropContainer = el.querySelector('.backdrop-container');
        if (backdropContainer) {
            backdropContainer.remove();
        }

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
            // Glass refraction effect using SVG filter
            if (variablurGlassRefraction) {
                const { svgString, filterId } = createGlassSVGFilter(el);
                console.log('Creating glass SVG filter:', filterId);
                // Add SVG to backdrop container if not already present
                let svgElement = variablurContainer.querySelector(`#${filterId}`);
                if (!svgElement) {
                    // Clean up any existing SVG filters and their blob URLs
                    const existingSvg = variablurContainer.querySelector('svg[data-variablur-svg]');
                    if (existingSvg) {
                        // Clean up old blob URLs
                        const blobUrls = elementBlobUrls.get(el);
                        if (blobUrls) {
                            blobUrls.forEach(url => URL.revokeObjectURL(url));
                        }
                        existingSvg.remove();
                    }

                    // Create new SVG container
                    const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                    svgContainer.setAttribute('data-variablur-svg', 'true');
                    svgContainer.style.position = 'absolute';
                    svgContainer.style.width = '0';
                    svgContainer.style.height = '0';
                    svgContainer.style.pointerEvents = 'none';
                    svgContainer.innerHTML = svgString;
                    variablurContainer.appendChild(svgContainer);
                }

                const distortionFilter = `url(#${filterId})`;

                // Add glass distortion to existing backdrop filter
                const currentFilter = layer.style.backdropFilter || '';
                if (currentFilter && !currentFilter.includes('url(#')) {
                    layer.style.backdropFilter = `${currentFilter} ${distortionFilter}`;
                    layer.style.setProperty('-webkit-backdrop-filter', `${currentFilter} ${distortionFilter}`);
                } else if (!currentFilter) {
                    layer.style.backdropFilter = "blur(0px)";
                    layer.style.setProperty('-webkit-backdrop-filter', "blur(0px)");
                    layer.style.filter = distortionFilter;
                }
            } else {
                // Remove SVG filter if glass refraction is disabled and clean up blob URLs
                const existingSvg = variablurContainer.querySelector('svg[data-variablur-svg]');
                if (existingSvg) {
                    // Clean up blob URLs
                    const blobUrls = elementBlobUrls.get(el);
                    if (blobUrls) {
                        blobUrls.forEach(url => URL.revokeObjectURL(url));
                        elementBlobUrls.delete(el);
                    }
                    existingSvg.remove();
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

function calculateRefractionMap(refraction, offset, width, height, radius) {
    // Generate a displacement map based on refraction value
    width = width || 100;
    height = height || 100;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Start with neutral gray (128) as base for SVG displacement maps
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, width, height);

    function displacementBox(x, y, w, h, displacementX, displacementY) {
        // Create ImageData to manually blend displacement values
        const imageData = ctx.getImageData(x, y, w, h);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
            // Add displacement to existing values, clamping to 0-255
            data[i] = Math.max(0, Math.min(255, data[i] + displacementX));     // R
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + displacementY)); // G
            // B and A stay the same
        }

        ctx.putImageData(imageData, x, y);
    }

    function displacementLinearGradient(left, top, width, height, displacementX, displacementY, direction = "bottom") {
        if(width <= 0 || height <= 0) return;
        // Create a temporary canvas for the gradient
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // Set gradient direction based on string parameter
        let x1, y1, x2, y2;
        switch (direction.toLowerCase()) {
            case "left":
                x1 = 0; y1 = 0; x2 = width; y2 = 0;
                break;
            case "right":
                x1 = width; y1 = 0; x2 = 0; y2 = 0;
                break;
            case "top":
                x1 = 0; y1 = 0; x2 = 0; y2 = height;
                break;
            case "bottom":
            default:
                x1 = 0; y1 = height; x2 = 0; y2 = 0;
                break;
        }

        const gradient = tempCtx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, `rgb(${128 + displacementX}, ${128 + displacementY}, 128)`);
        gradient.addColorStop(1, `rgb(${128 + 0}, ${128 + 0}, 128)`);
        tempCtx.fillStyle = gradient;
        tempCtx.fillRect(0, 0, width, height);

        // Get both images as ImageData
        const mainImageData = ctx.getImageData(left, top, width, height);
        const gradientImageData = tempCtx.getImageData(0, 0, width, height);

        // Manually blend: (main - 128) + (gradient - 128) + 128 = main + gradient - 128
        for (let i = 0; i < mainImageData.data.length; i += 4) {
            const mainR = mainImageData.data[i];
            const mainG = mainImageData.data[i + 1];
            const gradR = gradientImageData.data[i];
            const gradG = gradientImageData.data[i + 1];

            // Additive blending centered around 128
            mainImageData.data[i] = Math.max(0, Math.min(255, mainR + gradR - 128));
            mainImageData.data[i + 1] = Math.max(0, Math.min(255, mainG + gradG - 128));
        }

        ctx.putImageData(mainImageData, left, top);
    }

    displacementLinearGradient(0, 0, width, offset, 0, -127 * (refraction - 1), "top"); // Vertical gradient with horizontal displacement
    displacementLinearGradient(0, height - offset, width, offset, 0, 127 * (refraction - 1), "bottom"); // Vertical gradient with horizontal displacement
    displacementLinearGradient(0, 0, offset, height, -127 * (refraction - 1), 0, "left"); // Horizontal gradient with vertical displacement
    
    // Calculate displacement amount based on refraction index
    // Refraction of 1.0 = no displacement, higher values = more displacement
    const maxDisplacement = 127;
    const displacementAmount = Math.round((refraction - 1.0) * maxDisplacement);
    
    displacementLinearGradient(width - offset, 0, offset, height, 127 * (refraction - 1), 0, "right");
    
    // Get bitmap data as array of color bits (Uint8ClampedArray)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return imageData;
}

function createGlassSVGFilter(el) {
    const width = el ? el.offsetWidth : 100;
    const height = el ? el.offsetHeight : 100;
    // Use a stable ID based on element and size to avoid regenerating filters unnecessarily
    const filterId = `variablur-glass-${el.dataset.variablurUid ?? (el.dataset.variablurUid = crypto.randomUUID())}-${width}x${height}`;
    // calculateRefractionMap now returns ImageData, so we need to convert it to a blob URL
    // Get refraction and offset from element's CSS variables
    const style = window.getComputedStyle(el);
    const refractionValue = parseFloat(style.getPropertyValue('--variablur-glass-refraction')) || 0;
    const offsetValue = parseFloat(style.getPropertyValue('--variablur-glass-offset')) || 0;
    const imageData = calculateRefractionMap(refractionValue, offsetValue, width, height, Math.min(width, height) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    // Clean up any previous blob URLs for this element
    let blobUrls = elementBlobUrls.get(el);
    if (!blobUrls) {
        blobUrls = [];
        elementBlobUrls.set(el, blobUrls);
    }

    // Revoke previous blob URLs for this element to avoid memory leaks
    while (blobUrls.length) {
        URL.revokeObjectURL(blobUrls.pop());
    }

    // Create new blob URL for the displacement map
    const dataUrl = canvas.toDataURL('image/png');
    const byteString = atob(dataUrl.split(',')[1]);
    const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    const blob = new Blob([ab], { type: mimeString });
    const mapUrl = URL.createObjectURL(blob);
    blobUrls.push(mapUrl);

    // SVG filter string using feImage for displacement map
    const svgString = `
      <filter id="${filterId}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feImage result="FEIMG" href="${mapUrl}"/>
        <feDisplacementMap in="SourceGraphic" in2="FEIMG" scale="127" xChannelSelector="R" yChannelSelector="G" />
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