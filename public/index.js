"use strict";
/* global BareMux, $scramjetLoadController, registerSW, search, __uv$config */

const form = document.getElementById("sj-form");
const browserForm = document.getElementById("browser-form");
const address = document.getElementById("sj-address");
const browserAddress = document.getElementById("browser-address");
const searchEngine = document.getElementById("sj-search-engine");
const searchProvider = document.getElementById("search-provider");
const proxyEngine = document.getElementById("proxy-engine");
const launchButton = document.getElementById("sj-launch");
const launchPanel = document.getElementById("launch-panel");
const browserShell = document.getElementById("browser-shell");
const frameStage = document.getElementById("frame-stage");
const frameLoader = document.getElementById("frame-loader");
const statusPanel = document.getElementById("status-panel");
const statusText = document.getElementById("sj-status");
const errorPanel = document.getElementById("sj-error-panel");
const error = document.getElementById("sj-error");
const errorCode = document.getElementById("sj-error-code");
const workerStatus = document.getElementById("worker-status");
const transportStatus = document.getElementById("transport-status");
const backButton = document.getElementById("back-button");
const forwardButton = document.getElementById("forward-button");
const reloadButton = document.getElementById("reload-button");
const homeButton = document.getElementById("home-button");
const detachButton = document.getElementById("detach-button");
const quickLinks = document.querySelectorAll("[data-url]");
const spaceCanvas = document.getElementById("space-canvas");

const appVersion = "2026-06-23.1";
const baremuxWorker = `/baremux/worker.js?v=${appVersion}`;
const epoxyTransport = `/epoxy/index.mjs?v=${appVersion}`;

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});

const scramjetReady = scramjet.init();

const connection = new BareMux.BareMuxConnection(baremuxWorker);

let activeFrame = null;
let activeUrl = "";
let activeEngine = "";
let launchInProgress = false;

form.addEventListener("submit", (event) => {
	event.preventDefault();
	void navigateFromInput(address.value);
});

browserForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void navigateFromInput(browserAddress.value);
});

searchProvider.addEventListener("change", () => {
	searchEngine.value = searchProvider.value;
});

quickLinks.forEach((button) => {
	button.addEventListener("click", () => {
		const url = button.getAttribute("data-url");
		if (url) void navigateTo(url);
	});
});

backButton.addEventListener("click", () => {
	runFrameAction((frameWindow) => frameWindow.history.back());
});

forwardButton.addEventListener("click", () => {
	runFrameAction((frameWindow) => frameWindow.history.forward());
});

reloadButton.addEventListener("click", () => {
	showFrameLoader("Reloading");
	runFrameAction((frameWindow) => frameWindow.location.reload());
});

homeButton.addEventListener("click", () => {
	resetToHome();
});

detachButton.addEventListener("click", () => {
	const proxiedUrl = getFrameLocation();
	if (proxiedUrl) window.open(proxiedUrl, "_blank", "noopener,noreferrer");
});

address.focus();
initSpaceCanvas();

async function navigateFromInput(value) {
	const cleanValue = value.trim();
	if (!cleanValue) return;

	const nextUrl = search(cleanValue, searchEngine.value);
	await navigateTo(nextUrl);
}

async function navigateTo(url) {
	if (launchInProgress) return;

	clearError();
	setBusy(true);
	setStatus("Connecting", "busy");
	showFrameLoader("Connecting");
	activeUrl = url;
	address.value = url;
	browserAddress.value = url;

	try {
		await ensureServiceWorker();
		await ensureTransport();
		openBrowserShell();
		const frame = ensureFrame(getRuntimeEngine());
		frame.go(url);
		setStatus("Loading", "busy");
	} catch (err) {
		showError("VoidGate could not open that address.", err);
		setStatus("Connection failed", "error");
		hideFrameLoader();
		openLaunchPanel();
	} finally {
		setBusy(false);
	}
}

async function ensureServiceWorker() {
	workerStatus.textContent = "Registering";
	await registerSW();
	await scramjetReady;
	await scramjet.modifyConfig({});
	workerStatus.textContent = "Ready";
}

async function ensureTransport() {
	const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${
		location.host
	}/wisp/`;

	transportStatus.textContent = "Connecting";
	if ((await connection.getTransport()) !== epoxyTransport) {
		await connection.setTransport(epoxyTransport, [{ wisp: wispUrl }]);
	}
	transportStatus.textContent = getTransportLabel();
}

function ensureFrame(engine) {
	if (activeFrame && activeEngine === engine) return activeFrame;

	if (activeFrame) activeFrame.frame.remove();

	activeEngine = engine;
	activeFrame =
		engine === "ultraviolet" ? createUltravioletFrame() : createScramjetFrame();
	frameStage.appendChild(activeFrame.frame);

	return activeFrame;
}

function createScramjetFrame() {
	const frame = scramjet.createFrame();
	frame.frame.id = "sj-frame";
	frame.frame.title = "VoidGate Scramjet browser";
	frame.frame.addEventListener("load", handleFrameLoad);

	return {
		frame: frame.frame,
		go: (url) => frame.go(url),
	};
}

function createUltravioletFrame() {
	const frame = document.createElement("iframe");
	frame.id = "sj-frame";
	frame.title = "VoidGate Ultraviolet browser";
	frame.addEventListener("load", handleFrameLoad);

	return {
		frame,
		go: (url) => {
			frame.src = `${__uv$config.prefix}${__uv$config.encodeUrl(url)}`;
		},
	};
}

function handleFrameLoad() {
	hideFrameLoader();
	setStatus("Connected", "ready");
	const frameUrl = getFrameLocation();
	if (frameUrl) browserAddress.value = activeUrl;
}

function getRuntimeEngine() {
	return proxyEngine.value === "ultraviolet" ? "ultraviolet" : "scramjet";
}

function getTransportLabel() {
	if (proxyEngine.value === "ultraviolet") return "Ultraviolet via Epoxy";
	if (proxyEngine.value === "nebula") return "Nebula mode via Scramjet";
	return "Scramjet via Epoxy";
}

function runFrameAction(action) {
	if (!activeFrame) return;

	try {
		action(activeFrame.frame.contentWindow);
	} catch (err) {
		showError("That page did not allow the browser control action.", err);
		setStatus("Control blocked", "error");
		hideFrameLoader();
	}
}

function getFrameLocation() {
	if (!activeFrame) return "";

	try {
		return activeFrame.frame.contentWindow.location.href;
	} catch (err) {
		return activeFrame.frame.src;
	}
}

function resetToHome() {
	if (activeFrame) {
		activeFrame.frame.remove();
		activeFrame = null;
	}

	activeUrl = "";
	activeEngine = "";
	address.value = "";
	browserAddress.value = "";
	workerStatus.textContent =
		navigator.serviceWorker && navigator.serviceWorker.controller
			? "Ready"
			: "Pending";
	transportStatus.textContent = "Epoxy over Wisp";
	hideFrameLoader();
	clearError();
	setStatus("Ready", "ready");
	openLaunchPanel();
	address.focus();
}

function openBrowserShell() {
	launchPanel.hidden = true;
	browserShell.hidden = false;
}

function openLaunchPanel() {
	browserShell.hidden = true;
	launchPanel.hidden = false;
}

function showFrameLoader(label) {
	frameLoader.hidden = false;
	frameLoader.querySelector("p").textContent = label;
}

function hideFrameLoader() {
	frameLoader.hidden = true;
}

function setBusy(isBusy) {
	launchInProgress = isBusy;
	launchButton.disabled = isBusy;
}

function setStatus(message, state) {
	statusText.textContent = message;
	statusPanel.dataset.state = state;
}

function showError(message, err) {
	errorPanel.hidden = false;
	error.textContent = message;
	errorCode.textContent = err && err.stack ? err.stack : String(err);
}

function clearError() {
	errorPanel.hidden = true;
	error.textContent = "";
	errorCode.textContent = "";
}

function initSpaceCanvas() {
	if (!spaceCanvas) return;

	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const context = spaceCanvas.getContext("2d");
	let width = 0;
	let height = 0;
	let stars = [];
	let animationFrame = 0;

	function resize() {
		const scale = Math.min(window.devicePixelRatio || 1, 2);
		width = window.innerWidth;
		height = window.innerHeight;
		spaceCanvas.width = Math.floor(width * scale);
		spaceCanvas.height = Math.floor(height * scale);
		spaceCanvas.style.width = `${width}px`;
		spaceCanvas.style.height = `${height}px`;
		context.setTransform(scale, 0, 0, scale, 0, 0);
		stars = createStars(Math.min(190, Math.floor((width * height) / 5800)));
		draw(0);
	}

	function createStars(count) {
		return Array.from({ length: count }, () => ({
			x: Math.random() * width,
			y: Math.random() * height,
			radius: 0.5 + Math.random() * 2.7,
			speed: 0.18 + Math.random() * 1.35,
			alpha: 0.24 + Math.random() * 0.72,
			drift: -0.18 + Math.random() * 0.36,
		}));
	}

	function draw() {
		context.clearRect(0, 0, width, height);
		const gradient = context.createRadialGradient(
			width * 0.5,
			height * 0.42,
			0,
			width * 0.5,
			height * 0.42,
			Math.max(width, height) * 0.74
		);
		gradient.addColorStop(0, "rgba(24, 38, 62, 0.42)");
		gradient.addColorStop(0.42, "rgba(5, 9, 16, 0.7)");
		gradient.addColorStop(1, "rgba(0, 0, 0, 1)");
		context.fillStyle = gradient;
		context.fillRect(0, 0, width, height);

		for (const star of stars) {
			context.beginPath();
			context.fillStyle = `rgba(255,255,255,${star.alpha})`;
			context.shadowBlur = star.radius * 6;
			context.shadowColor = "rgba(255,255,255,0.7)";
			context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
			context.fill();
			context.shadowBlur = 0;

			if (!reducedMotion.matches) {
				star.y += star.speed;
				star.x += star.drift;
				if (star.y - star.radius > height) {
					star.y = -star.radius;
					star.x = Math.random() * width;
				}
				if (star.x < -8) star.x = width + 8;
				if (star.x > width + 8) star.x = -8;
			}
		}

		if (!reducedMotion.matches) animationFrame = requestAnimationFrame(draw);
	}

	function restart() {
		cancelAnimationFrame(animationFrame);
		resize();
	}

	window.addEventListener("resize", restart);
	reducedMotion.addEventListener("change", restart);
	restart();
}
