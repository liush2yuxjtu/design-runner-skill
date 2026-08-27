#!/usr/bin/env python3
"""Resolve portable design workflows against a policy-checked runner profile."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

SKILL_ROOT = Path(__file__).resolve().parents[1]
RUNNERS_DIR = SKILL_ROOT / "runners"
WORKFLOWS_PATH = SKILL_ROOT / "workflows.json"
CONFIG_NAME = ".design-runner.json"
DEFAULT_POLICY = {
    "allowCloud": False,
    "allowDesktopApp": False,
    "allowDesignWrites": False,
}
ALLOWED_KINDS = {"tool", "discover", "local", "emulated", "unsupported"}


class ConfigError(ValueError):
    pass


def read_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text())
    except FileNotFoundError as exc:
        raise ConfigError(f"missing file: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"expected JSON object in {path}")
    return data


def load_catalog() -> tuple[dict[str, dict[str, Any]], dict[str, Any], dict[str, str]]:
    runners: dict[str, dict[str, Any]] = {}
    known_operations: set[str] = set()

    for path in sorted(RUNNERS_DIR.glob("*.json")):
        runner = read_json(path)
        runner_id = runner.get("id")
        if not isinstance(runner_id, str) or not runner_id:
            raise ConfigError(f"runner id missing in {path}")
        if runner_id != path.stem:
            raise ConfigError(f"runner id {runner_id!r} must match {path.stem!r}")
        if runner_id in runners:
            raise ConfigError(f"duplicate runner id: {runner_id}")

        requirements = runner.get("requirements")
        if not isinstance(requirements, dict):
            raise ConfigError(f"requirements missing for runner {runner_id}")
        for key in ("cloud", "desktopApp"):
            if not isinstance(requirements.get(key), bool):
                raise ConfigError(f"{runner_id}.requirements.{key} must be boolean")

        operations = runner.get("operations")
        if not isinstance(operations, dict) or not operations:
            raise ConfigError(f"operations missing for runner {runner_id}")
        for name, operation in operations.items():
            if not isinstance(operation, dict):
                raise ConfigError(f"{runner_id}.{name} must be an object")
            if operation.get("kind") not in ALLOWED_KINDS:
                raise ConfigError(f"invalid operation kind for {runner_id}.{name}")
            candidates = operation.get("candidates")
            if not isinstance(candidates, list) or not all(
                isinstance(item, str) and item for item in candidates
            ):
                raise ConfigError(f"{runner_id}.{name}.candidates must be strings")
            if not isinstance(operation.get("writesDesign"), bool):
                raise ConfigError(f"{runner_id}.{name}.writesDesign must be boolean")
            if operation["kind"] == "discover":
                keywords = operation.get("keywords")
                if not isinstance(keywords, list) or not all(
                    isinstance(item, str) and item for item in keywords
                ):
                    raise ConfigError(f"{runner_id}.{name}.keywords must be strings")
            known_operations.add(name)
        runners[runner_id] = runner

    if "local-files" not in runners:
        raise ConfigError("safe default runner local-files is missing")

    workflows_data = read_json(WORKFLOWS_PATH)
    workflows = workflows_data.get("workflows")
    if not isinstance(workflows, dict) or not workflows:
        raise ConfigError("workflows.json must contain workflows")

    aliases: dict[str, str] = {}
    for workflow_name, workflow in workflows.items():
        if not isinstance(workflow, dict):
            raise ConfigError(f"workflow {workflow_name} must be an object")
        for field in ("required", "optional", "aliases"):
            values = workflow.get(field)
            if not isinstance(values, list) or not all(
                isinstance(item, str) and item for item in values
            ):
                raise ConfigError(f"workflow {workflow_name}.{field} must be strings")
            if len(values) != len(set(values)):
                raise ConfigError(f"workflow {workflow_name}.{field} has duplicates")
        for operation in workflow["required"] + workflow["optional"]:
            if operation not in known_operations:
                raise ConfigError(
                    f"workflow {workflow_name} uses unknown operation {operation}"
                )
        if workflow_name in aliases:
            raise ConfigError(f"duplicate workflow name: {workflow_name}")
        aliases[workflow_name] = workflow_name
        for alias in workflow["aliases"]:
            if alias in aliases:
                raise ConfigError(f"duplicate workflow alias: {alias}")
            aliases[alias] = workflow_name

    return runners, workflows, aliases


def nearest_config(start: Path) -> Path | None:
    current = start.expanduser().resolve()
    if current.is_file():
        current = current.parent
    for directory in (current, *current.parents):
        candidate = directory / CONFIG_NAME
        if candidate.exists():
            return candidate
    return None


def normalized_policy(raw: Any) -> dict[str, bool]:
    if raw is None:
        return dict(DEFAULT_POLICY)
    if not isinstance(raw, dict):
        raise ConfigError("policy must be an object")
    policy = dict(DEFAULT_POLICY)
    for key in DEFAULT_POLICY:
        if key in raw:
            if not isinstance(raw[key], bool):
                raise ConfigError(f"policy.{key} must be boolean")
            policy[key] = raw[key]
    unknown = set(raw) - set(DEFAULT_POLICY)
    if unknown:
        raise ConfigError(f"unknown policy keys: {', '.join(sorted(unknown))}")
    return policy


def load_config(
    runners: dict[str, dict[str, Any]],
    project: str | None = None,
    runner_override: str | None = None,
) -> tuple[dict[str, Any], Path | None]:
    start = Path(project).expanduser() if project else Path.cwd()
    config_path = nearest_config(start)
    raw = read_json(config_path) if config_path else {}
    runner_id = (
        runner_override
        or os.getenv("DESIGN_RUNNER")
        or raw.get("runner", "local-files")
    )
    if runner_id not in runners:
        raise ConfigError(f"unknown runner: {runner_id}")
    return {
        "runner": runner_id,
        "policy": normalized_policy(raw.get("policy")),
    }, config_path


def requirement_errors(runner: dict[str, Any], policy: dict[str, bool]) -> list[str]:
    errors: list[str] = []
    requirements = runner["requirements"]
    if requirements["cloud"] and not policy["allowCloud"]:
        errors.append("runner requires cloud; set --cloud allow")
    if requirements["desktopApp"] and not policy["allowDesktopApp"]:
        errors.append("runner requires a desktop app; set --desktop allow")
    return errors


def capability_symbol(name: str) -> str:
    return "$DESIGN_RUNNER_" + name.upper().replace(".", "_").replace("-", "_")


def operation_result(
    capability: str,
    operation: dict[str, Any] | None,
    policy: dict[str, bool],
    required: bool,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "capability": capability,
        "symbol": capability_symbol(capability),
        "required": required,
    }
    if operation is None or operation.get("kind") == "unsupported":
        result.update(
            status="unsupported",
            kind="unsupported",
            candidates=[],
            notes=(operation or {}).get(
                "notes", "runner does not define this capability"
            ),
        )
        return result

    blocked = operation["writesDesign"] and not policy["allowDesignWrites"]
    result.update(
        status="blocked" if blocked else operation["kind"],
        kind=operation["kind"],
        candidates=operation.get("candidates", []),
        keywords=operation.get("keywords", []),
        writesDesign=operation["writesDesign"],
        notes=operation.get("notes", ""),
    )
    if blocked:
        result["notes"] = "design write blocked; set --design-writes allow"
    return result


def config_target(project: str | None) -> Path:
    if project:
        directory = Path(project).expanduser().resolve()
        if not directory.is_dir():
            raise ConfigError(f"project directory does not exist: {directory}")
        return directory / CONFIG_NAME
    existing = nearest_config(Path.cwd())
    return existing or Path.cwd().resolve() / CONFIG_NAME


def policy_value(value: str | None, current: bool) -> bool:
    if value is None:
        return current
    return value == "allow"


def print_json(data: Any) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def command_list(args: argparse.Namespace) -> int:
    runners, _, _ = load_catalog()
    rows = [
        {
            "id": runner_id,
            "label": runner.get("label", runner_id),
            "cloud": runner["requirements"]["cloud"],
            "desktopApp": runner["requirements"]["desktopApp"],
        }
        for runner_id, runner in sorted(runners.items())
    ]
    if args.json:
        print_json(rows)
    else:
        for row in rows:
            print(
                f"{row['id']}: cloud={str(row['cloud']).lower()} "
                f"desktop={str(row['desktopApp']).lower()} — {row['label']}"
            )
    return 0


def command_show(args: argparse.Namespace) -> int:
    runners, _, _ = load_catalog()
    if args.runner not in runners:
        raise ConfigError(f"unknown runner: {args.runner}")
    print_json(runners[args.runner])
    return 0


def command_use(args: argparse.Namespace) -> int:
    runners, _, _ = load_catalog()
    if args.runner not in runners:
        raise ConfigError(f"unknown runner: {args.runner}")
    target = config_target(args.project)
    raw = read_json(target) if target.exists() else {}
    policy = normalized_policy(raw.get("policy"))
    policy["allowCloud"] = policy_value(args.cloud, policy["allowCloud"])
    policy["allowDesktopApp"] = policy_value(args.desktop, policy["allowDesktopApp"])
    policy["allowDesignWrites"] = policy_value(
        args.design_writes, policy["allowDesignWrites"]
    )
    errors = requirement_errors(runners[args.runner], policy)
    if errors:
        raise ConfigError("; ".join(errors))

    config = {"runner": args.runner, "policy": policy}
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(target.suffix + ".tmp")
    temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(target)
    print(f"runner={args.runner}")
    print(f"config={target}")
    return 0


def command_check(args: argparse.Namespace) -> int:
    runners, workflows, _ = load_catalog()
    config, path = load_config(runners, args.project, args.runner)
    runner = runners[config["runner"]]
    errors = requirement_errors(runner, config["policy"])
    report = {
        "ok": not errors,
        "runner": config["runner"],
        "config": str(path) if path else "<safe-default>",
        "policy": config["policy"],
        "runnerCount": len(runners),
        "workflowCount": len(workflows),
        "errors": errors,
    }
    if args.json:
        print_json(report)
    else:
        print(
            f"runner={report['runner']} config={report['config']} "
            f"runners={report['runnerCount']} workflows={report['workflowCount']}"
        )
        for error in errors:
            print(f"ERROR: {error}")
        if not errors:
            print("OK")
    return 0 if not errors else 2


def command_resolve(args: argparse.Namespace) -> int:
    runners, workflows, aliases = load_catalog()
    if args.workflow not in aliases:
        raise ConfigError(f"unknown workflow: {args.workflow}")
    config, path = load_config(runners, args.project, args.runner)
    runner = runners[config["runner"]]
    workflow_name = aliases[args.workflow]
    workflow = workflows[workflow_name]
    errors = requirement_errors(runner, config["policy"])

    required = [
        operation_result(name, runner["operations"].get(name), config["policy"], True)
        for name in workflow["required"]
    ]
    optional = [
        operation_result(name, runner["operations"].get(name), config["policy"], False)
        for name in workflow["optional"]
    ]
    for item in required:
        if item["status"] in {"unsupported", "blocked"}:
            errors.append(f"{item['capability']}: {item['notes']}")

    report = {
        "ok": not errors,
        "requestedWorkflow": args.workflow,
        "workflow": workflow_name,
        "runner": config["runner"],
        "config": str(path) if path else "<safe-default>",
        "policy": config["policy"],
        "required": required,
        "optional": optional,
        "errors": errors,
    }
    if args.json:
        print_json(report)
    else:
        print(f"runner={report['runner']} workflow={workflow_name}")
        for heading, items in (("required", required), ("optional", optional)):
            print(f"{heading}:")
            for item in items:
                detail = ", ".join(item.get("candidates", []))
                if not detail:
                    detail = ", ".join(item.get("keywords", [])) or item.get(
                        "notes", ""
                    )
                print(f"  {item['symbol']} [{item['status']}] {detail}")
        for error in errors:
            print(f"ERROR: {error}")
    return 0 if not errors else 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="list runner profiles")
    list_parser.add_argument("--json", action="store_true")
    list_parser.set_defaults(handler=command_list)

    show_parser = subparsers.add_parser("show", help="show one runner manifest")
    show_parser.add_argument("runner")
    show_parser.set_defaults(handler=command_show)

    use_parser = subparsers.add_parser("use", help="select a runner")
    use_parser.add_argument("runner")
    use_parser.add_argument("--project")
    use_parser.add_argument("--cloud", choices=("allow", "deny"))
    use_parser.add_argument("--desktop", choices=("allow", "deny"))
    use_parser.add_argument("--design-writes", choices=("allow", "deny"))
    use_parser.set_defaults(handler=command_use)

    for name, handler, help_text in (
        ("check", command_check, "validate catalog, config, and policy"),
        ("resolve", command_resolve, "resolve a workflow to runner capabilities"),
    ):
        subparser = subparsers.add_parser(name, help=help_text)
        if name == "resolve":
            subparser.add_argument("workflow")
        subparser.add_argument("--project")
        subparser.add_argument("--runner")
        subparser.add_argument("--json", action="store_true")
        subparser.set_defaults(handler=handler)

    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        return args.handler(args)
    except ConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
