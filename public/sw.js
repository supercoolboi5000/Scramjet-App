importScripts("/scram/scramjet.all.js");
importScripts("/uv/uv.bundle.js");
importScripts("/uv-app.config.js");
importScripts("/uv/uv.sw.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();
const ultraviolet = new UVServiceWorker();

async function handleRequest(event) {
	await scramjet.loadConfig();
	if (scramjet.route(event)) {
		return scramjet.fetch(event);
	}

	if (ultraviolet.route(event)) {
		return ultraviolet.fetch(event);
	}

	return fetch(event.request);
}

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
