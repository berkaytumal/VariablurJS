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
                createGlassSVGFilter(el).then(({ svgString, filterId }) => {
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

                        // Apply the filter after SVG is created
                        const distortionFilter = `url(#${filterId})`;
                        const currentFilter = layer.style.backdropFilter || '';
                        if (currentFilter && !currentFilter.includes('url(#')) {
                            layer.style.backdropFilter = `${currentFilter} ${distortionFilter}`;
                            layer.style.setProperty('-webkit-backdrop-filter', `${currentFilter} ${distortionFilter}`);
                        } else if (!currentFilter) {
                            layer.style.backdropFilter = "blur(0px)";
                            layer.style.setProperty('-webkit-backdrop-filter', "blur(0px)");
                            layer.style.filter = distortionFilter;
                        }
                    }
                }).catch(error => {
                    console.error('Error creating glass SVG filter:', error);
                });
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
class RefractionEditor {
    imageData = null;
    constructor(width, height, radius) {
        this.imageData = new ImageData(width, height);
        this.width = width;
        this.height = height;
        this.radius = radius;
        //make all pixels solid with channel separation
        for (let i = 0; i < this.imageData.data.length; i += 4) {
            const base = 127; // Empirically determined neutral value for sRGB color space
            this.imageData.data[i] = base;     // R - X displacement channel
            this.imageData.data[i + 1] = base; // G - unused channel
            this.imageData.data[i + 2] = base; // B - Y displacement channel
            this.imageData.data[i + 3] = 255; // A
        }
    }
    static linearToSRGB(x) {
        return x <= 0.0031308
            ? 12.92 * x
            : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    }

    static sRGBToLinear(x) {
        return x <= 0.04045
            ? x / 12.92
            : Math.pow((x + 0.055) / 1.055, 2.4);
    }

    static fromLinearImageData(linearImageData) {
        const { width, height, data } = linearImageData;
        const output = new Uint8ClampedArray(data.length);

        for (let i = 0; i < data.length; i += 4) {
            for (let j = 0; j < 3; j++) {
                const lin = data[i + j] / 255;
                output[i + j] = Math.round(this.linearToSRGB(lin) * 255);
            }
            output[i + 3] = data[i + 3]; // alpha
        }

        return new ImageData(output, width, height);
    }

    static toLinearImageData(srgbImageData) {
        const { width, height, data } = srgbImageData;
        const output = new Uint8ClampedArray(data.length);

        for (let i = 0; i < data.length; i += 4) {
            for (let j = 0; j < 3; j++) {
                const s = data[i + j] / 255;
                output[i + j] = Math.round(this.sRGBToLinear(s) * 255);
            }
            output[i + 3] = data[i + 3]; // alpha
        }

        return new ImageData(output, width, height);
    }
    addTransformation(vx, vy, direction, dx, dy, dw, dh, easing = (x) => x) {
        const data = this.imageData.data;

        // Iterate through each pixel in the rectangle
        for (let y = dy; y < dy + dh; y++) {
            for (let x = dx; x < dx + dw; x++) {
                // Skip if outside image bounds
                if (x < 0 || y < 0 || x >= this.imageData.width || y >= this.imageData.height) continue;

                // Calculate gradient segment based on direction
                let gradientSegment = 0;
                switch (direction.toLowerCase()) {
                    case 'down':
                        gradientSegment = (y - dy) / dh; // top to bottom
                        break;
                    case 'up':
                    case 'top':
                        gradientSegment = (dh - (y - dy)) / dh; // bottom to top
                        break;
                    case 'right':
                        gradientSegment = (x - dx) / dw; // left to right
                        break;
                    case 'left':
                        gradientSegment = (dw - (x - dx)) / dw; // right to left
                        break;
                    default:
                        gradientSegment = (y - dy) / dh; // default to down
                }

                // Clamp gradient segment to 0-1 range
                gradientSegment = Math.max(0, Math.min(1, gradientSegment));

                // Calculate pixel index
                const pixelIndex = (y * this.imageData.width + x) * 4;

                // Get current R and B values (X and Y displacement channels)
                let r = data[pixelIndex];     // R channel for X displacement
                let b = data[pixelIndex + 2]; // B channel for Y displacement

                // Calculate vx and vy values using functions
                var vxValue = typeof vx === 'function' ? vx(x, y, dw, dh) : vx;
                var vyValue = typeof vy === 'function' ? vy(x, y, dw, dh) : vy;
                // vxValue -= vyValue * .125

                // Apply transformation to specific channels
                r += 127 * vxValue * easing(gradientSegment); // X displacement goes to R channel
                b += 127 * vyValue * easing(gradientSegment); // Y displacement goes to B channel

                // Clamp values to 0-255 range and update only the channels we're using
                this.imageData.data[pixelIndex] = Math.max(0, Math.min(255, Math.round(r)));     // R channel
                this.imageData.data[pixelIndex + 2] = Math.max(0, Math.min(255, Math.round(b))); // B channel
                // Leave G channel (index 1) and A channel (index 3) unchanged
            }
        }
    }
    /**
     * Compute the local normal and border distance for a given pixel (x, y)
     * Returns: { nx, ny, distToBorder, isCorner }
     */
    getBorderNormalAndDistance(x, y) {
        const w = this.width;
        const h = this.height;
        const r = Math.max(0, Math.min(this.radius, Math.min(w, h) / 2));
        // Clamp radius to valid range
        // Determine which corner (if any) the pixel is in
        let isCorner = false;
        let cx = 0, cy = 0;
        // Top-left
        if (x < r && y < r) {
            isCorner = true;
            cx = r;
            cy = r;
        }
        // Top-right
        else if (x >= w - r && y < r) {
            isCorner = true;
            cx = w - r - 1;
            cy = r;
        }
        // Bottom-left
        else if (x < r && y >= h - r) {
            isCorner = true;
            cx = r;
            cy = h - r - 1;
        }
        // Bottom-right
        else if (x >= w - r && y >= h - r) {
            isCorner = true;
            cx = w - r - 1;
            cy = h - r - 1;
        }
        if (isCorner) {
            // Vector from center of corner circle to pixel
            const dx = x - cx;
            const dy = y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            // Normalized normal vector (pointing outward)
            let nx = dx / (dist || 1);
            let ny = dy / (dist || 1);
            // Distance to border: how far from the arc
            const distToBorder = r - dist;
            return { nx, ny, distToBorder, isCorner: true };
        } else {
            // Not in a corner: find closest edge
            // For each edge, compute distance and normal
            // Top edge
            if (y < r) {
                return { nx: 0, ny: -1, distToBorder: y, isCorner: false };
            }
            // Bottom edge
            if (y >= h - r) {
                return { nx: 0, ny: 1, distToBorder: h - 1 - y, isCorner: false };
            }
            // Left edge
            if (x < r) {
                return { nx: -1, ny: 0, distToBorder: x, isCorner: false };
            }
            // Right edge
            if (x >= w - r) {
                return { nx: 1, ny: 0, distToBorder: w - 1 - x, isCorner: false };
            }
            // Center region: no border effect
            // Find min distance to any edge
            const minDist = Math.min(x, y, w - 1 - x, h - 1 - y);
            // Default normal: up
            return { nx: 0, ny: 0, distToBorder: minDist, isCorner: false };
        }
    }

    /**
     * Apply a border-radius-aware refraction transformation to the whole image
     * @param {number} refractionStrength - max refraction at border
     * @param {number} borderWidth - width of the border region (in px) where refraction is applied
     * @param {function} [falloff] - optional function for falloff (default: quadratic)
     */
    applyBorderRadiusRefraction(refractionStrength, borderWidth, falloff) {
        const data = this.imageData.data;
        const w = this.width;
        const h = this.height;
        const r = Math.max(0, Math.min(this.radius, Math.min(w, h) / 2));
        if (!falloff) {
            // Quadratic falloff by default
            falloff = (d) => d * d;
        }
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const { nx, ny, distToBorder } = this.getBorderNormalAndDistance(x, y);
                // Only apply if within borderWidth from the border (arc or edge)
                let borderDist = Math.max(0, Math.min(borderWidth, distToBorder));
                let t = 1 - borderDist / (borderWidth || 1); // 1 at border, 0 at inner edge
                t = Math.max(0, Math.min(1, t));
                t = falloff(t);
                // Compute displacement
                const dx = nx * refractionStrength * t;
                const dy = ny * refractionStrength * t;
                // Write to R/B channels
                const pixelIndex = (y * w + x) * 4;
                let rVal = data[pixelIndex];
                let bVal = data[pixelIndex + 2];
                // Center value is 127, so add displacement scaled to [-127,127]
                rVal += 127 * dx;
                bVal += 127 * dy;
                data[pixelIndex] = Math.max(0, Math.min(255, Math.round(rVal)));
                data[pixelIndex + 2] = Math.max(0, Math.min(255, Math.round(bVal)));
            }
        }
    }
    getImageData() {
        return this.imageData;
    }
}
// --- Glass Refraction SVG Filter ---
function calculateRefractionMap(refraction, width, height, radius) {
    refraction /= 2;
    const refractionEditor = new RefractionEditor(width, height, radius);
    // Use the new border-radius-aware refraction for the border region
    // The borderWidth is offset (how far the effect should reach inwards)
    // The refractionStrength is refraction (max at border)
    //refractionEditor.applyBorderRadiusRefraction(refraction, offset, (t) => t * t); // quadratic falloff
    console.log("refractionEditor", refraction);
    var offset = height / 2
    refractionEditor.addTransformation(0, 1 * refraction, 'top', 0, 0, width, offset, (x) => Math.pow(x, 1));
    refractionEditor.addTransformation(0, -1 * refraction, 'bottom', 0, height - offset, width, offset, (x) => Math.pow(x, 1));
    //now left and rigght
    offset = width / 2;
    refractionEditor.addTransformation(1 * refraction, 0, 'left', 0, 0, offset, height, (x) => Math.pow(x, 1));
    refractionEditor.addTransformation(-1 * refraction, 0, 'right', width - offset, 0, offset, height, (x) => Math.pow(x, 1));


    return refractionEditor.getImageData();
}


async function createGlassSVGFilter(el) {
    const width = el ? el.offsetWidth : 100;
    const height = el ? el.offsetHeight : 100;
    // Use a stable ID based on element and size to avoid regenerating filters unnecessarily
    const filterId = `variablur-glass-${el.dataset.variablurUid ?? (el.dataset.variablurUid = crypto.randomUUID())}-${width}x${height}`;
    // calculateRefractionMap now returns ImageData, so we need to convert it to a blob URL
    // Get refraction and offset from element's CSS variables
    const style = window.getComputedStyle(el);
    const refractionValue = parseFloat(style.getPropertyValue('--variablur-glass-refraction')) || 0;
    var offsetValue = style.getPropertyValue('--variablur-glass-offset').trim();
    var borderRadius = parseFloat(window.getComputedStyle(el).borderRadius) || 0;
    const imageData = calculateRefractionMap(refractionValue, width, height, borderRadius);
    // Convert ImageData to Blob with canvasto blob
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    //canvas color space is srgb


    ctx.putImageData(imageData, 0, 0);
    ctx.fillStyle = "rgb(127, 127, 127)"; // Neutral gray for refraction
    // Fill the canvas with neutral gray for proper mask
    // Apply border radius if specified
    const canvas2 = new OffscreenCanvas(width, height);
    const ctx2 = canvas2.getContext('2d');
    ctx2.fillStyle = "rgb(127, 127, 127)"; //
    if (borderRadius > 0) {
        ctx2.beginPath();
        ctx2.roundRect(0, 0, width, height, borderRadius);
        ctx2.clip();
    }
    ctx2.fillRect(0, 0, width, height);
    if (offsetValue.endsWith('px')) {
        offsetValue = parseFloat(offsetValue);
    } else if (offsetValue.endsWith('%')) {
        offsetValue = (Math.min(width, height) / 100 * parseFloat(offsetValue))
    }

    ctx.filter = `blur(${offsetValue}px)`
    ctx.drawImage(canvas2, 0, 0, width, height);



    const blob = await canvas.convertToBlob({ type: 'image/png' });
    // Create a blob URL
    const dataURL = URL.createObjectURL(blob);
    // Store the blob URL in the element for cleanup later
    let blobUrls = elementBlobUrls.get(el) || [];
    blobUrls.push(dataURL);
    elementBlobUrls.set(el, blobUrls);

    // Auto cleanup - revoke the blob URL when filter is regenerated or element is detached
    // Store cleanup function for later use
    if (!el.variablurCleanupCallbacks) {
        el.variablurCleanupCallbacks = new Set();
    }

    const cleanupCallback = () => {
        URL.revokeObjectURL(dataURL);
        const currentUrls = elementBlobUrls.get(el) || [];
        const updatedUrls = currentUrls.filter(url => url !== dataURL);
        if (updatedUrls.length === 0) {
            elementBlobUrls.delete(el);
        } else {
            elementBlobUrls.set(el, updatedUrls);
        }
    };

    el.variablurCleanupCallbacks.add(cleanupCallback);

    // Clean up previous blob URLs when creating new ones
    if (el.variablurCleanupCallbacks.size > 1) {
        const callbacks = Array.from(el.variablurCleanupCallbacks);
        callbacks.slice(0, -1).forEach(callback => {
            callback();
            el.variablurCleanupCallbacks.delete(callback);
        });
    }
    window.openDataURL = () => {
        //open data uri in new tab as direct url

        window.open(dataURL, '_blank');

    };
    const svgString = `
      <filter id="${filterId}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
        <feImage result="FEIMG" href="${dataURL}"/>
        <feDisplacementMap in="SourceGraphic" in2="FEIMG" scale="127" yChannelSelector="B" xChannelSelector="R"/>
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