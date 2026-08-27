import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export interface DesignRunnerPolicy {
	allowCloud: boolean;
	allowDesktopApp: boolean;
	allowDesignWrites: boolean;
}

export interface DesignRunnerConfig {
	runner: string;
	policy: DesignRunnerPolicy;
	path?: string;
}

const SAFE_POLICY: DesignRunnerPolicy = {
	allowCloud: false,
	allowDesktopApp: false,
	allowDesignWrites: false,
};

async function findConfig(start: string): Promise<string | undefined> {
	let current = resolve(start);
	while (true) {
		const candidate = join(current, ".design-runner.json");
		try {
			await readFile(candidate, "utf8");
			return candidate;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

export async function loadDesignRunnerConfig(
	cwd: string,
): Promise<DesignRunnerConfig> {
	const path = await findConfig(cwd);
	if (!path) return { runner: "local-files", policy: { ...SAFE_POLICY } };
	let raw: { runner?: unknown; policy?: Record<string, unknown> };
	try {
		raw = JSON.parse(await readFile(path, "utf8")) as typeof raw;
	} catch (error) {
		throw new Error(`Cannot load ${path}: ${(error as Error).message}`);
	}
	const policy = raw.policy ?? {};
	return {
		runner:
			process.env.DESIGN_RUNNER ||
			(typeof raw.runner === "string" ? raw.runner : "local-files"),
		policy: {
			allowCloud: policy.allowCloud === true,
			allowDesktopApp: policy.allowDesktopApp === true,
			allowDesignWrites: policy.allowDesignWrites === true,
		},
		path,
	};
}

export function assertProfileAllowed(
	profile: string,
	config: DesignRunnerConfig,
): void {
	if (config.runner !== profile) {
		throw new Error(
			`Selected runner is ${config.runner}, not ${profile}. Switch it with design-runner before connecting.`,
		);
	}
	if (profile.endsWith("-remote") && !config.policy.allowCloud) {
		throw new Error("Remote MCP is blocked by policy.allowCloud=false");
	}
	if (profile.endsWith("-desktop") && !config.policy.allowDesktopApp) {
		throw new Error("Desktop MCP is blocked by policy.allowDesktopApp=false");
	}
}

const READ_ONLY_NAMES = new Set([
	"batch_read",
	"build_style_guide",
	"capture_layout",
	"capture_screenshot",
	"export_nodes",
	"export_variables",
	"fetch_component_lib",
	"fetch_editor_state",
	"fetch_file_info",
	"fetch_guidelines",
	"fetch_variables",
	"get_available_fonts",
	"locate_available_space",
	"scan_exportable_resources",
	"search_style_guide",
]);

export function isDesignWriteTool(tool: {
	name: string;
	annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}): boolean {
	if (tool.annotations?.readOnlyHint === true) return false;
	if (tool.annotations?.destructiveHint === true) return true;
	return !READ_ONLY_NAMES.has(tool.name);
}

export function assertToolAllowed(
	tool: {
		name: string;
		annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
	},
	config: DesignRunnerConfig,
): void {
	if (isDesignWriteTool(tool) && !config.policy.allowDesignWrites) {
		throw new Error(
			`${tool.name} is blocked by policy.allowDesignWrites=false`,
		);
	}
}
