/**
 * panel.js — HUD updates and input handling.
 *
 * Single responsibility: own all DOM interaction for the left panel.
 * The simulation knows nothing about the DOM; the panel knows nothing
 * about WebGPU.  Communication happens through plain callbacks.
 */

import { SHAPE_NAMES } from '../shapes/registry.js';
import { N } from '../gpu/buffers.js';

// ── HUD element references ────────────────────────────────────────────────────

const fpsEl    = () => document.getElementById('fps');
const statusEl = () => document.getElementById('status');
const phaseEl  = () => document.getElementById('phase');
const responseEl = () => document.getElementById('response');

// ── FPS counter ───────────────────────────────────────────────────────────────

let _fpsCount = 0;
let _fpsStart = performance.now();

/** Call once per frame with the current timestamp (ms). */
export function tickFPS(nowMs) {
    _fpsCount++;
    if (nowMs - _fpsStart >= 1000) {
        const fps = Math.round(_fpsCount * 1000 / (nowMs - _fpsStart));
        fpsEl().textContent = `${fps} fps`;
        _fpsCount = 0;
        _fpsStart = nowMs;
    }
}

// ── HUD setters ───────────────────────────────────────────────────────────────

export function setStatus(label) {
    statusEl().textContent = label;
}

export function setPhase(label) {
    phaseEl().textContent = label;
}

// ── Input initialisation ──────────────────────────────────────────────────────

/**
 * Wire up the prompt input panel.
 *
 * @param {{ onSubmit: (text: string) => void, onClear: () => void }} handlers
 */
export function initPanel({ onSubmit, onClear }) {
    const promptBox = document.getElementById('prompt-box');
    const sendBtn   = document.getElementById('send-btn');

    // Show available shape names as placeholder hint
    const hint = SHAPE_NAMES.slice(0, 5).join(', ') + '…';
    promptBox.placeholder = hint;

    function submit() {
        const text = promptBox.value.trim();
        if (text) {
            onSubmit(text);
        } else {
            responseEl().classList.remove('visible');
            onClear();
        }
    }

    sendBtn.addEventListener('click', submit);

    promptBox.addEventListener('keydown', e => {
        // Enter submits; Shift+Enter allows newlines
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
        // Escape clears and resumes auto-cycling
        if (e.key === 'Escape') {
            promptBox.value = '';
            responseEl().classList.remove('visible');
            onClear();
        }
    });
}

/** Show a message in the response area below the input. */
export function showResponse(msg) {
    const el = responseEl();
    el.textContent = msg;
    el.classList.add('visible');
}
