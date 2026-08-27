import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PersistentOAuthProvider } from "../oauth-store.js";
import {
	assertProfileAllowed,
	assertToolAllowed,
	loadDesignRunnerConfig,
} from "../policy.js";

const directory = await mkdtemp(join(tmpdir(), "design-mcp-test-"));
const oauthPath = join(directory, "oauth.json");
const provider = await PersistentOAuthProvider.create(
	"http://127.0.0.1:17321/callback",
	() => undefined,
	oauthPath,
);
const state = await provider.state();
assert.ok(state.length > 10);
await provider.saveCodeVerifier("verifier");
assert.equal(provider.codeVerifier(), "verifier");
await provider.saveClientInformation({ client_id: "client" });
await provider.saveTokens({
	access_token: "access",
	refresh_token: "refresh",
	token_type: "bearer",
});

const restored = await PersistentOAuthProvider.create(
	"http://127.0.0.1:17321/callback",
	() => undefined,
	oauthPath,
);
assert.equal(restored.clientInformation()?.client_id, "client");
assert.equal(restored.tokens()?.refresh_token, "refresh");
assert.equal((await stat(oauthPath)).mode & 0o777, 0o600);
assert.doesNotMatch(await readFile(oauthPath, "utf8"), /verifier/);

const configPath = join(directory, ".design-runner.json");
await writeFile(
	configPath,
	JSON.stringify({
		runner: "ardot-remote",
		policy: {
			allowCloud: true,
			allowDesktopApp: false,
			allowDesignWrites: false,
		},
	}),
);
const config = await loadDesignRunnerConfig(directory);
assertProfileAllowed("ardot-remote", config);
assert.doesNotThrow(() =>
	assertToolAllowed({ name: "fetch_file_info" }, config),
);
assert.throws(
	() => assertToolAllowed({ name: "batch_edit" }, config),
	/allowDesignWrites=false/,
);

await restored.clear();
