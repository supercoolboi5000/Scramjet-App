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

const { ScramjetController } = $scramjetLoadController();

const scramjet = new ScramjetController({
	files: {
		wasm: "/scram/scramjet.wasm.wasm",
		all: "/scram/scramjet.all.js",
		sync: "/scram/scramjet.sync.js",
	},
});

scramjet.init();

const connection = new BareMux.BareMuxConnection("/baremux/worker.js");

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
		await ensureTransport();
		await ensureServiceWorker();
		openBrowserShell();
		const frame = ensureFrame(getRuntimeEngine());
		frame.go(url);
		setStatus("Loading", "busy");
	} catch (err) {
		showError("Invisi Proxy could not open that address.", err);
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
	workerStatus.textContent = "Ready";
}

async function ensureTransport() {
	const wispUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${
		location.host
	}/wisp/`;

	transportStatus.textContent = "Connecting";
	if ((await connection.getTransport()) !== "/epoxy/index.mjs") {
		await connection.setTransport("/epoxy/index.mjs", [{ wisp: wispUrl }]);
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
	frame.frame.title = "Invisi Proxy Scramjet browser";
	frame.frame.addEventListener("load", handleFrameLoad);

	return {
		frame: frame.frame,
		go: (url) => frame.go(url),
	};
}

function createUltravioletFrame() {
	const frame = document.createElement("iframe");
	frame.id = "sj-frame";
	frame.title = "Invisi Proxy Ultraviolet browser";
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
