import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const localHost = process.env.QA_HOST || "127.0.0.1";
const localPort = process.env.QA_PORT || "8766";
const baseUrl = process.env.QA_BASE_URL || `http://${localHost}:${localPort}/`;
const discover = process.argv.includes("--discover");
const rehearse = process.argv.includes("--rehearse");
const recordingDir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-saas-demo-"));
const output = path.resolve(
	import.meta.dirname,
	"../../../docs/assets/orbit-saas-demo.webm",
);

function log(message) {
	process.stdout.write(`${message}\n`);
}

async function ensureVisible(page, selector, label) {
	const element = page.locator(selector).first();
	if (!(await element.isVisible().catch(() => false))) {
		throw new Error(`REHEARSAL FAIL: ${label} not visible (${selector})`);
	}
	log(`REHEARSAL OK: ${label}`);
	return element;
}

async function injectOverlays(page) {
	await page.evaluate(() => {
		const svgNamespace = ["http:", "", "www.w3.org", "2000", "svg"].join("/");
		if (!document.querySelector("#demo-cursor")) {
			const cursor = document.createElement("div");
			cursor.id = "demo-cursor";
			const svg = document.createElementNS(svgNamespace, "svg");
			svg.setAttribute("width", "28");
			svg.setAttribute("height", "28");
			svg.setAttribute("viewBox", "0 0 28 28");
			const pointer = document.createElementNS(svgNamespace, "path");
			pointer.setAttribute("d", "M4 2L23 15L14 16L10 25L4 2Z");
			pointer.setAttribute("fill", "white");
			pointer.setAttribute("stroke", "#07111F");
			pointer.setAttribute("stroke-width", "1.8");
			pointer.setAttribute("stroke-linejoin", "round");
			svg.append(pointer);
			cursor.append(svg);
			cursor.style.cssText =
				"position:fixed;left:16px;top:16px;z-index:999999;pointer-events:none;width:28px;height:28px;filter:drop-shadow(2px 2px 3px rgba(0,0,0,.35));transition:left .09s linear,top .09s linear";
			document.body.append(cursor);
			document.addEventListener("mousemove", (event) => {
				cursor.style.left = `${event.clientX}px`;
				cursor.style.top = `${event.clientY}px`;
			});
		}
		if (!document.querySelector("#demo-subtitle")) {
			const subtitle = document.createElement("div");
			subtitle.id = "demo-subtitle";
			subtitle.style.cssText =
				"position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:999998;pointer-events:none;padding:10px 18px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(7,17,31,.88);color:white;font:600 15px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;letter-spacing:.01em;box-shadow:0 10px 30px rgba(7,17,31,.24);opacity:0;transition:opacity .22s";
			document.body.append(subtitle);
		}
	});
}

async function showSubtitle(page, text, delay = 700) {
	await page.evaluate((value) => {
		const subtitle = document.querySelector("#demo-subtitle");
		subtitle.textContent = value;
		subtitle.style.opacity = value ? "1" : "0";
	}, text);
	if (text) await page.waitForTimeout(delay);
}

async function moveAndClick(page, selector, label, delay = 1100) {
	const element = await ensureVisible(page, selector, label);
	await element.scrollIntoViewIfNeeded();
	const box = await element.boundingBox();
	if (!box) throw new Error(`No box for ${label}`);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 14,
	});
	await page.waitForTimeout(280);
	await element.click();
	await page.waitForTimeout(delay);
}

async function typeSlowly(page, selector, text, label) {
	const element = await ensureVisible(page, selector, label);
	const box = await element.boundingBox();
	if (!box) throw new Error(`No box for ${label}`);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
		steps: 12,
	});
	await element.click();
	await element.fill("");
	await element.pressSequentially(text, { delay: 55 });
	await page.waitForTimeout(800);
}

async function panElements(page, selector, count = 4) {
	const elements = await page.locator(selector).all();
	for (const element of elements.slice(0, count)) {
		const box = await element.boundingBox();
		if (!box || box.y > 680) continue;
		await page.mouse.move(
			box.x + box.width / 2,
			box.y + Math.min(48, box.height / 2),
			{ steps: 10 },
		);
		await page.waitForTimeout(360);
	}
}

async function fieldMap(page) {
	return page.evaluate(() =>
		Array.from(
			document.querySelectorAll(
				"input, select, textarea, button, [contenteditable]",
			),
		)
			.filter((element) => element.offsetParent !== null)
			.map((element) => ({
				tag: element.tagName,
				type: element.type || "",
				id: element.id || "",
				action: element.dataset.action || "",
				page: element.dataset.page || "",
				placeholder: element.placeholder || "",
				text: element.textContent?.trim().slice(0, 50) || "",
			})),
	);
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
	viewport: { width: 1280, height: 720 },
	recordVideo:
		discover || rehearse
			? undefined
			: { dir: recordingDir, size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
let video;

try {
	await page.goto(baseUrl, { waitUntil: "networkidle" });
	if (discover) {
		for (const route of [
			"overview",
			"customers",
			"customerDetail",
			"automations",
			"automationBuilder",
			"billing",
			"planManagement",
			"settings",
			"integrations",
		]) {
			await page.goto(`${baseUrl}#${route}`, { waitUntil: "networkidle" });
			log(`\n#${route}`);
			log(JSON.stringify(await fieldMap(page), null, 2));
		}
	} else if (rehearse) {
		const checks = [
			["[data-page='analytics']", "Analytics navigation"],
			["[data-page='customers']", "Customers navigation"],
			["#customer-search", "Customer search"],
			["[data-page='automations']", "Automations navigation"],
			["[data-action='new-automation']", "New automation"],
			["[data-page='billing']", "Billing navigation"],
			["[data-action='manage-plan']", "Manage plan"],
			["[data-page='settings']", "Settings navigation"],
			["[data-settings='integrations']", "Integrations settings"],
		];
		for (const [selector, label] of checks) {
			if (selector.includes("customer-search"))
				await page.goto(`${baseUrl}#customers`);
			if (selector.includes("new-automation"))
				await page.goto(`${baseUrl}#automations`);
			if (selector.includes("manage-plan"))
				await page.goto(`${baseUrl}#billing`);
			if (selector.includes("data-settings"))
				await page.goto(`${baseUrl}#settings`);
			await ensureVisible(page, selector, label);
		}
		await page.goto(`${baseUrl}#automationBuilder`);
		await ensureVisible(page, "[data-builder-step='3']", "Builder test step");
		await ensureVisible(
			page,
			"[data-action='run-builder-test']",
			"Run automation test",
		);
		await page.goto(`${baseUrl}#planManagement`);
		await ensureVisible(page, "[data-plan='Enterprise']", "Enterprise plan");
		await ensureVisible(page, "[data-action='confirm-plan']", "Confirm plan");
		await page.goto(`${baseUrl}#integrations`);
		await ensureVisible(
			page,
			"[data-integration='salesforce']",
			"Salesforce integration",
		);
		log("REHEARSAL PASSED");
	} else {
		video = page.video();
		await injectOverlays(page);
		await showSubtitle(
			page,
			"A live SaaS flow, built from the same design map",
		);
		await panElements(page, ".kpi", 4);

		await showSubtitle(page, "Explore revenue and retention");
		await moveAndClick(
			page,
			"[data-page='analytics']",
			"Analytics navigation",
			1400,
		);
		await panElements(page, ".card", 3);

		await showSubtitle(page, "Find a customer, then open account detail");
		await moveAndClick(
			page,
			"[data-page='customers']",
			"Customers navigation",
			900,
		);
		await typeSlowly(page, "#customer-search", "Acme", "Customer search");
		await moveAndClick(
			page,
			"#customer-rows tr[data-customer='0']",
			"Acme customer row",
			1500,
		);
		await panElements(page, ".card", 4);

		await showSubtitle(page, "Build and test an automation");
		await moveAndClick(
			page,
			"[data-page='automations']",
			"Automations navigation",
			900,
		);
		await moveAndClick(
			page,
			"[data-action='new-automation']",
			"New automation",
			900,
		);
		await moveAndClick(
			page,
			"[data-builder-step='3']",
			"Builder test step",
			650,
		);
		await moveAndClick(
			page,
			"[data-action='run-builder-test']",
			"Run automation test",
			1300,
		);
		await moveAndClick(
			page,
			"[data-action='save-automation']",
			"Save automation",
			1400,
		);

		await showSubtitle(page, "Compare plans and confirm a change");
		await moveAndClick(
			page,
			"[data-page='billing']",
			"Billing navigation",
			900,
		);
		await moveAndClick(page, "[data-action='manage-plan']", "Manage plan", 900);
		await moveAndClick(
			page,
			"[data-plan='Enterprise']",
			"Enterprise plan",
			850,
		);
		await moveAndClick(
			page,
			"[data-action='confirm-plan']",
			"Confirm plan",
			1400,
		);

		await showSubtitle(page, "Connect an integration from Settings");
		await moveAndClick(
			page,
			"[data-page='settings']",
			"Settings navigation",
			850,
		);
		await moveAndClick(
			page,
			"[data-settings='integrations']",
			"Integrations settings",
			900,
		);
		await moveAndClick(
			page,
			"[data-integration='salesforce']",
			"Salesforce integration",
			1200,
		);
		await showSubtitle(page, "One prototype. Every route connected.", 1800);
		await showSubtitle(page, "");
		await page.waitForTimeout(900);
	}
} finally {
	await context.close();
	if (video) {
		fs.mkdirSync(path.dirname(output), { recursive: true });
		fs.copyFileSync(await video.path(), output);
		log(`Video saved: ${output}`);
	}
	await browser.close();
	fs.rmSync(recordingDir, { recursive: true, force: true });
}
