import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PersistentOAuthProvider, OAUTH_STORE_PATH } from "./oauth-store.js";

export type McpTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
export type McpCallResult = Awaited<ReturnType<Client["callTool"]>>;

interface Profile {
	id: "ardot-remote" | "ardot-desktop";
	url: string;
	oauth: boolean;
}

const PROFILES: Record<Profile["id"], Profile> = {
	"ardot-remote": {
		id: "ardot-remote",
		url: "https://ardot.tencent.com/mcp",
		oauth: true,
	},
	"ardot-desktop": {
		id: "ardot-desktop",
		url: "http://127.0.0.1:50501/api/v1/mcp",
		oauth: false,
	},
};

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 17321;
const CALLBACK_PATH = "/callback";
const CALLBACK_URL = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

interface CallbackWaiter {
	server: Server;
	code: Promise<string>;
	close(): Promise<void>;
}

async function startCallbackServer(
	expectedState: () => string | undefined,
	signal?: AbortSignal,
): Promise<CallbackWaiter> {
	let settle: ((code: string) => void) | undefined;
	let fail: ((error: Error) => void) | undefined;
	let settled = false;
	const code = new Promise<string>((resolve, reject) => {
		settle = resolve;
		fail = reject;
	});
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", CALLBACK_URL);
		if (url.pathname !== CALLBACK_PATH) {
			response.writeHead(404).end("Not found");
			return;
		}
		const error = url.searchParams.get("error");
		const authCode = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		if (error || !authCode || !state || state !== expectedState()) {
			response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
			response.end("Authorization failed. Return to Pi.");
			if (!settled) {
				settled = true;
				fail?.(new Error(error || "OAuth callback validation failed"));
			}
			return;
		}
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(
			"<h1>Ardot authorization complete</h1><p>Return to Pi. This window can be closed.</p>",
		);
		if (!settled) {
			settled = true;
			settle?.(authCode);
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(CALLBACK_PORT, CALLBACK_HOST, () => resolve());
	});

	const timeout = setTimeout(() => {
		if (!settled) {
			settled = true;
			fail?.(new Error("OAuth authorization timed out after 5 minutes"));
		}
	}, 300_000);
	timeout.unref();

	const abort = () => {
		if (!settled) {
			settled = true;
			fail?.(new Error("OAuth authorization cancelled"));
		}
	};
	signal?.addEventListener("abort", abort, { once: true });

	return {
		server,
		code,
		async close() {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

export class DesignMcpConnection {
	private client?: Client;
	private transport?: StreamableHTTPClientTransport;
	private tools: McpTool[] = [];
	private profile?: Profile;

	get profileId(): Profile["id"] | undefined {
		return this.profile?.id;
	}

	get serverVersion() {
		return this.client?.getServerVersion();
	}

	get availableTools(): readonly McpTool[] {
		return this.tools;
	}

	get connected(): boolean {
		return Boolean(this.client && this.transport);
	}

	async connect(
		profileId: Profile["id"],
		onAuthorization: (url: URL) => void | Promise<void>,
		signal?: AbortSignal,
	): Promise<readonly McpTool[]> {
		await this.close();
		const profile = PROFILES[profileId];
		if (!profile) throw new Error(`Unknown MCP profile: ${profileId}`);
		this.profile = profile;

		if (!profile.oauth) {
			await this.open(profile);
			return this.refreshTools();
		}

		let authorizationUrl: URL | undefined;
		const provider = await PersistentOAuthProvider.create(
			CALLBACK_URL,
			(url) => {
				authorizationUrl = url;
			},
		);
		const first = this.createClient(profile, provider);
		try {
			await first.client.connect(first.transport);
			this.client = first.client;
			this.transport = first.transport;
			return this.refreshTools();
		} catch (error) {
			if (!(error instanceof UnauthorizedError) || !authorizationUrl) {
				await first.transport.close().catch(() => undefined);
				throw error;
			}
		}

		const callback = await startCallbackServer(
			() => provider.expectedState(),
			signal,
		);
		try {
			await onAuthorization(authorizationUrl);
			const code = await callback.code;
			await first.transport.finishAuth(code);
		} catch (error) {
			await provider.invalidateCredentials("verifier");
			throw error;
		} finally {
			await callback.close();
			await first.transport.close().catch(() => undefined);
		}

		await this.open(profile, provider);
		return this.refreshTools();
	}

	async callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<McpCallResult> {
		if (!this.client) throw new Error("Design MCP is not connected");
		return this.client.callTool({ name, arguments: args }, undefined, {
			signal,
		});
	}

	async refreshTools(): Promise<readonly McpTool[]> {
		if (!this.client) throw new Error("Design MCP is not connected");
		this.tools = (await this.client.listTools()).tools;
		return this.tools;
	}

	async logout(): Promise<void> {
		await this.close();
		const provider = await PersistentOAuthProvider.create(
			CALLBACK_URL,
			() => undefined,
		);
		await provider.clear();
	}

	async close(): Promise<void> {
		const client = this.client;
		this.client = undefined;
		this.transport = undefined;
		this.tools = [];
		this.profile = undefined;
		if (client) await client.close().catch(() => undefined);
	}

	private createClient(profile: Profile, provider?: PersistentOAuthProvider) {
		const client = new Client(
			{ name: "pi-design-mcp", version: "0.1.0" },
			{ capabilities: {} },
		);
		let endpoint: URL;
		try {
			endpoint = new URL(profile.url);
		} catch (error) {
			throw new Error(
				`Invalid MCP endpoint for ${profile.id}: ${(error as Error).message}`,
			);
		}
		const transport = new StreamableHTTPClientTransport(endpoint, {
			authProvider: provider,
		});
		return { client, transport };
	}

	private async open(
		profile: Profile,
		provider?: PersistentOAuthProvider,
	): Promise<void> {
		const created = this.createClient(profile, provider);
		await created.client.connect(created.transport);
		this.client = created.client;
		this.transport = created.transport;
	}
}

export { CALLBACK_URL, OAUTH_STORE_PATH };
