import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
	DesignMcpConnection,
	OAUTH_STORE_PATH,
	type McpCallResult,
	type McpTool,
} from "./connection.js";
import {
	assertProfileAllowed,
	assertToolAllowed,
	isDesignWriteTool,
	loadDesignRunnerConfig,
} from "./policy.js";

const PROFILE_IDS = ["ardot-remote", "ardot-desktop"] as const;
type ProfileId = (typeof PROFILE_IDS)[number];

const connection = new DesignMcpConnection();
const registered = new Map<string, string>();
let catalog: McpTool[] = [];

function parseProfile(value: string | undefined): ProfileId {
	const profile = value || "ardot-remote";
	if (!PROFILE_IDS.includes(profile as ProfileId))
		throw new Error(`Unknown design MCP profile: ${profile}`);
	return profile as ProfileId;
}

function normalizeName(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function piToolName(profile: ProfileId, remoteName: string): string {
	return `${profile.replace("-", "_")}_${normalizeName(remoteName)}`.slice(
		0,
		96,
	);
}

function oneLine(value: string | undefined): string {
	return (value || "No description").replace(/\s+/g, " ").trim();
}

function scoreTool(tool: McpTool, query: string): number {
	const normalized = query.toLowerCase();
	const terms = normalized.split(/[^a-z0-9_]+/).filter(Boolean);
	const name = tool.name.toLowerCase();
	const haystack = `${name} ${tool.description || ""}`.toLowerCase();
	let score = name === normalized ? 100 : name.includes(normalized) ? 20 : 0;
	for (const term of terms) {
		if (name.includes(term)) score += 8;
		else if (haystack.includes(term)) score += 1;
	}
	return score;
}

async function openAuthorization(
	pi: ExtensionAPI,
	url: URL,
	ctx: ExtensionContext,
): Promise<void> {
	ctx.ui.notify(
		"Ardot OAuth opened in your browser. Approve once, then return to Pi.",
		"info",
	);
	let command: string;
	let args: string[];
	if (process.platform === "darwin") {
		command = "open";
		args = [url.toString()];
	} else if (process.platform === "win32") {
		command = "cmd";
		args = ["/c", "start", "", url.toString()];
	} else {
		command = "xdg-open";
		args = [url.toString()];
	}
	const result = await pi.exec(command, args, {
		signal: ctx.signal,
		timeout: 15_000,
	});
	if (result.code !== 0)
		throw new Error(
			`Cannot open OAuth browser: ${result.stderr || result.stdout}`,
		);
}

async function connectProfile(
	pi: ExtensionAPI,
	profile: ProfileId,
	ctx: ExtensionContext,
	onUpdate?: (text: string) => void,
): Promise<readonly McpTool[]> {
	const config = await loadDesignRunnerConfig(ctx.cwd);
	assertProfileAllowed(profile, config);
	onUpdate?.(`Connecting to ${profile}...`);
	catalog = [
		...(await connection.connect(
			profile,
			(url) => openAuthorization(pi, url, ctx),
			ctx.signal,
		)),
	];
	return catalog;
}

function deactivateRemoteTools(pi: ExtensionAPI): void {
	const names = new Set(registered.values());
	pi.setActiveTools(pi.getActiveTools().filter((name) => !names.has(name)));
}

async function saveFullOutput(tool: string, text: string): Promise<string> {
	const directory = join(tmpdir(), "pi-design-mcp");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const path = join(directory, `${Date.now()}-${normalizeName(tool)}.txt`);
	await writeFile(path, text, { mode: 0o600 });
	return path;
}

async function toPiResult(
	profile: ProfileId,
	tool: string,
	result: McpCallResult,
) {
	if (!("content" in result)) {
		const text = JSON.stringify(result.toolResult ?? result, null, 2);
		return {
			content: [{ type: "text" as const, text }],
			details: { profile, tool },
		};
	}

	const rawContent = result.content;
	if (!Array.isArray(rawContent))
		throw new Error("MCP result content is not an array");
	const textParts: string[] = [];
	const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
	for (const rawItem of rawContent) {
		if (!rawItem || typeof rawItem !== "object") continue;
		const item = rawItem as Record<string, unknown>;
		if (item.type === "text" && typeof item.text === "string")
			textParts.push(item.text);
		else if (
			item.type === "image" &&
			typeof item.data === "string" &&
			typeof item.mimeType === "string"
		) {
			images.push({ type: "image", data: item.data, mimeType: item.mimeType });
		} else if (item.type === "resource")
			textParts.push(JSON.stringify(item.resource, null, 2));
		else if (
			item.type === "resource_link" &&
			typeof item.name === "string" &&
			typeof item.uri === "string"
		) {
			textParts.push(`${item.name}: ${item.uri}`);
		} else if (typeof item.type === "string")
			textParts.push(`[${item.type} content omitted]`);
	}
	const structuredContent =
		"structuredContent" in result &&
		result.structuredContent &&
		typeof result.structuredContent === "object"
			? result.structuredContent
			: undefined;
	if (structuredContent)
		textParts.push(JSON.stringify(structuredContent, null, 2));
	const fullText = textParts.join("\n\n") || "(empty MCP result)";
	const truncation = truncateHead(fullText, {
		maxBytes: DEFAULT_MAX_BYTES,
		maxLines: DEFAULT_MAX_LINES,
	});
	let text = truncation.content;
	let fullOutputPath: string | undefined;
	if (truncation.truncated) {
		fullOutputPath = await saveFullOutput(tool, fullText);
		text += `\n\n[Output truncated: ${truncation.outputLines}/${truncation.totalLines} lines, ${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}. Full output: ${fullOutputPath}]`;
	}
	if ("isError" in result && result.isError === true) throw new Error(text);
	return {
		content: [{ type: "text" as const, text }, ...images],
		details: { profile, tool, structuredContent, fullOutputPath },
	};
}

export default function designMcpExtension(pi: ExtensionAPI) {
	function findRemoteTool(name: string): McpTool {
		const tool = catalog.find((item) => item.name === name);
		if (!tool) throw new Error(`MCP tool is unavailable: ${name}`);
		return tool;
	}

	function registerRemoteTool(profile: ProfileId, tool: McpTool): string {
		const key = `${profile}:${tool.name}`;
		const existing = registered.get(key);
		if (existing) return existing;
		const name = piToolName(profile, tool.name);
		const schema =
			tool.inputSchema?.type === "object"
				? tool.inputSchema
				: { type: "object", properties: {} };
		pi.registerTool({
			name,
			label: `${profile} · ${tool.name}`,
			description: tool.description || `Call ${tool.name} on ${profile}`,
			parameters: Type.Unsafe<Record<string, unknown>>(schema),
			async execute(_toolCallId, params, signal, onUpdate, ctx) {
				if (connection.profileId !== profile)
					throw new Error(`Connect ${profile} before calling ${name}`);
				const config = await loadDesignRunnerConfig(ctx.cwd);
				assertProfileAllowed(profile, config);
				assertToolAllowed(tool, config);
				onUpdate?.({
					content: [{ type: "text", text: `Calling ${tool.name}...` }],
					details: { stage: "call", tool: tool.name },
				});
				return toPiResult(
					profile,
					tool.name,
					await connection.callTool(tool.name, params, signal),
				);
			},
		});
		registered.set(key, name);
		return name;
	}

	pi.registerTool({
		name: "design_mcp_connect",
		label: "Design MCP Connect",
		description:
			"Connect Pi directly to a design MCP server. ardot-remote is GUI-free but uses Ardot Cloud and one-time browser OAuth. ardot-desktop requires the Ardot GUI.",
		promptSnippet:
			"Connect Pi to the selected design MCP provider without manually operating its design UI",
		promptGuidelines: [
			"Use design_mcp_connect before design_mcp_load or provider tools when the selected Design Runner is an MCP provider.",
		],
		parameters: Type.Object({
			profile: Type.Optional(StringEnum(PROFILE_IDS)),
		}),
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const profile = parseProfile(params.profile);
			deactivateRemoteTools(pi);
			const tools = await connectProfile(pi, profile, ctx, (text) => {
				onUpdate?.({
					content: [{ type: "text", text }],
					details: { stage: "connect", profile },
				});
			});
			return {
				content: [
					{
						type: "text",
						text: `Connected ${profile}: ${tools.length} MCP tools discovered. Use design_mcp_load to load only the tools needed for the task.`,
					},
				],
				details: {
					profile,
					server: connection.serverVersion,
					tools: tools.map((tool) => tool.name),
				},
			};
		},
	});

	pi.registerTool({
		name: "design_mcp_load",
		label: "Design MCP Load Tools",
		description:
			"Search the connected design MCP catalog and dynamically load matching provider tools into Pi.",
		promptSnippet:
			"Search and load design-provider tools for the current workflow",
		parameters: Type.Object({
			query: Type.String({
				description:
					"Capability or exact remote tool name, such as canvas edit, screenshot, variables, components, export, or batch_edit",
			}),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
		}),
		async execute(_toolCallId, params) {
			const profile = connection.profileId;
			if (!profile) throw new Error("Connect design MCP first");
			const matches = catalog
				.map((tool) => ({ tool, score: scoreTool(tool, params.query) }))
				.filter((entry) => entry.score > 0)
				.sort((left, right) => right.score - left.score)
				.slice(0, params.limit ?? 6);
			if (matches.length === 0)
				throw new Error(`No design MCP tools match: ${params.query}`);
			const loaded = matches.map(({ tool }) =>
				registerRemoteTool(profile, tool),
			);
			pi.setActiveTools([...new Set([...pi.getActiveTools(), ...loaded])]);
			return {
				content: [
					{
						type: "text",
						text: `Loaded tools:\n${loaded.map((name) => `- ${name}`).join("\n")}`,
					},
				],
				details: { profile, loaded },
			};
		},
	});

	pi.registerTool({
		name: "design_mcp_list",
		label: "Design MCP List Tools",
		description:
			"List the connected design MCP tool catalog with compact descriptions.",
		parameters: Type.Object({
			query: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params) {
			if (!connection.connected) throw new Error("Connect design MCP first");
			const query = params.query?.toLowerCase();
			const tools = catalog.filter(
				(tool) =>
					!query ||
					`${tool.name} ${tool.description || ""}`
						.toLowerCase()
						.includes(query),
			);
			const text = tools
				.map(
					(tool) =>
						`${tool.name}${isDesignWriteTool(tool) ? " [write]" : " [read]"}: ${oneLine(tool.description).slice(0, 220)}`,
				)
				.join("\n");
			return {
				content: [{ type: "text", text: text || "No matching tools" }],
				details: { count: tools.length },
			};
		},
	});

	pi.registerTool({
		name: "design_mcp_call",
		label: "Design MCP Call",
		description:
			"Call one connected design MCP tool by its remote name. Prefer dynamically loaded provider tools when available because they expose exact schemas.",
		parameters: Type.Object({
			tool: Type.String(),
			arguments: Type.Optional(Type.Record(Type.String(), Type.Any())),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const profile = connection.profileId;
			if (!profile) throw new Error("Connect design MCP first");
			const tool = findRemoteTool(params.tool);
			const config = await loadDesignRunnerConfig(ctx.cwd);
			assertProfileAllowed(profile, config);
			assertToolAllowed(tool, config);
			return toPiResult(
				profile,
				tool.name,
				await connection.callTool(tool.name, params.arguments ?? {}, signal),
			);
		},
	});

	pi.registerTool({
		name: "design_mcp_status",
		label: "Design MCP Status",
		description:
			"Show Design MCP connection, server version, discovered tools, policy file, and OAuth state path without exposing credentials.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const config = await loadDesignRunnerConfig(ctx.cwd);
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(
							{
								connected: connection.connected,
								profile: connection.profileId,
								server: connection.serverVersion,
								toolCount: catalog.length,
								runner: config.runner,
								policy: config.policy,
								configPath: config.path,
								oauthStore: OAUTH_STORE_PATH,
							},
							null,
							2,
						),
					},
				],
				details: {},
			};
		},
	});

	pi.registerCommand("design-mcp", {
		description:
			"Manage design MCP: connect [profile], status, list, disconnect, logout",
		handler: async (args, ctx) => {
			const [action = "status", profileArg] = args.trim().split(/\s+/);
			if (action === "connect") {
				const profile = parseProfile(profileArg);
				deactivateRemoteTools(pi);
				const tools = await connectProfile(pi, profile, ctx);
				ctx.ui.notify(`Connected ${profile}: ${tools.length} tools`, "info");
				return;
			}
			if (action === "disconnect") {
				deactivateRemoteTools(pi);
				await connection.close();
				catalog = [];
				ctx.ui.notify("Design MCP disconnected", "info");
				return;
			}
			if (action === "logout") {
				deactivateRemoteTools(pi);
				await connection.logout();
				catalog = [];
				ctx.ui.notify("Design MCP OAuth credentials removed", "info");
				return;
			}
			if (action === "list") {
				ctx.ui.notify(
					catalog.map((tool) => tool.name).join(", ") || "Not connected",
					"info",
				);
				return;
			}
			const config = await loadDesignRunnerConfig(ctx.cwd);
			ctx.ui.notify(
				`connected=${connection.connected} profile=${connection.profileId || "none"} tools=${catalog.length} runner=${config.runner}`,
				"info",
			);
		},
	});

	pi.on("session_shutdown", async () => {
		await connection.close();
	});
}
