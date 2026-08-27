import {
	chmod,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
	OAuthClientProvider,
	OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

interface StoredOAuthState {
	clientInformation?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
	codeVerifier?: string;
	oauthState?: string;
	discovery?: OAuthDiscoveryState;
}

const DEFAULT_STORE = join(
	homedir(),
	".pi",
	"agent",
	"state",
	"design-mcp",
	"ardot-remote.oauth.json",
);

async function loadState(path: string): Promise<StoredOAuthState> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("OAuth state must be a JSON object");
		}
		return parsed as StoredOAuthState;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw new Error(
			`Cannot load design MCP OAuth state: ${(error as Error).message}`,
		);
	}
}

export class PersistentOAuthProvider implements OAuthClientProvider {
	private constructor(
		private readonly path: string,
		private readonly callbackUrl: string,
		private readonly onRedirect: (url: URL) => void | Promise<void>,
		private stateData: StoredOAuthState,
	) {}

	static async create(
		callbackUrl: string,
		onRedirect: (url: URL) => void | Promise<void>,
		path = DEFAULT_STORE,
	): Promise<PersistentOAuthProvider> {
		return new PersistentOAuthProvider(
			path,
			callbackUrl,
			onRedirect,
			await loadState(path),
		);
	}

	get redirectUrl(): string {
		return this.callbackUrl;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: "Pi Design MCP",
			redirect_uris: [this.callbackUrl],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
			scope: "mcp:use",
		};
	}

	async state(): Promise<string> {
		const state = randomUUID();
		this.stateData.oauthState = state;
		await this.persist();
		return state;
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return this.stateData.clientInformation;
	}

	async saveClientInformation(
		clientInformation: OAuthClientInformationMixed,
	): Promise<void> {
		this.stateData.clientInformation = clientInformation;
		await this.persist();
	}

	tokens(): OAuthTokens | undefined {
		return this.stateData.tokens;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		this.stateData.tokens = { ...this.stateData.tokens, ...tokens };
		delete this.stateData.codeVerifier;
		delete this.stateData.oauthState;
		await this.persist();
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		await this.onRedirect(authorizationUrl);
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		this.stateData.codeVerifier = codeVerifier;
		await this.persist();
	}

	codeVerifier(): string {
		if (!this.stateData.codeVerifier)
			throw new Error("No OAuth PKCE verifier is saved");
		return this.stateData.codeVerifier;
	}

	async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
		this.stateData.discovery = discovery;
		await this.persist();
	}

	discoveryState(): OAuthDiscoveryState | undefined {
		return this.stateData.discovery;
	}

	expectedState(): string | undefined {
		return this.stateData.oauthState;
	}

	async invalidateCredentials(
		scope: "all" | "client" | "tokens" | "verifier" | "discovery",
	): Promise<void> {
		if (scope === "all" || scope === "client")
			delete this.stateData.clientInformation;
		if (scope === "all" || scope === "tokens") delete this.stateData.tokens;
		if (scope === "all" || scope === "verifier") {
			delete this.stateData.codeVerifier;
			delete this.stateData.oauthState;
		}
		if (scope === "all" || scope === "discovery")
			delete this.stateData.discovery;
		await this.persist();
	}

	async clear(): Promise<void> {
		this.stateData = {};
		await rm(this.path, { force: true });
	}

	private async persist(): Promise<void> {
		await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
		const temporary = `${this.path}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(this.stateData, null, 2)}\n`, {
			mode: 0o600,
		});
		await chmod(temporary, 0o600);
		await rename(temporary, this.path);
		await chmod(this.path, 0o600);
	}
}

export { DEFAULT_STORE as OAUTH_STORE_PATH };
