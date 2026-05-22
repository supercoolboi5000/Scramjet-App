"use strict";
/* global BareMux, $scramjetLoadController, registerSW, search */

const form = document.getElementById("sj-form");
const browserForm = document.getElementById("browser-form");
const address = document.getElementById("sj-address");
const browserAddress = document.getElementById("browser-address");
const searchEngine = document.getElementById("sj-search-engine");
const searchProvider = document.getElementById("search-provider");
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
	const nextUrl = search(value.trim(), searchEngine.value);
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
		const frame = ensureFrame();
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
	if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
		await connection.setTransport("/libcurl/index.mjs", [
			{ websocket: wispUrl },
		]);
	}
	transportStatus.textContent = "Connected";
}

function ensureFrame() {
	if (activeFrame) return activeFrame;

	activeFrame = scramjet.createFrame();
	activeFrame.frame.id = "sj-frame";
	activeFrame.frame.title = "Invisi Proxy browser";
	activeFrame.frame.addEventListener("load", () => {
		hideFrameLoader();
		setStatus("Connected", "ready");
		const frameUrl = getFrameLocation();
		if (frameUrl) browserAddress.value = activeUrl;
	});
	frameStage.appendChild(activeFrame.frame);

	return activeFrame;
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
	address.value = "";
	browserAddress.value = "";
	workerStatus.textContent =
		navigator.serviceWorker && navigator.serviceWorker.controller
			? "Ready"
			: "Pending";
	transportStatus.textContent = "Libcurl over Wisp";
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
